"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { Modal, PostingChip, n0, n2 } from "./ui";
import { allocLiab, downloadCsv, fdate, lineKey, r4, toCsv, type Cancellation } from "@/lib/tiep/model";

/** Members' emails by user id, for "Posted by". */
function usePeople() {
  const { supabase, company } = useApp();
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!company) return;
    let live = true;
    supabase.rpc("member_list", { p_company: company.id }).then(({ data }) => {
      if (live && Array.isArray(data)) setPeople(new Map((data as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email])));
    });
    return () => {
      live = false;
    };
  }, [supabase, company]);
  return people;
}

const typeLabel = (c: Cancellation) => (c.source === "logbook" ? "Logbook" : c.type === "local" ? "Local sale" : "Export");
const canEntry = (c: Cancellation) => (c.type === "local" ? c.cancel_cusdec : c.exp_cusdec) ?? "";

export default function TiepLedgerView() {
  const { cancels, lines, batches, perm, loading } = useTiep();
  const people = usePeople();
  const [q, setQ] = useState("");
  const [ty, setTy] = useState("");
  const [st, setSt] = useState("");
  const [upd, setUpd] = useState<string | null>(null);
  const [rev, setRev] = useState<Cancellation | null>(null);

  const lineOf = useMemo(() => new Map(lines.map((r) => [r.key, r])), [lines]);
  const batchOf = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cancels
      .filter((c) => {
        if (ty === "logbook" ? c.source !== "logbook" : ty && (c.source === "logbook" || c.type !== ty)) return false;
        if (st && c.status !== st) return false;
        if (!s) return true;
        const r = lineOf.get(lineKey(c.cusdec_no, c.invoice_no, c.item_no));
        return [c.ref, c.exp_inv, c.exp_cusdec, c.cancel_cusdec, c.product, c.grp, c.cusdec_no, r?.id, c.batch_id && batchOf.get(c.batch_id)?.name]
          .join(" ")
          .toLowerCase()
          .includes(s);
      })
      .sort(
        (a, b) =>
          (b.posting_date ?? "").localeCompare(a.posting_date ?? "") ||
          b.ref.localeCompare(a.ref) ||
          a.seq - b.seq,
      );
  }, [cancels, q, ty, st, lineOf, batchOf]);

  const refs = new Set(rows.map((c) => c.ref));

  function csv() {
    const out: (string | number | null)[][] = [
      ["Ref", "Type", "Status", "Date", "Export invoice / batch", "Export CusDec / cancellation entry", "Import line", "Import CusDec", "Item",
        "Qty", "UOM", "Liability (LKR)", "Posted by", "Remarks"],
    ];
    for (const c of rows) {
      const r = lineOf.get(lineKey(c.cusdec_no, c.invoice_no, c.item_no));
      out.push([c.ref, typeLabel(c), c.status, c.type === "local" ? c.cancel_date ?? c.posting_date : c.posting_date,
        c.type === "local" ? (c.batch_id ? batchOf.get(c.batch_id)?.name : c.product) ?? "" : c.exp_inv, canEntry(c), r?.id ?? "",
        c.cusdec_no, c.item ?? c.grp, r4(c.qty), c.uom, Math.round(c.duty ?? allocLiab(r, c.qty)),
        c.posted_by ? people.get(c.posted_by) ?? "" : c.source === "logbook" ? "TIEP logbook" : "", c.remarks]);
    }
    downloadCsv(`TIEP_Cancellation_Ledger_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
  }

  const canAct = perm.ledger.edit || perm.ledger.delete;

  return (
    <>
      <div className="bar">
        <label className="field">
          Search
          <input className="control min-w-[240px]" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ref, invoice, CusDec, batch, line" />
        </label>
        <label className="field">
          Type
          <select className="control" value={ty} onChange={(e) => setTy(e.target.value)}>
            <option value="">All</option>
            <option value="export">Export</option>
            <option value="local">Local sale</option>
            <option value="logbook">Logbook</option>
          </select>
        </label>
        <label className="field">
          Status
          <select className="control" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="">All</option>
            <option>Completed</option>
            <option>Planned</option>
          </select>
        </label>
        <span className="flex-1" />
        <button className="btn" type="button" onClick={csv}>
          Download CSV
        </button>
      </div>

      <div className="scroll max-h-[70vh]">
        <table className="tbl">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Type</th>
              <th>Status</th>
              <th>Date</th>
              <th>Export invoice / batch</th>
              <th>Export CusDec / cancellation entry</th>
              <th>Import line</th>
              <th>Import CusDec</th>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>UOM</th>
              <th className="num">Liability (LKR)</th>
              <th>Posted by</th>
              <th>Remarks</th>
              {canAct && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading && !cancels.length ? (
              <tr>
                <td colSpan={15} className="note">
                  Loading…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={15} className="note">
                  {cancels.length ? "No postings match." : "No cancellations posted yet. Use TIEP Status › Post Cancellation to record the first one."}
                </td>
              </tr>
            ) : (
              rows.map((c) => {
                const r = lineOf.get(lineKey(c.cusdec_no, c.invoice_no, c.item_no));
                const local = c.type === "local";
                const before = !local && c.posting_date && r?.date && c.posting_date < r.date;
                return (
                  <tr key={c.id}>
                    <td className="font-mono">{c.ref}</td>
                    <td>{typeLabel(c)}</td>
                    <td>
                      <PostingChip status={c.status} />
                    </td>
                    <td>{fdate(local && c.cancel_date ? c.cancel_date : c.posting_date)}</td>
                    <td>
                      {local ? (c.batch_id ? batchOf.get(c.batch_id)?.name : c.product) : c.exp_inv}
                      {before && (
                        <span className="chip chip-bad ml-1" title="Export dated before the import">
                          Before import
                        </span>
                      )}
                    </td>
                    <td>{canEntry(c) || <span className="chip chip-open">To be raised</span>}</td>
                    <td className="font-mono">{r?.id ?? <span className="chip chip-bad">Not in register</span>}</td>
                    <td>
                      {c.cusdec_no}
                      {r?.date ? " · " + fdate(r.date) : ""}
                    </td>
                    <td className="whitespace-normal min-w-[200px]">{c.item || c.grp}</td>
                    <td className="num">{n2(c.qty)}</td>
                    <td>{c.uom}</td>
                    <td className="num">{n0(c.duty ?? allocLiab(r, c.qty))}</td>
                    <td>{c.posted_by ? people.get(c.posted_by) ?? "A member" : c.source === "logbook" ? "TIEP logbook" : ""}</td>
                    <td className="whitespace-normal min-w-[160px]">{c.remarks}</td>
                    {canAct && (
                      <td>
                        {c.source !== "logbook" && (
                          <div className="flex gap-1.5">
                            {perm.ledger.edit && (
                              <button className="btn py-0" type="button" onClick={() => setUpd(c.ref)}>
                                Update
                              </button>
                            )}
                            {perm.ledger.delete && (
                              <button className="btn btn-danger py-0" type="button" onClick={() => setRev(c)}>
                                Reverse
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        {rows.length} ledger rows across {refs.size} cancellation reference{refs.size === 1 ? "" : "s"}. Each posting has
        one row per import line it draws on. Local-sale postings show the customs entry raised for the duty payment once
        it is entered. Logbook rows come from the TIEP logbook and cannot be changed here.
      </div>

      {upd && <UpdateRefDialog refName={upd} onClose={() => setUpd(null)} />}
      {rev && <ReverseDialog row={rev} onClose={() => setRev(null)} />}
    </>
  );
}

function UpdateRefDialog({ refName, onClose }: { refName: string; onClose: () => void }) {
  const { supabase, company, flash } = useApp();
  const { cancels, reload } = useTiep();
  const list = cancels.filter((c) => c.ref === refName && c.source !== "logbook");
  const c = list[0];
  const local = c?.type === "local";
  const [cd, setCd] = useState(c ? canEntry(c) : "");
  const [date, setDate] = useState((local ? c?.cancel_date : c?.posting_date) ?? "");
  const [status, setStatus] = useState(c?.status ?? "Completed");
  const [rem, setRem] = useState(c?.remarks ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!c) return null;

  async function save() {
    if (!company) return;
    setBusy(true);
    const patch: Record<string, string> = { status, remarks: rem };
    if (local) {
      patch.cancel_cusdec = cd;
      patch.cancel_date = date;
    } else {
      patch.exp_cusdec = cd;
      if (date) patch.posting_date = date;
    }
    const { data, error } = await supabase.rpc("tiep_update_ref", { p_company: company.id, p_ref: refName, p_patch: patch });
    setBusy(false);
    if (error) {
      setMsg("Could not save: " + error.message);
      return;
    }
    flash(`${refName}: ${data} row${data === 1 ? "" : "s"} updated.`);
    onClose();
    await reload();
  }

  return (
    <Modal
      title={`Update ${refName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        <label className="field">
          {local ? "Cancellation customs entry no." : "Export CusDec no."}
          <input className="control" value={cd} onChange={(e) => setCd(e.target.value)} />
        </label>
        <label className="field">
          {local ? "Customs entry date" : "Cancellation date"}
          <input className="control" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Status
          <select className="control" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option>Planned</option>
            <option>Completed</option>
          </select>
        </label>
        <label className="field col-span-full">
          Remarks
          <textarea className="control" rows={2} value={rem} onChange={(e) => setRem(e.target.value)} />
        </label>
      </div>
      <div className="msg">Applies to all {list.length} ledger rows of {refName}.</div>
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}

function ReverseDialog({ row: c, onClose }: { row: Cancellation; onClose: () => void }) {
  const { supabase, company, flash } = useApp();
  const { cancels, reload } = useTiep();
  const sib = cancels.filter((x) => x.ref === c.ref && x.source !== "logbook");
  const [busy, setBusy] = useState(false);

  async function run(one: boolean) {
    if (!company) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("tiep_reverse", { p_company: company.id, p_ref: c.ref, p_id: one ? c.id : null });
    setBusy(false);
    if (error) {
      flash("Could not reverse: " + error.message, true);
      return;
    }
    flash(`Reversed ${data} ledger row${data === 1 ? "" : "s"} of ${c.ref}.`);
    onClose();
    await reload();
  }

  return (
    <Modal
      title={`Reverse ${c.ref}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Keep it
          </button>
          {sib.length > 1 && (
            <button className="btn" type="button" disabled={busy} onClick={() => void run(true)}>
              Reverse this row only
            </button>
          )}
          <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void run(false)}>
            Reverse {sib.length > 1 ? "whole posting" : "row"}
          </button>
        </>
      }
    >
      <p className="m-0">
        This deletes{" "}
        {sib.length > 1
          ? `all ${sib.length} ledger rows of ${c.ref}${c.exp_inv ? ` (export invoice ${c.exp_inv})` : ""}`
          : `this ledger row (CusDec ${c.cusdec_no} item ${c.item_no}, ${n2(c.qty)} ${c.uom ?? ""})`}
        . The quantities go back to the open balance of each import line. It can be undone from the Log.
      </p>
    </Modal>
  );
}
