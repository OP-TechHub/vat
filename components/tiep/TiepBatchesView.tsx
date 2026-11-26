"use client";

import { Fragment, useMemo, useState } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { Modal, PostingChip, n0, n2 } from "./ui";
import { fdate, lineKey, type Batch, type Cancellation } from "@/lib/tiep/model";

const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

/** A duty-paid stock line of a batch (tiep_batches.duty_paid_lines), as moved from the TIEP app. */
interface DutyPaidLine {
  item?: string;
  cusdec?: string;
  date?: string;
  qty?: number | string;
  ratioText?: string;
  ratio_text?: string;
  uom?: string;
  importId?: string;
  import_id?: string;
  cusdec_no?: string;
  invoice_no?: string;
  item_no?: number;
}
type BatchRow = Batch & { duty_paid_lines?: DutyPaidLine[] | null };

/** Batches in name order by their number (Batch 2 before Batch 10). */
const nameNo = (b: Batch) => parseInt(String(b.name).replace(/\D/g, "")) || 0;
/** Customs entry of a posting: the cancellation customs entry of a local sale, the export CusDec of an export. */
const canKey = (c: Cancellation) => (c.type === "local" ? c.cancel_cusdec : c.exp_cusdec) ?? "";

export default function TiepBatchesView() {
  const { batches, cancels, lines, lineOf, perm, loading } = useTiep();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<BatchRow | "new" | null>(null);

  const bs = useMemo(() => [...(batches as BatchRow[])].sort((a, b) => nameNo(a) - nameNo(b)), [batches]);
  const lineIdOf = useMemo(() => new Map(lines.map((r) => [r.id, r])), [lines]);
  const keyOf = (c: Cancellation) => lineKey(c.cusdec_no, c.invoice_no, c.item_no);
  const linesOf = useMemo(() => {
    const m = new Map<string, Cancellation[]>();
    for (const c of cancels) {
      if (c.source === "logbook") continue;
      const l = m.get(c.ref) ?? [];
      l.push(c);
      m.set(c.ref, l);
    }
    for (const l of m.values())
      l.sort((a, b) => String(lineOf.get(keyOf(a))?.id ?? keyOf(a)).localeCompare(String(lineOf.get(keyOf(b))?.id ?? keyOf(b))));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancels, lineOf]);
  // "Entry 1", "Entry 2"… for postings whose customs entry is not raised yet, oldest first.
  const entLab = useMemo(() => {
    const refs = new Map<string, string>();
    for (const c of cancels) {
      if (c.source === "logbook" || canKey(c)) continue;
      const d = c.posting_date ?? "";
      const r = refs.get(c.ref);
      if (r == null || d < r) refs.set(c.ref, d);
    }
    const lab = new Map<string, string>();
    [...refs.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).forEach(([ref], i) => lab.set(ref, "Entry " + (i + 1)));
    return lab;
  }, [cancels]);

  const dpOf = (b: BatchRow) => (Array.isArray(b.duty_paid_lines) ? b.duty_paid_lines : []);
  /** Register line of a duty-paid line, by its key or its IMP id. */
  const dpLine = (x: DutyPaidLine) =>
    x.cusdec_no ? lineOf.get(lineKey(x.cusdec_no, x.invoice_no, x.item_no)) : lineIdOf.get(x.importId ?? x.import_id ?? "");

  let tSold = 0,
    tDuty = 0,
    tDp = 0;
  const calc = bs.map((b) => {
    const ls = linesOf.get(b.ref) ?? [];
    const dp = dpOf(b);
    const dpKg = dp.reduce((a, x) => a + num(x.qty), 0);
    const duty = num(b.duty_amount) || ls.reduce((a, c) => a + num(c.duty), 0);
    tSold += num(b.sold_qty);
    tDuty += duty;
    tDp += dpKg;
    return { b, ls, dp, dpKg, duty };
  });
  const paid = bs.filter((b) => b.status === "Duty paid").length;
  const noRef = bs.filter((b) => !b.cancel_cusdec).length;
  const canEdit = perm.batches.edit;

  function toggle(id: string) {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Local sales batches: duty payment cancellations</h2>
      <p className="note m-0">
        Fish sold locally uses TIEP raw materials, so their duty is paid through a customs entry. That entry number is the
        cancellation reference; enter it with Edit once it is raised. Click a batch to see the raw materials and the import
        entries they come from.
      </p>
      <div className="bar">
        <span className="note self-center">
          {bs.length} batches · {paid} duty paid · {bs.length - paid} pending · {noRef} without a cancellation customs entry yet
        </span>
        <span className="flex-1" />
        <button className="btn" type="button" onClick={() => setOpen(new Set(bs.map((b) => b.id)))}>
          Expand all
        </button>
        <button className="btn" type="button" onClick={() => setOpen(new Set())}>
          Collapse all
        </button>
        {canEdit && (
          <button className="btn btn-primary" type="button" onClick={() => setEdit("new")}>
            Add batch
          </button>
        )}
      </div>
      <div className="scroll max-h-[70vh]">
        <table className="tbl">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Harvest start</th>
              <th>Harvest completed</th>
              <th className="num">Local sold (kg)</th>
              <th className="num">TIEP lines</th>
              <th className="num">Duty-paid stock used (kg)</th>
              <th className="num">Duty (LKR)</th>
              <th>Status</th>
              <th>Cancellation customs entry</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && !bs.length ? (
              <tr>
                <td colSpan={10} className="note">
                  Loading…
                </td>
              </tr>
            ) : !bs.length ? (
              <tr>
                <td colSpan={10} className="note">
                  No local-sales batches yet.{canEdit ? " Use Add batch to create one." : ""}
                </td>
              </tr>
            ) : (
              calc.map(({ b, ls, dp, dpKg, duty }) => {
                const isOpen = open.has(b.id);
                const lab = entLab.get(b.ref);
                return (
                  <Fragment key={b.id}>
                    <tr
                      className="clickable"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(b.id)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          toggle(b.id);
                        }
                      }}
                    >
                      <td>
                        <span className="inline-block w-4 text-accent font-bold" aria-hidden>
                          {isOpen ? "−" : "+"}
                        </span>
                        {b.name}
                      </td>
                      <td>{b.start_date ? fdate(b.start_date) : "?"}</td>
                      <td>{b.end_date ? fdate(b.end_date) : "?"}</td>
                      <td className="num">{b.sold_qty ? n2(num(b.sold_qty)) : "?"}</td>
                      <td className="num">{ls.length || "–"}</td>
                      <td className="num">{n2(dpKg)}</td>
                      <td className="num">{duty ? n0(duty) : "To calculate"}</td>
                      <td>
                        {b.status === "Duty paid" ? (
                          <span className="chip chip-done">Duty paid</span>
                        ) : (
                          <span className="chip chip-plan">{b.status || "Pending duty payment"}</span>
                        )}
                      </td>
                      <td>
                        {b.cancel_cusdec ? (
                          b.cancel_cusdec + (b.cancel_date ? " · " + fdate(b.cancel_date) : "")
                        ) : (
                          <span className="chip chip-open">{ls.length && lab ? lab + " · to be raised" : "To be raised"}</span>
                        )}
                      </td>
                      <td>
                        {canEdit && (
                          <button
                            className="btn py-0"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEdit(b);
                            }}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <>
                        <tr className="sub">
                          <td className="font-semibold">Raw material</td>
                          <td className="font-semibold">Treatment</td>
                          <td className="font-semibold">Import CusDec · date</td>
                          <td className="num font-semibold">Qty</td>
                          <td className="num font-semibold">Ratio</td>
                          <td className="num font-semibold">UOM</td>
                          <td className="num font-semibold">Duty (LKR)</td>
                          <td className="font-semibold">Import value (USD)</td>
                          <td className="font-semibold">Import line</td>
                          <td></td>
                        </tr>
                        {!ls.length && !dp.length && (
                          <tr className="sub">
                            <td colSpan={10} className="whitespace-normal">
                              No raw-material lines yet. Use TIEP Status › Post cancellation, choose &quot;Local sale&quot; and this
                              batch, to add them.
                            </td>
                          </tr>
                        )}
                        {ls.map((c) => {
                          const r = lineOf.get(keyOf(c));
                          return (
                            <tr key={c.id} className="sub">
                              <td className="whitespace-normal min-w-[180px]">{c.item || c.grp}</td>
                              <td>
                                TIEP · <PostingChip status={c.status} />
                              </td>
                              <td>
                                {r?.cusdec ?? c.cusdec_no}
                                {r?.date ? " · " + fdate(r.date) : ""}
                                {r?.pending && <span className="chip chip-pend ml-1">Details pending</span>}
                              </td>
                              <td className="num">{n2(num(c.qty))}</td>
                              <td className="num">{c.ratio_text || c.ratio || ""}</td>
                              <td className="num">{c.uom}</td>
                              <td className="num">{n0(num(c.duty))}</td>
                              <td>{c.value_usd ? nf2.format(num(c.value_usd)) : "–"}</td>
                              <td className="font-mono">{r?.id ?? <span className="chip chip-bad">Not in register</span>}</td>
                              <td></td>
                            </tr>
                          );
                        })}
                        {dp.map((x, i) => {
                          const r = dpLine(x);
                          const id = r?.id ?? x.importId ?? x.import_id;
                          return (
                            <tr key={"dp" + i} className="sub">
                              <td className="whitespace-normal min-w-[180px]">{x.item}</td>
                              <td>
                                <span className="chip">Duty-paid stock</span>
                              </td>
                              <td>
                                {x.cusdec ?? x.cusdec_no}
                                {x.date ? " · " + fdate(x.date) : ""}
                              </td>
                              <td className="num">{n2(num(x.qty))}</td>
                              <td className="num">{x.ratioText ?? x.ratio_text ?? ""}</td>
                              <td className="num">{x.uom || "KGM"}</td>
                              <td className="num">–</td>
                              <td>–</td>
                              <td className="font-mono">{id || "Not in register"}</td>
                              <td></td>
                            </tr>
                          );
                        })}
                        {b.notes && (
                          <tr className="sub">
                            <td colSpan={10} className="whitespace-normal">
                              {b.notes}
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              })
            )}
            {bs.length > 0 && (
              <tr className="total">
                <td>Total</td>
                <td></td>
                <td></td>
                <td className="num">{n2(tSold)}</td>
                <td></td>
                <td className="num">{n2(tDp)}</td>
                <td className="num">{n0(tDuty)}</td>
                <td colSpan={3}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note m-0">
        Raw-material lines are the local-sale cancellation postings with the batch&apos;s reference. Duty-paid stock lines
        came with the batch from the TIEP app (Batch_Wise_Local_Sales_Duty_Calculation.xlsx). Import entries it names that
        were added with details pending can be completed on the TIEP Register.
      </p>

      {edit && (
        <BatchDialog
          batch={edit === "new" ? null : edit}
          lineCount={edit === "new" ? 0 : (linesOf.get(edit.ref) ?? []).length}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function BatchDialog({ batch: b, lineCount, onClose }: { batch: BatchRow | null; lineCount: number; onClose: () => void }) {
  const { supabase, company, flash } = useApp();
  const { reload } = useTiep();
  const [f, setF] = useState({
    name: b?.name ?? "",
    start_date: b?.start_date ?? "",
    end_date: b?.end_date ?? "",
    sold_qty: b?.sold_qty ? String(b.sold_qty) : "",
    duty_amount: b?.duty_amount ? String(b.duty_amount) : "",
    status: b?.status ?? "Pending duty payment",
    cancel_cusdec: b?.cancel_cusdec ?? "",
    cancel_date: b?.cancel_date ?? "",
    notes: b?.notes ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    if (!company) return;
    if (!f.name.trim()) {
      setMsg("Enter the batch name.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc("tiep_save_batch", {
      p_company: company.id,
      p_id: b?.id ?? null,
      p_batch: {
        name: f.name.trim(),
        start_date: f.start_date,
        end_date: f.end_date,
        sold_qty: num(f.sold_qty) || null,
        duty_amount: num(f.duty_amount) || null,
        status: f.status,
        cancel_cusdec: f.cancel_cusdec.trim(),
        cancel_date: f.cancel_date,
        notes: f.notes.trim(),
      },
    });
    setBusy(false);
    if (error) {
      setMsg("Could not save: " + error.message);
      return;
    }
    flash(`${f.name.trim()} ${b ? "saved" : "added"}${lineCount ? ` and ${lineCount} line${lineCount === 1 ? "" : "s"} updated` : ""}.`);
    onClose();
    await reload();
  }

  return (
    <Modal
      title={b ? `Edit ${b.name}` : "Add local-sales batch"}
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
          Batch name
          <input className="control" value={f.name} onChange={set("name")} placeholder="e.g. Batch 12" />
        </label>
        <label className="field">
          Harvest start
          <input className="control" type="date" value={f.start_date} onChange={set("start_date")} />
        </label>
        <label className="field">
          Harvest completed
          <input className="control" type="date" value={f.end_date} onChange={set("end_date")} />
        </label>
        <label className="field">
          Local sold qty (kg)
          <input className="control" type="number" step="any" min="0" value={f.sold_qty} onChange={set("sold_qty")} />
        </label>
        <label className="field">
          Duty amount (LKR)
          <input className="control" type="number" step="any" min="0" value={f.duty_amount} onChange={set("duty_amount")} />
        </label>
        <label className="field">
          Status
          <select className="control" value={f.status} onChange={set("status")}>
            <option>Pending duty payment</option>
            <option>Duty paid</option>
          </select>
        </label>
        <label className="field">
          Cancellation customs entry no.
          <input className="control" value={f.cancel_cusdec} onChange={set("cancel_cusdec")} placeholder="Enter once raised" />
        </label>
        <label className="field">
          Customs entry date
          <input className="control" type="date" value={f.cancel_date} onChange={set("cancel_date")} />
        </label>
        <label className="field col-span-full">
          Notes
          <textarea className="control" rows={2} value={f.notes} onChange={set("notes")} />
        </label>
      </div>
      <div className="msg">
        {b ? (
          <>
            Saving copies the customs entry number to all {lineCount} raw-material line{lineCount === 1 ? "" : "s"} of {b.name}.
            &quot;Duty paid&quot; marks them Completed; &quot;Pending&quot; keeps them Planned.
          </>
        ) : (
          <>
            The batch gets its own cancellation reference. Add its raw materials on TIEP Status › Post cancellation, choosing
            &quot;Local sale&quot; and this batch.
          </>
        )}
      </div>
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}
