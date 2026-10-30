"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useApp } from "./AppShell";
import {
  KIND_LABEL,
  LOG_TABS,
  PAGE_SIZE,
  describeSet,
  fieldChanges,
  loadChangeRows,
  loadChangeSets,
  loadLogPeople,
  rowFields,
  rowLabel,
  tabLabel,
  undoChangeSet,
  type ChangeKind,
  type ChangeRow,
  type ChangeSet,
  type LogFilters,
} from "@/lib/changeLog";
import { isMissingTable } from "@/lib/documents";

const NO_FILTERS: LogFilters = { tab: "", user: "", kind: "", from: "", to: "" };
const KINDS = Object.keys(KIND_LABEL) as ChangeKind[];
const OP_TEXT: Record<ChangeRow["op"], { text: string; pill: string }> = {
  INSERT: { text: "Added", pill: "pill-good" },
  UPDATE: { text: "Changed", pill: "pill-info" },
  DELETE: { text: "Removed", pill: "pill-warn" },
};
/** Rows shown under an entry before "show all". */
const ROWS_SHOWN = 50;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The rows one entry changed. */
function Details({ set }: { set: ChangeSet }) {
  const { supabase } = useApp();
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    loadChangeRows(supabase, set.id)
      .then((r) => live && setRows(r))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [supabase, set.id]);

  if (error) return <div className="msg msg-err">{error}</div>;
  if (!rows) return <div className="note">Loading…</div>;
  const total = set.n_insert + set.n_update + set.n_delete;
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((r) => {
        const changes = fieldChanges(r);
        return (
          <div key={r.id} className="flex flex-wrap gap-x-2 items-baseline text-[13px]">
            <span className={"pill " + OP_TEXT[r.op].pill}>{OP_TEXT[r.op].text}</span>
            <span className="font-medium">{rowLabel(r)}</span>
            <span className="text-muted">{tabLabel(r.tab)}</span>
            {r.op === "UPDATE" ? (
              <span className="whitespace-normal">
                {changes.map((c, i) => (
                  <span key={c.field}>
                    {i > 0 && " · "}
                    {c.field}: <span className="text-muted line-through">{c.before}</span> → {c.after}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-muted whitespace-normal">{rowFields(r)}</span>
            )}
          </div>
        );
      })}
      {rows.length > shown.length && (
        <button className="btn self-start" type="button" onClick={() => setAll(true)}>
          Show all {rows.length} rows
        </button>
      )}
      {total > rows.length && (
        <div className="note">
          The first {rows.length} of {total} changed rows are listed; undo covers all of them.
        </div>
      )}
    </div>
  );
}

export default function LogView() {
  const { supabase, company, isAdmin, loading: appLoading, reload, flash } = useApp();
  const [sets, setSets] = useState<ChangeSet[] | null>(null);
  const [more, setMore] = useState(false);
  const [filters, setFilters] = useState<LogFilters>(NO_FILTERS);
  const [people, setPeople] = useState<{ user_id: string; email: string }[]>([]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company || !isAdmin) return;
    try {
      const list = await loadChangeSets(supabase, company.id, filters);
      setSets(list);
      setMore(list.length === PAGE_SIZE);
      setError(null);
    } catch (e) {
      setSets([]);
      setError(
        isMissingTable(e) || /function/i.test(e instanceof Error ? e.message : "")
          ? "The change log needs supabase/migrations/0015_change_log.sql to be run in the Supabase SQL Editor."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, [supabase, company, isAdmin, filters]);

  useEffect(() => {
    setSets(null);
    setOpen(new Set());
    void load();
  }, [load]);

  useEffect(() => {
    if (!company || !isAdmin) return;
    loadLogPeople(supabase, company.id)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [supabase, company, isAdmin]);

  if (!appLoading && !isAdmin) return <div className="panel note">Only company admins can see the change log.</div>;

  async function loadMore() {
    if (!company || !sets?.length) return;
    try {
      const next = await loadChangeSets(supabase, company.id, filters, sets[sets.length - 1].id);
      setSets([...sets, ...next]);
      setMore(next.length === PAGE_SIZE);
    } catch (e) {
      flash("Could not load more: " + (e instanceof Error ? e.message : String(e)), true);
    }
  }

  async function undo(s: ChangeSet) {
    if (!window.confirm(`Undo #${s.id}: ${describeSet(s)}?\n\nEvery row it changed is put back as it was before.`)) return;
    setBusy(s.id);
    try {
      const id = await undoChangeSet(supabase, s.id);
      flash(`Undid #${s.id}. The undo is entry #${id}, which can itself be undone.`);
      await Promise.all([load(), reload()]);
    } catch (e) {
      flash("Could not undo: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusy(null);
  }

  const toggle = (id: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const set = (patch: Partial<LogFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <div className="bar">
        <label className="field">
          Tab
          <select className="control" value={filters.tab} onChange={(e) => set({ tab: e.target.value })}>
            <option value="">All tabs</option>
            {LOG_TABS.map((t) => (
              <option key={t} value={t}>
                {tabLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Person
          <select className="control" value={filters.user} onChange={(e) => set({ user: e.target.value })}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.email}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Type
          <select className="control" value={filters.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="">All changes</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <input className="control" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="field">
          To
          <input className="control" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        {filtered && (
          <button className="btn" type="button" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="msg msg-err">{error}</div>}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>When</th>
              <th>Who</th>
              <th>Tab</th>
              <th>Type</th>
              <th>What changed</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!sets ? (
              <tr>
                <td colSpan={8} className="note">
                  Loading the change log…
                </td>
              </tr>
            ) : !sets.length ? (
              <tr>
                <td colSpan={8} className="note">
                  {filtered ? "No changes match these filters." : "No changes recorded yet."}
                </td>
              </tr>
            ) : (
              sets.map((s) => {
                const isOpen = open.has(s.id);
                return (
                  <Fragment key={s.id}>
                    <tr className={(s.undone_by ? "text-muted" : "") + (busy === s.id ? " opacity-60" : "")}>
                      <td className="num font-mono">{s.id}</td>
                      <td className="whitespace-nowrap">{when(s.changed_at)}</td>
                      <td>{s.email ?? <span className="text-muted">System</span>}</td>
                      <td className="whitespace-normal">{s.tabs.map(tabLabel).join(", ")}</td>
                      <td>{KIND_LABEL[s.kind] ?? s.kind}</td>
                      <td className="wrapc">{describeSet(s)}</td>
                      <td className="whitespace-nowrap">
                        {s.undone_by ? (
                          <span className="pill pill-warn">Undone by #{s.undone_by}</span>
                        ) : s.undo_of ? (
                          <span className="pill pill-info">Undo of #{s.undo_of}</span>
                        ) : (
                          <span className="pill pill-good">In effect</span>
                        )}
                      </td>
                      <td>
                        <div className="flex gap-1.5">
                          <button className="btn" type="button" onClick={() => toggle(s.id)} aria-expanded={isOpen}>
                            {isOpen ? "Hide" : "Details"}
                          </button>
                          {!s.undone_by && (
                            <button
                              className="btn btn-danger"
                              type="button"
                              disabled={busy != null}
                              onClick={() => void undo(s)}
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td></td>
                        <td colSpan={7} className="whitespace-normal">
                          <Details set={s} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {more && (
        <div className="bar">
          <button className="btn" type="button" onClick={() => void loadMore()}>
            Load older changes
          </button>
        </div>
      )}
      <div className="note">
        Every change to the company’s data, members and permissions is recorded: who made it, when, and each row
        before and after. Undo puts every row an entry changed back as it was; it is refused while later changes
        touch the same rows (undo those first). An undo is an entry too, so it can be undone. Removed or replaced
        documents are kept for 30 days so their removal can be undone, then deleted for good. Entries are kept for
        5 years.
      </div>
    </>
  );
}
