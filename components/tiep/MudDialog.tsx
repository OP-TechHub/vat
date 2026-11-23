"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { Modal, n2 } from "./ui";
import { fdate, skuIsConfirmed, stdFor, type TiepLine } from "@/lib/tiep/model";
import {
  fifoAlloc,
  liabOf,
  mudCands,
  mudCompute,
  mudRef,
  ownPlanned,
  skuFind,
  type AllocRow,
  type CalcInvoice,
  type Claim,
  type Mud,
  type MudDoc,
  type SavedClaim,
  type TiepGroup,
  type TiepInvoice,
} from "@/lib/tiep/invoices";
import { ensureInvoiceMud, saveInvoiceExt, updateMud, uploadTiepDoc } from "@/lib/tiep/actions";
import { mudFormHtml } from "@/lib/tiep/mudForm";

const fx = (v: number, d: number) => (isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

/** What a MUD is prepared for: one invoice or a group of invoices. */
export interface MudSubject {
  id: string;
  kind: "invoice" | "group";
  label: string;
  type: "Export" | "Local";
  date: string | null;
  calc: CalcInvoice;
  plBoxes: number;
  mud: Mud | undefined;
  exportE: string;
  invoice?: TiepInvoice;
  group?: TiepGroup;
}

export function subjectOfInvoice(v: TiepInvoice): MudSubject {
  return {
    id: v.inv.id,
    kind: "invoice",
    label: v.inv.invoice_no,
    type: v.inv.type,
    date: v.inv.invoice_date,
    calc: v.calc,
    plBoxes: Number(v.ext?.pl?.totBoxes ?? 0),
    mud: v.mud,
    exportE: v.exportE,
    invoice: v,
  };
}

export function subjectOfGroup(g: TiepGroup): MudSubject {
  return {
    id: g.mud.id,
    kind: "group",
    label: g.mud.group_name ?? "Group",
    type: g.mud.type,
    date: g.date,
    calc: g.calc,
    plBoxes: 0,
    mud: g.mud,
    exportE: (g.mud.mudx as { exportE?: string } | null)?.exportE ?? "",
    group: g,
  };
}

type EditClaim = Claim & { alloc: AllocRow[] };

export default function MudDialog({ subject: s, onClose }: { subject: MudSubject; onClose: () => void }) {
  const { supabase, company, user, flash } = useApp();
  const { lines, lineOf, cancels, standards, skus, proposals, mudConfig, perm, reload } = useTiep();
  const canEdit = (s.type === "Local" ? perm.local : perm.exports).edit;
  const status = s.mud?.status ?? "draft";
  const locked = status !== "draft";
  const st = stdFor(standards, s.date);
  const M = useMemo(() => mudCompute(s.calc, st, s.plBoxes), [s.calc, st, s.plBoxes]);
  const own = useMemo(() => ownPlanned(cancels, s.mud?.id ?? null), [cancels, s.mud]);

  // Starting allocation: saved claims, else the kept allocation, else FIFO after the invoices before it.
  const initial = (): EditClaim[] => {
    const saved = s.mud?.mud?.claims;
    const kept = s.mud?.prop_alloc;
    const used = new Map(proposals.usedBefore.get(s.id) ?? []);
    return M.claims.map((c) => {
      const sv = saved?.find((x) => x.label === c.label);
      if (locked && sv) return { ...c, alloc: sv.alloc.map((a) => ({ ...a })) };
      const k = kept?.find((x) => x.label === c.label);
      if (k) {
        const al = k.alloc.map((a) => ({ ...a }));
        for (const a of al) used.set(a.key, (used.get(a.key) ?? 0) + a.qty);
        return { ...c, alloc: al };
      }
      return { ...c, alloc: fifoAlloc(c, lines, own, s.date, used) };
    });
  };
  const [claims, setClaims] = useState<EditClaim[]>(initial);
  const [kept, setKept] = useState<boolean>(!!s.mud?.prop_alloc && !locked);
  const [exportE, setExportE] = useState(s.exportE);
  const [busy, setBusy] = useState(false);
  const [confirmLate, setConfirmLate] = useState(false);
  const [confirmShort, setConfirmShort] = useState(false);
  const [view, setView] = useState<"edit" | "form" | "writeoff">("edit");
  const [msg, setMsg] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mudIdRef = useRef<string | null>(s.mud?.id ?? null);

  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
  }, []);

  const ref = mudRef(mudConfig, s.label, s.mud);
  const cands = (c: Claim) => mudCands(c, lines, own, s.date);
  const late = (key: string) => {
    const r = lineOf.get(key);
    return !!(r && s.date && r.date && r.date > s.date);
  };
  const lateList = claims.flatMap((c) => c.alloc.filter((a) => a.key && a.qty > 0 && late(a.key)).map((a) => `${lineOf.get(a.key)?.cusdec} (${fdate(lineOf.get(a.key)?.date)}, ${c.label})`));
  const shortList = claims.filter((c) => Math.abs(c.alloc.reduce((t, a) => t + (a.qty || 0), 0) - c.req) > 1e-6);

  async function mudId(): Promise<string> {
    if (mudIdRef.current) return mudIdRef.current;
    if (!company || !s.invoice) throw new Error("No MUD row");
    mudIdRef.current = await ensureInvoiceMud(supabase, company.id, user.id, s.invoice.inv.id, s.type, s.mud);
    return mudIdRef.current;
  }

  /** Keep the edited allocation as this invoice's pending allocation; later invoices re-allocate around it. */
  function keepDraft(next: EditClaim[]) {
    if (!canEdit || locked || !company) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(async () => {
      try {
        const id = await mudId();
        const pa = next.map((c) => ({
          label: c.label,
          alloc: c.alloc.filter((a) => a.key && a.qty > 0).map((a) => ({ key: a.key, qty: a.qty, liab: +liabOf(a, lineOf).toFixed(2), liabSet: !!a.liabSet })),
        }));
        await updateMud(supabase, user.id, id, { prop_alloc: pa, prop_at: new Date().toISOString() });
        setKept(true);
        await reload();
      } catch (e) {
        flash("Could not keep the allocation: " + (e instanceof Error ? e.message : String(e)), true);
      }
    }, 900);
  }

  const edit = (ci: number, ai: number, patch: Partial<AllocRow>) => {
    const next = claims.map((c, i) => {
      if (i !== ci) return c;
      const alloc = c.alloc.length ? c.alloc.map((a) => ({ ...a })) : [{ key: "", qty: 0 }];
      const a = alloc[ai];
      Object.assign(a, patch);
      if ("key" in patch) {
        a.liabSet = false;
        if (!a.qty) a.qty = Math.max(0, c.req - alloc.reduce((t, x) => t + (x === a ? 0 : x.qty || 0), 0));
      }
      return { ...c, alloc };
    });
    setClaims(next);
    setConfirmLate(false);
    setConfirmShort(false);
    keepDraft(next);
  };
  const addRow = (ci: number) => setClaims((cs) => cs.map((c, i) => (i === ci ? { ...c, alloc: [...c.alloc.filter((a) => a.key || a.qty), { key: "", qty: 0 }] } : c)));
  const delRow = (ci: number, ai: number) => {
    const next = claims.map((c, i) => (i === ci ? { ...c, alloc: c.alloc.filter((_, j) => j !== ai) } : c));
    setClaims(next);
    keepDraft(next);
  };

  async function repropose() {
    setBusy(true);
    try {
      if (s.mud?.prop_alloc) {
        await updateMud(supabase, user.id, s.mud.id, { prop_alloc: null, prop_at: new Date().toISOString() });
        await reload();
      }
      const used = new Map(proposals.usedBefore.get(s.id) ?? []);
      setClaims(M.claims.map((c) => ({ ...c, alloc: fifoAlloc(c, lines, own, s.date, used) })));
      setKept(false);
    } catch (e) {
      flash("Could not re-propose: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusy(false);
  }

  /** Yield used for this invoice instead of the standard's: recalculates whole fish and the claims. */
  async function setYield(prod: string, val: number | null) {
    if (!company || !s.invoice) return;
    const y = { ...(s.invoice.ext?.yov ?? {}) };
    const ln = s.calc.lines.find((l) => l.status === "OK" && l.tiep === prod);
    const std = ln ? (ln.yov ? ln.yieldStd : ln.yield) : null;
    if (val == null || (std != null && Math.abs(val - std) < 1e-9)) delete y[prod];
    else y[prod] = val;
    setBusy(true);
    try {
      await saveInvoiceExt(supabase, company.id, user.id, s.invoice.inv.id, { yov: Object.keys(y).length ? y : null });
      if (s.mud?.prop_alloc) await updateMud(supabase, user.id, s.mud.id, { prop_alloc: null });
      flash(val == null ? `Yield for ${prod} reset to the standard.` : `Yield for ${prod} set to ${val} on ${s.label}: recalculated.`);
      onClose();
      await reload();
    } catch (e) {
      flash("Could not change the yield: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusy(false);
  }

  function rowsFor(cs: EditClaim[]) {
    return cs.flatMap((c) =>
      c.alloc
        .filter((a) => a.key && a.qty > 0)
        .map((a) => {
          const r = lineOf.get(a.key)!;
          return {
            cusdec_no: r.cusdec,
            invoice_no: r.inv,
            item_no: r.item,
            qty: a.qty,
            liab: +liabOf(a, lineOf).toFixed(2),
            label: c.label,
            hs: c.hs,
            ratio: c.basis === "boxes" ? 1 : c.per1000 / 1000,
            ratio_text: c.basis === "boxes" ? "1 per box" : String(c.per1000 / 1000),
          };
        }),
    );
  }

  function head(extra: Record<string, string> = {}) {
    const local = s.type === "Local";
    return {
      ref: "MUD-" + s.label,
      type: s.type,
      posting_date: s.date ?? "",
      exp_inv: s.label,
      exp_cusdec: local ? "" : exportE,
      cancel_cusdec: local ? exportE : "",
      cancel_date: local ? (s.date ?? "") : "",
      product: `MUD ${ref}${s.kind === "group" ? ` (${s.group?.members.length ?? 0} invoices)` : ""}`,
      exp_qty: String(M.qty),
      sales_invoice_id: s.invoice?.inv.id ?? "",
      ...extra,
    };
  }

  async function saveExportE(): Promise<boolean> {
    if (!company || exportE === s.exportE) return true;
    try {
      if (s.invoice) await saveInvoiceExt(supabase, company.id, user.id, s.invoice.inv.id, { export_e: exportE.trim() || null, export_e_src: "entered" });
      else if (s.mud) await updateMud(supabase, user.id, s.mud.id, { mudx: { ...(s.mud.mudx ?? {}), exportE: exportE.trim() } as Mud["mudx"] });
      return true;
    } catch (e) {
      setMsg("Could not save the E no.: " + (e instanceof Error ? e.message : String(e)));
      return false;
    }
  }

  async function save() {
    if (!company) return;
    setMsg(null);
    if (s.type === "Export" && !exportE.trim()) return setMsg("Enter the export CusDec (E no.) for this invoice first.");
    const over = new Set<string>();
    for (const c of claims) {
      const C = cands(c).all;
      for (const a of c.alloc) {
        const x = C.find((y) => y.line.key === a.key);
        if (x && a.qty > x.avail + 1e-6) over.add(x.line.cusdec);
      }
    }
    if (over.size) return setMsg(`More than the balance on ${[...over].join(", ")}.`);
    if (lateList.length && !confirmLate) {
      setConfirmLate(true);
      return setMsg(`Uses import entries dated after the invoice date: ${lateList.join("; ")}. Click Save again to save anyway.`);
    }
    if (shortList.length && !confirmShort) {
      setConfirmShort(true);
      return setMsg(`Allocation differs from the requirement for ${shortList.map((c) => c.label).join(", ")}. Click Save again to save anyway.`);
    }
    setBusy(true);
    try {
      if (!(await saveExportE())) return;
      const id = await mudId();
      const saved: SavedClaim[] = claims.map((c) => ({
        ...c,
        alloc: c.alloc.filter((a) => a.key && a.qty > 0).map((a) => ({ key: a.key, qty: a.qty, liab: +liabOf(a, lineOf).toFixed(2), liabSet: !!a.liabSet })),
      }));
      const doc: MudDoc = {
        ref,
        office: s.mud?.mudx?.office || mudConfig.office,
        product: s.mud?.mudx?.product || mudConfig.product,
        hs: s.mud?.mudx?.hs || mudConfig.hs,
        qty: M.qty,
        whole: M.whole,
        fcr: M.fcr,
        rows1: M.rows1,
        claims: saved,
        std: st?.id ?? "",
        exportE: exportE.trim(),
        savedAt: new Date().toISOString(),
        savedBy: user.id,
      };
      const { data, error } = await supabase.rpc("tiep_save_mud", { p_company: company.id, p_mud: id, p_doc: doc, p_head: head(), p_allocs: rowsFor(claims) });
      if (error) throw new Error(error.message);
      flash(`MUD saved: ${data} import line${data === 1 ? "" : "s"} reserved as Planned.`);
      onClose();
      await reload();
    } catch (e) {
      setMsg("Could not save the MUD: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!company || !s.mud) return;
    if (!window.confirm(`Withdraw the saved MUD ${ref}? The reserved import entries are released and the invoice goes back into the FIFO queue.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("tiep_withdraw_mud", { p_company: company.id, p_mud: s.mud.id });
    setBusy(false);
    if (error) return setMsg("Could not withdraw: " + error.message);
    flash(`MUD withdrawn: ${s.label} is back in the FIFO queue.`);
    onClose();
    await reload();
  }

  const unconfirmed = useMemo(() => {
    const u = new Set<string>();
    for (const l of s.calc.lines) {
      if (l.status !== "OK") continue;
      const sk = skuFind(skus, l.code, l.desc);
      if (!sk || !skuIsConfirmed(sk, skus)) u.add(l.tiep);
    }
    return u;
  }, [s.calc, skus]);

  const formHtml = () =>
    mudFormHtml({
      cfg: mudConfig,
      ref,
      office: s.mud?.mudx?.office || s.mud?.mud?.office || mudConfig.office,
      product: s.mud?.mudx?.product || mudConfig.product,
      hs: s.mud?.mudx?.hs || mudConfig.hs,
      exportE,
      date: s.date,
      rows1: locked && s.mud?.mud ? s.mud.mud.rows1 : M.rows1,
      unconfirmed,
      claims,
      lineOf,
    });

  if (view === "form") return <MudFormView html={formHtml()} title={`MUD form · ${s.label}`} unconfirmed={unconfirmed} lateList={lateList} missing={claims.filter((c) => !c.alloc.some((a) => a.key && a.qty > 0)).map((c) => c.label)} onBack={() => setView("edit")} onClose={onClose} />;
  if (view === "writeoff" && s.mud) return <WriteoffDialog subject={s} claims={claims} head={head} rowsFor={rowsFor} onBack={() => setView("edit")} onClose={onClose} />;

  let tq = 0;
  let tl = 0;
  return (
    <Modal
      title={`MUD · ${s.label} · ${ref}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={() => setView("form")}>
            View MUD form
          </button>
          {canEdit && status === "saved" && (
            <>
              <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void withdraw()}>
                Withdraw MUD
              </button>
              <button className="btn btn-primary" type="button" onClick={() => setView("writeoff")}>
                Record customs cancellation
              </button>
            </>
          )}
          {canEdit && !locked && (
            <>
              <button className="btn" type="button" disabled={busy} onClick={() => void repropose()}>
                Re-propose FIFO
              </button>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save MUD and reserve quantities"}
              </button>
            </>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="bar">
        <label className="field">
          {s.type === "Local" ? "Customs entry for the duty payment" : "Export CusDec (E no.)"}
          <input className="control w-[180px]" value={exportE} disabled={!canEdit || locked} onChange={(e) => setExportE(e.target.value)} onBlur={() => void saveExportE()} />
        </label>
        <div className="note pb-1.5">
          Date {fdate(s.date) || "—"} · standard {st ? st.short || st.name : <span className="text-bad">none for this date</span>} · FCR {M.fcr}
          {s.kind === "group" && ` · ${s.group?.members.length ?? 0} invoices`}
        </div>
      </div>
      {status === "saved" && (
        <div className="msg">
          🔒 <b>MUD saved{s.mud?.mud?.savedAt ? ` on ${fdate(s.mud.mud.savedAt.slice(0, 10))}` : ""}</b>: the import entries below are reserved
          (Planned) and locked until the customs cancellation is recorded. If customs rejects it, use <b>Withdraw MUD</b>.
        </div>
      )}
      {status === "cancelled" && <div className="msg">🔒 Cancelled with customs: this MUD is final.</div>}
      {kept && !locked && (
        <div className="msg">
          ✎ <b>Your allocation is kept as this invoice’s pending allocation</b> (not reserved yet). Later invoices are re-allocated FIFO around it. Use{" "}
          <b>Re-propose FIFO</b> to go back to the automatic allocation, or <b>Save MUD</b> to reserve it.
        </div>
      )}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Quantity (Kg)</th>
              <th className="num">Yield</th>
              <th className="num">Quantity in whole (Kg)</th>
              <th className="num">Conversion ratio</th>
              <th className="num">Raw materials utilized (Kg)</th>
            </tr>
          </thead>
          <tbody>
            {M.rows1.map((r) => {
              const ln = s.calc.lines.find((l) => l.status === "OK" && l.tiep === r.desc);
              const ed = canEdit && !locked && s.kind === "invoice";
              return (
                <tr key={r.desc} className={ln?.yov ? "bg-warn-soft" : undefined}>
                  <td>
                    {r.desc}
                    {unconfirmed.has(r.desc) && <span className="chip chip-bad ml-1">Not confirmed</span>}
                  </td>
                  <td className="num">{fx(r.qty, 2)}</td>
                  <td className="num">
                    {ed ? (
                      <input
                        className="control w-[80px] text-right"
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="1"
                        defaultValue={+r.yield.toFixed(4)}
                        disabled={busy}
                        title="Yield for this invoice: whole fish, raw materials and the claims are recalculated"
                        onBlur={(e) => {
                          let v = Number(e.target.value);
                          if (v > 1 && v <= 100) v = v / 100;
                          if (!(v > 0 && v <= 1)) return flash("Enter the yield as a fraction (0.40) or a percentage (40).", true);
                          if (Math.abs(v - r.yield) > 1e-9) void setYield(r.desc, +v.toFixed(4));
                        }}
                      />
                    ) : (
                      fx(r.yield, 2)
                    )}
                    {ln?.yov && ln.yieldStd != null && (
                      <div className="text-[11px] text-muted">
                        standard {fx(ln.yieldStd, 2)}
                        {ed && (
                          <button type="button" className="underline ml-1" onClick={() => void setYield(r.desc, null)}>
                            reset
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="num">{fx(r.whole, 2)}</td>
                  <td className="num">{fx(r.ratio, 2)}</td>
                  <td className="num">{fx(r.rm, 0)}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td>Total</td>
              <td className="num">{fx(M.qty, 2)}</td>
              <td></td>
              <td className="num">{fx(M.whole, 0)}</td>
              <td></td>
              <td className="num">{fx(M.whole * M.fcr, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!M.rows1.length && <div className="msg msg-err">No sales line of this invoice has a TIEP item with a yield in the standard: map its items in Settings › TIEP item master.</div>}

      <p className="note m-0">
        Quantities claimed are rounded to whole units (at least 1), as on the submitted MUD. Lines are proposed FIFO from open import lines of the same
        material; change the import line or quantity where the claim should come from another entry. Entries dated after the invoice date are never
        proposed and are flagged red if chosen. Liability = quantity × duty suspended per unit on that import CusDec.
      </p>
      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Item</th>
              <th>HS code</th>
              <th className="num">Required</th>
              <th>UOM</th>
              <th>Import CusDec / date (balance)</th>
              <th className="num">Quantity usage</th>
              <th className="num">Liability (LKR)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c, ci) => {
              const C = cands(c);
              const sum = c.alloc.reduce((t, a) => t + (a.qty || 0), 0);
              const rows = c.alloc.length ? c.alloc : [{ key: "", qty: 0 }];
              const can = canEdit && !locked;
              const left = c.req - sum;
              return rows.map((a, ai) => {
                const r: TiepLine | undefined = lineOf.get(a.key);
                const li = a.key ? liabOf(a, lineOf) : 0;
                tq += a.qty || 0;
                tl += li;
                const isLate = !!a.key && late(a.key);
                return (
                  <tr key={ci + "-" + ai} className={isLate ? "bg-bad-soft" : undefined}>
                    {ai === 0 && (
                      <>
                        <td rowSpan={rows.length}>
                          <b>{c.label}</b>
                          {Math.abs(left) > 1e-6 && <div className={"text-[11px] " + (left > 0 ? "text-bad" : "text-muted")}>{left > 0 ? `still to allocate ${fx(left, 2)}` : `over by ${fx(-left, 2)}`}</div>}
                          {can && (
                            <div>
                              <button className="btn py-0 mt-1 text-[12px]" type="button" onClick={() => addRow(ci)}>
                                + Add import line
                              </button>
                            </div>
                          )}
                        </td>
                        <td rowSpan={rows.length} className="font-mono">
                          {c.hs}
                        </td>
                        <td rowSpan={rows.length} className="num">
                          {fx(c.req, 0)}
                          <div className="text-[11px] text-muted">{c.basis === "boxes" ? "boxes" : fx(c.exact, 2)}</div>
                        </td>
                        <td rowSpan={rows.length}>{c.uom}</td>
                      </>
                    )}
                    <td className="whitespace-normal min-w-[280px]">
                      {can ? (
                        <select className="control max-w-[340px]" value={a.key} onChange={(e) => edit(ci, ai, { key: e.target.value })}>
                          <option value="">Choose import line…</option>
                          {C.all
                            .filter((x) => x.avail > 0 || x.line.key === a.key)
                            .map((x) => (
                              <option key={x.line.key} value={x.line.key}>
                                {x.late ? "⚠ " : ""}
                                {x.line.cusdec} · {fdate(x.line.date)} · {x.line.desc.slice(0, 28)} · bal {fx(x.avail, 2)} {x.line.uom}
                                {x.late ? " · AFTER INVOICE DATE" : ""}
                              </option>
                            ))}
                        </select>
                      ) : r ? (
                        `${r.cusdec} · ${fdate(r.date)}`
                      ) : (
                        <span className="text-bad">none</span>
                      )}
                      {isLate && r && <div className="chip chip-bad mt-1">Import dated {fdate(r.date)}, after the invoice date</div>}
                      {ai === 0 && !C.all.length && (
                        <div className="text-[11px] text-bad">
                          No {c.grp} import line in the register{c.kw ? ` (looking for “${c.kw}”)` : ""}
                        </div>
                      )}
                      {ai === 0 && C.all.length > 0 && !C.fifo.length && !a.key && (
                        <div className="text-[11px] text-bad">No open {c.kind || c.grp} line found automatically: choose the import line.</div>
                      )}
                    </td>
                    <td className="num">
                      {can ? (
                        <input className="control w-[100px] text-right" type="number" step="any" min="0" value={a.qty || ""} onChange={(e) => edit(ci, ai, { qty: Number(e.target.value) || 0 })} />
                      ) : (
                        n2(a.qty)
                      )}
                    </td>
                    <td className="num">
                      {can && a.key ? (
                        <>
                          <input
                            className="control w-[120px] text-right"
                            type="number"
                            step="any"
                            min="0"
                            placeholder={fx(liabOf({ ...a, liabSet: false }, lineOf), 2)}
                            value={a.liabSet ? (a.liab ?? "") : ""}
                            title="Leave as calculated, or type the amount to use"
                            onChange={(e) => edit(ci, ai, { liabSet: e.target.value.trim() !== "", liab: Number(e.target.value) || 0 })}
                          />
                          {a.liabSet && <div className="text-[11px] text-muted">calc. {fx(liabOf({ ...a, liabSet: false }, lineOf), 2)}</div>}
                        </>
                      ) : li ? (
                        fx(li, 2)
                      ) : (
                        "–"
                      )}
                    </td>
                    <td>
                      {can && rows.length > 1 && (
                        <button className="btn py-0" type="button" title="Remove this import line" onClick={() => delRow(ci, ai)}>
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              });
            })}
            <tr className="total">
              <td colSpan={5}>Total</td>
              <td className="num">{fx(tq, 0)}</td>
              <td className="num">{fx(tl, 2)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      {lateList.length > 0 && (
        <div className="msg msg-err">
          ⚠ Set off against import entries dated after the invoice date ({fdate(s.date)}): {lateList.join("; ")}. Raw materials cannot have been used before
          they were imported.
        </div>
      )}
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}

function MudFormView({
  html,
  title,
  unconfirmed,
  lateList,
  missing,
  onBack,
  onClose,
}: {
  html: string;
  title: string;
  unconfirmed: Set<string>;
  lateList: string[];
  missing: string[];
  onBack: () => void;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onBack}>
            Back
          </button>
          <button className="btn btn-primary" type="button" onClick={() => frame.current?.contentWindow?.print()}>
            Print / Save as PDF
          </button>
        </>
      }
    >
      {unconfirmed.size > 0 && (
        <div className="msg msg-err">
          Item mapping not confirmed in the TIEP item master for: {[...unconfirmed].join(", ")}. These lines print as NOT CONFIRMED; confirm the item nos.
          in Settings › Confirm export mapping.
        </div>
      )}
      {lateList.length > 0 && <div className="msg msg-err">⚠ Import entries dated after the invoice date: {lateList.join("; ")}.</div>}
      {missing.length > 0 && <div className="msg msg-err">No import entry chosen yet for: {missing.join(", ")}.</div>}
      <iframe ref={frame} title={title} srcDoc={html} className="w-full h-[70vh] border border-line rounded-md bg-white" />
    </Modal>
  );
}

function WriteoffDialog({
  subject: s,
  claims,
  head,
  rowsFor,
  onBack,
  onClose,
}: {
  subject: MudSubject;
  claims: EditClaim[];
  head: (extra?: Record<string, string>) => Record<string, string>;
  rowsFor: (cs: EditClaim[]) => unknown[];
  onBack: () => void;
  onClose: () => void;
}) {
  const { supabase, company, user, flash } = useApp();
  const { lines, lineOf, reload } = useTiep();
  type WLine = { ci: number; label: string; key: string; qtyMud: number; liabMud: number; qty: number; liab: number };
  const [rows, setRows] = useState<WLine[]>(() =>
    claims.flatMap((c, ci) =>
      c.alloc
        .filter((a) => a.key && a.qty > 0)
        .map((a) => {
          const l = liabOf(a, lineOf);
          return { ci, label: c.label, key: a.key, qtyMud: a.qty, liabMud: l, qty: a.qty, liab: +l.toFixed(2) };
        }),
    ),
  );
  const [date, setDate] = useState(s.mud?.writeoff?.date ?? "");
  const [total, setTotal] = useState(s.mud?.writeoff?.total ? String(s.mud.writeoff.total) : "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sum = rows.reduce((a, r) => a + (r.liab || 0), 0);
  const mudTot = rows.reduce((a, r) => a + r.liabMud, 0);
  const t = Number(total) || 0;

  async function save() {
    if (!company || !s.mud) return;
    if (!date) return setMsg("Enter the write-off note date.");
    setBusy(true);
    try {
      const doc = file ? await uploadTiepDoc(supabase, company.id, "muds", s.mud.id, "writeoff", file) : (s.mud.docs.writeoff ?? null);
      const wcl: EditClaim[] = claims.map((c, ci) => ({
        ...c,
        alloc: rows.filter((r) => r.ci === ci && r.key && r.qty > 0).map((r) => ({ key: r.key, qty: r.qty, liab: r.liab, liabSet: true })),
      }));
      const writeoff = {
        date,
        total: t,
        lines: wcl.flatMap((c) => c.alloc.map((a) => ({ label: c.label, ...a }))),
        recordedAt: new Date().toISOString(),
        by: user.id,
        doc,
      };
      const { data, error } = await supabase.rpc("tiep_record_writeoff", {
        p_company: company.id,
        p_mud: s.mud.id,
        p_writeoff: writeoff,
        p_head: head({ cancel_date: date, remarks: `Write-off note ${date}${t ? ` · Rs ${t}` : ""}` }),
        p_allocs: rowsFor(wcl),
      });
      if (error) throw new Error(error.message);
      flash(`Cancellation recorded: ${data} ledger line${data === 1 ? "" : "s"} Completed.`);
      onClose();
      await reload();
    } catch (e) {
      setMsg("Could not record the cancellation: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Record customs cancellation · ${s.label}${s.exportE ? " · " + s.exportE : ""}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onBack}>
            Back
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Recording…" : "Record cancellation"}
          </button>
        </>
      }
    >
      <p className="note m-0">
        Enter the figures from the customs Write-off Note for Bonded Cargo. Where customs wrote off a different import line or amount, change it here:
        the ledger is posted with these figures as Completed.
      </p>
      <div className="bar">
        <label className="field">
          Write-off note date
          <input className="control" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Total liability on the note (Rs)
          <input className="control w-[160px]" type="number" step="any" value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        <label className="field">
          Write-off note (PDF / image)
          <input className="control" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Item</th>
              <th>Import line</th>
              <th className="num">Qty (MUD)</th>
              <th className="num">Qty written off</th>
              <th className="num">Liability (MUD)</th>
              <th className="num">Item liability (write-off)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const grp = lineOf.get(r.key)?.grp;
              return (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td>
                    <select className="control max-w-[320px]" value={r.key} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
                      {lines
                        .filter((x) => x.req === "Yes" && x.grp === grp)
                        .map((x) => (
                          <option key={x.key} value={x.key}>
                            {x.cusdec} · {fdate(x.date)} · {x.desc.slice(0, 24)}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="num">{fx(r.qtyMud, 2)}</td>
                  <td className="num">
                    <input className="control w-[100px] text-right" type="number" step="any" value={r.qty} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
                  </td>
                  <td className="num">{fx(r.liabMud, 2)}</td>
                  <td className="num">
                    <input className="control w-[130px] text-right" type="number" step="any" value={r.liab} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, liab: Number(e.target.value) || 0 } : x)))} />
                  </td>
                </tr>
              );
            })}
            <tr className="total">
              <td colSpan={4}>Total</td>
              <td className="num">{fx(mudTot, 2)}</td>
              <td className="num">{fx(sum, 2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note m-0">
        {t ? `Write-off note total Rs ${fx(t, 2)} vs lines ${fx(sum, 2)}${Math.abs(t - sum) > 1 ? ` · difference ${fx(t - sum, 2)}` : " · agrees"}. ` : ""}
        MUD liability was Rs {fx(mudTot, 2)}
        {Math.abs(sum - mudTot) > 1 ? ` · write-off differs by ${fx(sum - mudTot, 2)}` : ""}.
      </p>
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}

