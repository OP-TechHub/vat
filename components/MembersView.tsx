"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useApp } from "./AppShell";
import type { Role } from "@/lib/types";

interface Member {
  user_id: string;
  email: string;
  role: Role;
}

const ROLES: Role[] = ["viewer", "editor", "admin"];
const ROLE_HELP: Record<Role, string> = {
  viewer: "read only",
  editor: "uploads, inline edits, return entry",
  admin: "also manages members",
};

export default function MembersView() {
  const { supabase, company, user, isAdmin, loading: appLoading, flash } = useApp();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("member_list", { p_company: company.id });
    setLoading(false);
    if (error) {
      flash("Could not load members: " + error.message, true);
      return;
    }
    setMembers((data as Member[]) ?? []);
  }, [supabase, company, flash]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!appLoading && !isAdmin)
    return <div className="panel note">Only company admins can manage members.</div>;

  const admins = members.filter((m) => m.role === "admin").length;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy("add");
    const { error } = await supabase.rpc("add_member_by_email", {
      p_company: company.id,
      p_email: email.trim(),
      p_role: role,
    });
    setBusy(null);
    if (error) {
      flash(error.message, true);
      return;
    }
    flash(`${email.trim()} is now ${role === "admin" ? "an" : "a"} ${role} of ${company.name}.`);
    setEmail("");
    await load();
  }

  async function setMemberRole(m: Member, r: Role) {
    if (!company) return;
    if (m.user_id === user.id && m.role === "admin" && r !== "admin" && admins <= 1) {
      flash("You are the only admin. Make someone else an admin before changing your own role.", true);
      return;
    }
    setBusy(m.user_id);
    const { error } = await supabase
      .from("company_members")
      .update({ role: r })
      .eq("company_id", company.id)
      .eq("user_id", m.user_id);
    setBusy(null);
    if (error) {
      flash("Could not change role: " + error.message, true);
      return;
    }
    flash(null);
    await load();
  }

  async function remove(m: Member) {
    if (!company) return;
    if (m.user_id === user.id && admins <= 1) {
      flash("You are the only admin. Make someone else an admin before removing yourself.", true);
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

  return (
    <>
      <form className="panel" onSubmit={add}>
        <h2 className="text-[15px] font-semibold m-0">Add a member</h2>
        <div className="note">
          The person needs a login in this Supabase project first (Authentication → Users → Add user). Then enter the
          same email here. Viewer: {ROLE_HELP.viewer}. Editor: {ROLE_HELP.editor}. Admin: {ROLE_HELP.admin}.
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
            <select className="control" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy === "add" || !company}>
            {busy === "add" ? "Adding…" : "Add member"}
          </button>
        </div>
      </form>

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="note">
                  Loading members…
                </td>
              </tr>
            ) : !members.length ? (
              <tr>
                <td colSpan={3} className="note">
                  No members yet.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.user_id} className={busy === m.user_id ? "opacity-60" : undefined}>
                  <td>
                    {m.email}
                    {m.user_id === user.id && <span className="note"> (you)</span>}
                  </td>
                  <td>
                    <select
                      className="control"
                      value={m.role}
                      disabled={busy === m.user_id}
                      aria-label={`Role for ${m.email}`}
                      onChange={(e) => setMemberRole(m, e.target.value as Role)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-danger" type="button" disabled={busy === m.user_id} onClick={() => remove(m)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
