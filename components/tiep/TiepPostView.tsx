"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { n2 } from "./ui";
import { allocate, fdate, materials, openLines, r4 } from "@/lib/tiep/model";

const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Form {
  type: "export" | "local";
  status: "Completed" | "Planned";
  batch: string;
  cancelCd: string;
  date: string;
  inv: string;
  cd: string;
  prod: string;
  expQty: string;
  ratio: string;
  mat: string;
  qty: string;
  qtyManual: boolean;
  mode: "fifo" | "line";
  line: string;
  rem: string;
}

const EMPTY: Form = {
  type: "export",
  status: "Completed",
  batch: "",
  cancelCd: "",
  date: "",
  inv: "",
  cd: "",
  prod: "",
  expQty: "",
  ratio: "",
  mat: "",
  qty: "",
  qtyManual: false,
  mode: "fifo",
  line: "",
  rem: "",
};

/** TIEP Status › Post Cancellation: cancel import quantities against an export or a local sale. */
export default function TiepPostView() {
  const { supabase, company, flash } = useApp();
  const { lines, batches, perm, reload } = useTiep();
  const [f, setF] = useState<Form>(EMPTY);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const local = f.type === "local";

  const mats = useMemo(() => materials(lines), [lines]);
  const open = useMemo(() => openLines(lines, f.mat), [lines, f.mat]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((s) => {
      const n = { ...s, [k]: v };
      // Qty to cancel follows export qty × ratio until typed over.
      if ((k === "expQty" || k === "ratio") && !n.qtyManual) {
        const e = Number(n.expQty);
        const r = Number(n.ratio);
        if (e > 0 && r > 0) n.qty = String(r4(e * r));
      }
      if (k === "qty") n.qtyManual = String(v) !== "";
      return n;
    });

  const preview = useMemo(() => {
    const msg: string[] = [];
    const q = r4(Number(f.qty) || 0);
    if (!f.date) msg.push("Enter the cancellation date.");
    if (!local && !f.inv.trim()) msg.push("Enter the export invoice number.");
    if (!f.mat) msg.push("Choose the import material to cancel.");
    if (!(q > 0)) msg.push("Enter a quantity to cancel above zero.");
    if (f.mode === "line" && f.mat && !open.some((r) => r.key === f.line)) msg.push("Choose an open import line.");
    const p = allocate(open, q, f.mode, f.line);
    if (q > 0 && p.left > 0)
      msg.push(
        `Only ${nf2.format(r4(q - p.left))} is free on the selected line(s); ${nf2.format(p.left)} cannot be allocated. Lines with import details pending are skipped until their quantity is entered.`,
      );
    return { ...p, msg, ok: !msg.length && p.alloc.length > 0 };
  }, [f, open, local]);

  async function post(e: FormEvent) {
    e.preventDefault();
    setShown(true);
    if (!preview.ok || !company) return;
    setBusy(true);
    const b = local && f.batch ? batches.find((x) => x.id === f.batch) : undefined;
    const head = {
      type: f.type,
      status: f.status,
      posting_date: f.date,
      exp_qty: f.expQty,
      ratio: f.ratio,
      remarks: f.rem,
      mode: f.mode,
      ...(local
        ? { batch_id: b?.id ?? "", cancel_cusdec: f.cancelCd, product: "Local sales" + (b ? " – " + b.name : "") }
        : { exp_inv: f.inv, exp_cusdec: f.cd, product: f.prod }),
    };
    const allocs = preview.alloc.map((a) => ({ cusdec_no: a.line.cusdec, invoice_no: a.line.inv, item_no: a.line.item, qty: a.take }));
    const { data, error } = await supabase.rpc("tiep_post_cancellation", { p_company: company.id, p_head: head, p_allocs: allocs });
    setBusy(false);
    if (error) {
      flash("Nothing was posted: " + error.message, true);
      return;
    }
    flash(
      `${data} posted: ${nf2.format(preview.q)} ${preview.alloc[0].line.uom} across ${allocs.length} import line${allocs.length === 1 ? "" : "s"}.`,
    );
    setF({ ...EMPTY, type: f.type, status: f.status, date: f.date, mat: f.mat });
    setShown(false);
    await reload();
  }

  if (!perm.post.edit)
    return <div className="panel note">Posting a cancellation needs edit permission on TIEP Status.</div>;

  return (
    <>
      <form className="panel" onSubmit={post} noValidate>
        <h2 className="text-[15px] font-semibold m-0">Post a cancellation</h2>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          <label className="field">
            Cancellation type
            <select className="control" value={f.type} onChange={(e) => set("type", e.target.value as Form["type"])}>
              <option value="export">Export (TIEP cancellation)</option>
              <option value="local">Local sale (duty payment)</option>
            </select>
          </label>
          <label className="field">
            Status
            <select className="control" value={f.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
              <option>Completed</option>
              <option>Planned</option>
            </select>
          </label>
          {local && (
            <>
              <label className="field">
                Local-sales batch
                <select className="control" value={f.batch} onChange={(e) => set("batch", e.target.value)}>
                  <option value="">No batch (one-off local sale)</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Cancellation customs entry no.
                <input className="control" value={f.cancelCd} onChange={(e) => set("cancelCd", e.target.value)} placeholder="Leave blank until raised" />
              </label>
            </>
          )}
          <label className="field">
            Cancellation date
            <input className="control" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
          </label>
          {!local && (
            <>
              <label className="field">
                Export invoice no.
                <input className="control" value={f.inv} onChange={(e) => set("inv", e.target.value)} placeholder="e.g. EXP/2026/0145" />
              </label>
              <label className="field">
                Export CusDec no.
                <input className="control" value={f.cd} onChange={(e) => set("cd", e.target.value)} placeholder="e.g. E 12345" />
              </label>
              <label className="field">
                Product exported
                <input className="control" value={f.prod} onChange={(e) => set("prod", e.target.value)} placeholder="e.g. Frozen barramundi fillets" />
              </label>
            </>
          )}
          <label className="field">
            {local ? "Local sold qty (kg)" : "Export qty (kg)"}
            <input className="control" type="number" min="0" step="any" value={f.expQty} onChange={(e) => set("expQty", e.target.value)} />
          </label>
          <label className="field">
            Conversion ratio (input per kg of fish)
            <input className="control" type="number" min="0" step="any" value={f.ratio} onChange={(e) => set("ratio", e.target.value)} />
          </label>
          <label className="field">
            Import material to cancel
            <select className="control" value={f.mat} onChange={(e) => set("mat", e.target.value)}>
              <option value="">Choose material</option>
              {mats.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.prod} ({m.uom}) · {nf2.format(m.bal)} open on {m.n} lines
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Qty to cancel
            <input className="control" type="number" min="0" step="any" value={f.qty} onChange={(e) => set("qty", e.target.value)} />
          </label>
          <label className="field">
            Allocation
            <select className="control" value={f.mode} onChange={(e) => set("mode", e.target.value as Form["mode"])}>
              <option value="fifo">FIFO: oldest open lines first</option>
              <option value="line">One specific import line</option>
            </select>
          </label>
          {f.mode === "line" && (
            <label className="field">
              Import line
              <select className="control" value={f.line} onChange={(e) => set("line", e.target.value)}>
                <option value="">{open.length ? "Choose a line" : "No open lines"}</option>
                {open.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.id} · {r.cusdec} · {fdate(r.date)} · bal {nf2.format(r.bal ?? 0)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field col-span-full">
            Remarks
            <textarea className="control" rows={2} value={f.rem} onChange={(e) => set("rem", e.target.value)} />
          </label>
        </div>
        <div className="msg">
          {local
            ? "Local sale: qty to cancel = local sold qty × conversion ratio. Pick the batch; its cancellation customs entry can be added later."
            : "Qty to cancel fills in as export qty × conversion ratio. You can overwrite it."}
        </div>
        <div className="bar">
          <button className="btn" type="button" onClick={() => setShown(true)}>
            Preview allocation
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy || !shown || !preview.ok}>
            {busy ? "Posting…" : "Post cancellation"}
          </button>
        </div>
      </form>

      {shown && (
        <div className="panel">
          <h2 className="text-[15px] font-semibold m-0">Allocation preview</h2>
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Import line</th>
                  <th>CusDec</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="num">Balance before</th>
                  <th className="num">Cancel now</th>
                  <th className="num">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {preview.alloc.length ? (
                  preview.alloc.map((a) => (
                    <tr key={a.line.key}>
                      <td className="font-mono">{a.line.id}</td>
                      <td>{a.line.cusdec}</td>
                      <td>{fdate(a.line.date)}</td>
                      <td className="whitespace-normal min-w-[220px]">{a.line.desc}</td>
                      <td className="num">{n2(a.line.bal)}</td>
                      <td className="num">{n2(a.take)}</td>
                      <td className="num">{n2(r4((a.line.bal ?? 0) - a.take))}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="note">
                      Nothing to allocate yet.
                    </td>
                  </tr>
                )}
                {preview.alloc.length > 0 && (
                  <tr className="total">
                    <td colSpan={5}>
                      Total across {preview.alloc.length} line{preview.alloc.length === 1 ? "" : "s"}
                    </td>
                    <td className="num">{n2(preview.alloc.reduce((a, x) => a + x.take, 0))}</td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {preview.ok ? (
            <p className="note m-0">
              Check the split, then post. Each import line becomes one ledger row under the same reference, with status{" "}
              {f.status}. The database checks every balance again when you post.
            </p>
          ) : (
            <div className="msg msg-err">{preview.msg.join(" ")}</div>
          )}
        </div>
      )}
    </>
  );
}
