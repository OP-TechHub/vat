"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useApp } from "./AppShell";
import {
  ACTION_LABEL,
  NO_ACCESS,
  TABS,
  permMap,
  presetRows,
  type Action,
  type PermMap,
  type TabKey,
  type TabPermRow,
} from "@/lib/permissions";
import type { Role } from "@/lib/types";

interface Member {
  user_id: string;
  email: string;
  role: Role;
  permissions: TabPermRow[];
}

/** A member's role and access as being edited. */
interface Draft {
  role: Role;
  perms: PermMap;
}

type Preset = "viewer" | "editor" | "none";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "viewer", label: "View all tabs" },
  { key: "editor", label: "Everything on all tabs" },
  { key: "none", label: "No access" },
];

const ROLES: Role[] = ["member", "admin"];
type Flag = "view" | Action;
const FLAG_LETTER: Record<Flag, string> = { view: "V", upload: "U", edit: "E", delete: "D" };
const FLAG_LABEL: Record<Flag, string> = { view: "View", ...ACTION_LABEL };

const presetMap = (p: Preset): PermMap => permMap(false, p === "none" ? [] : presetRows(p));
const draftOf = (m: Member): Draft => ({ role: m.role, perms: permMap(false, m.permissions) });

/** Permission rows to save: one per tab the member may open. */
function rowsOf(perms: PermMap): TabPermRow[] {
  return TABS.filter((t) => perms[t.key].view).map((t) => ({
    tab: t.key,
    can_upload: perms[t.key].upload,
    can_edit: perms[t.key].edit,
    can_delete: perms[t.key].delete,
  }));
}

const sameDraft = (a: Draft, b: Draft) =>
  a.role === b.role && (a.role === "admin" || JSON.stringify(rowsOf(a.perms)) === JSON.stringify(rowsOf(b.perms)));

/** Turn one flag of a tab on or off. Upload, edit and delete need view; removing view removes all access. */
function setFlag(perms: PermMap, tab: TabKey, flag: Flag, on: boolean): PermMap {
  const cur = perms[tab];
  const next = flag === "view" ? (on ? { ...cur, view: true } : NO_ACCESS) : { ...cur, [flag]: on, view: cur.view || on };
  return { ...perms, [tab]: next };
}

/** The V / U / E / D boxes of one tab. */
function PermCell({
  tab,
  perms,
  disabled,
  who,
  onChange,
}: {
  tab: (typeof TABS)[number];
  perms: PermMap;
  disabled?: boolean;
  who: string;
  onChange: (perms: PermMap) => void;
}) {
  const flags: Flag[] = ["view", ...tab.actions];
  return (
    <div className="flex gap-1.5">
      {flags.map((f) => (
        <label key={f} className="inline-flex items-center gap-0.5 text-[12px] cursor-pointer" title={FLAG_LABEL[f]}>
          <input
            type="checkbox"
            checked={perms[tab.key][f]}
            disabled={disabled}
            aria-label={`${FLAG_LABEL[f]} on ${tab.label} for ${who}`}
            onChange={(e) => onChange(setFlag(perms, tab.key, f, e.target.checked))}
          />
          {FLAG_LETTER[f]}
        </label>
      ))}
    </div>
  );
}

function PresetSelect({ disabled, onPick }: { disabled?: boolean; onPick: (p: Preset) => void }) {
  return (
    <select
      className="control"
      value=""
      disabled={disabled}
      aria-label="Apply a preset"
      onChange={(e) => e.target.value && onPick(e.target.value as Preset)}
    >
      <option value="">Preset…</option>
      {PRESETS.map((p) => (
        <option key={p.key} value={p.key}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

const TabHeadings = () => (
  <>
    {TABS.map((t) => (
      <th key={t.key} className="whitespace-normal min-w-[96px]">
        {t.label}
      </th>
    ))}
  </>
);

export default function MembersView() {
  const { supabase, company, user, isAdmin, loading: appLoading, flash } = useApp();
  const [members, setMembers] = useState<Member[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [newDraft, setNewDraft] = useState<Draft>({ role: "member", perms: presetMap("viewer") });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("member_list", { p_company: company.id });
    setLoading(false);
    if (error) {
      flash(
        "Could not load members: " +
          error.message +
          (/schema cache|function|permissions/i.test(error.message)
            ? ". Run supabase/migrations/0014_tab_permissions.sql in the Supabase SQL Editor first."
            : ""),
        true,
      );
      return;
    }
    const list = ((data as Member[]) ?? []).map((m) => ({ ...m, permissions: m.permissions ?? [] }));
    setMembers(list);
    setDrafts(Object.fromEntries(list.map((m) => [m.user_id, draftOf(m)])));
  }, [supabase, company, flash]);

  useEffect(() => {
    void load();
  }, [load]);

  const admins = useMemo(() => members.filter((m) => m.role === "admin").length, [members]);

  if (!appLoading && !isAdmin)
    return <div className="panel note">Only company admins can manage members.</div>;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy("add");
    const { error } = await supabase.rpc("add_member_by_email", {
      p_company: company.id,
      p_email: email.trim(),
      p_role: newDraft.role,
      p_perms: rowsOf(newDraft.perms),
    });
    setBusy(null);
    if (error) {
      flash(error.message, true);
      return;
    }
    flash(`${email.trim()} is now ${newDraft.role === "admin" ? "an admin" : "a member"} of ${company.name}.`);
    setEmail("");
    setNewDraft({ role: "member", perms: presetMap("viewer") });
    await load();
  }

  async function save(m: Member) {
    if (!company) return;
    const d = drafts[m.user_id];
    if (m.role === "admin" && d.role !== "admin" && admins <= 1) {
      flash(
        m.user_id === user.id
          ? "You are the only admin. Make someone else an admin before changing your own role."
          : "This is the only admin. Make someone else an admin first.",
        true,
      );
      return;
    }
    setBusy(m.user_id);
    const { error } = await supabase.rpc("set_member_access", {
      p_company: company.id,
      p_user: m.user_id,
      p_role: d.role,
      p_perms: rowsOf(d.perms),
    });
    setBusy(null);
    if (error) {
      flash("Could not save: " + error.message, true);
      return;
    }
    flash(`Saved access for ${m.email}.`);
    await load();
  }

  async function remove(m: Member) {
    if (!company) return;
    if (m.role === "admin" && admins <= 1) {
      flash("This is the only admin. Make someone else an admin before removing them.", true);
      return;
    }
    if (!window.confirm(`Remove ${m.email} from ${company.name}?`)) return;
    setBusy(m.user_id);
    const { error } = await supabase
      .from("company_members")
      .delete()
      .eq("company_id", company.id)
      .eq("user_id", m.user_id);
    setBusy(null);
    if (error) {
      flash("Could not remove: " + error.message, true);
      return;
    }
    flash(`Removed ${m.email}.`);
    await load();
  }

  const setDraft = (id: string, d: Draft) => setDrafts((all) => ({ ...all, [id]: d }));
  const COLS = TABS.length + 3;

  return (
    <>
      <form className="panel" onSubmit={add}>
        <h2 className="text-[15px] font-semibold m-0">Add a member</h2>
        <div className="note">
          The person needs a login in this Supabase project first (Authentication → Users → Add user). Then enter the
          same email here and choose what they may do on each tab. Admins can do everything on every tab and manage
          members.
        </div>
        <div className="bar">
          <label className="field">
            Email
            <input
              className="control min-w-[260px]"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label className="field">
            Role
            <select
              className="control"
              value={newDraft.role}
              onChange={(e) => setNewDraft({ ...newDraft, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {newDraft.role === "member" && (
            <label className="field">
              Preset
              <PresetSelect onPick={(p) => setNewDraft({ ...newDraft, perms: presetMap(p) })} />
            </label>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy === "add" || !company}>
            {busy === "add" ? "Adding…" : "Add member"}
          </button>
        </div>
        {newDraft.role === "member" && (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <TabHeadings />
                </tr>
              </thead>
              <tbody>
                <tr>
                  {TABS.map((t) => (
                    <td key={t.key}>
                      <PermCell
                        tab={t}
                        perms={newDraft.perms}
                        who="the new member"
                        onChange={(perms) => setNewDraft({ ...newDraft, perms })}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </form>

      <div className="note">
        V view, U upload, E edit, D delete. A tab without V is hidden and its data cannot be read. Upload covers
        uploading a month’s file or a document into an empty slot; edit covers inline edits, rows added by hand,
        return figures and IRD status; delete covers deleting rows, replacing or removing documents and re-uploading a
        month that already holds data. Summary is view only; Return filing has no edit.
      </div>

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <TabHeadings />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLS} className="note">
                  Loading members…
                </td>
              </tr>
            ) : !members.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  No members yet.
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const d = drafts[m.user_id] ?? draftOf(m);
                const isBusy = busy === m.user_id;
                const dirty = !sameDraft(d, draftOf(m));
                return (
                  <tr key={m.user_id} className={isBusy ? "opacity-60" : undefined}>
                    <td>
                      {m.email}
                      {m.user_id === user.id && <span className="note"> (you)</span>}
                    </td>
                    <td>
                      <select
                        className="control"
                        value={d.role}
                        disabled={isBusy}
                        aria-label={`Role for ${m.email}`}
                        onChange={(e) => setDraft(m.user_id, { ...d, role: e.target.value as Role })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    {d.role === "admin" ? (
                      <td colSpan={TABS.length} className="note">
                        Full access to every tab, and manages members.
                      </td>
                    ) : (
                      TABS.map((t) => (
                        <td key={t.key}>
                          <PermCell
                            tab={t}
                            perms={d.perms}
                            disabled={isBusy}
                            who={m.email}
                            onChange={(perms) => setDraft(m.user_id, { ...d, perms })}
                          />
                        </td>
                      ))
                    )}
                    <td>
                      <div className="flex gap-1.5 items-center">
                        {d.role === "member" && (
                          <PresetSelect
                            disabled={isBusy}
                            onPick={(p) => setDraft(m.user_id, { ...d, perms: presetMap(p) })}
                          />
                        )}
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={isBusy || !dirty}
                          onClick={() => void save(m)}
                        >
                          Save
                        </button>
                        {dirty && (
                          <button className="btn" type="button" disabled={isBusy} onClick={() => setDraft(m.user_id, draftOf(m))}>
                            Undo
                          </button>
                        )}
                        <button className="btn btn-danger" type="button" disabled={isBusy} onClick={() => void remove(m)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
