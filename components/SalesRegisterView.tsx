"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import CustomsUpload from "./CustomsUpload";
import { fmt, mLabel, norm, sum } from "@/lib/format";
import { loadCustomsEntries, loadSalesInvoices, loadSalesLines } from "@/lib/data";
import { downloadWorkbook } from "@/lib/download";
import { UploadError } from "@/lib/parse";
import {
  invoiceTotals,
  parseSalesFile,
  salesTemplateWorkbook,
  type ParsedSales,
  type SalesInvoice,
  type SalesLine,
  type SalesType,
} from "@/lib/sales";
import type { CustomsEntry } from "@/lib/types";

/** Invoices per upload call: keeps each request small; every call is its own entry in the log. */
const CHUNK = 200;
const UNDATED = "undated";

interface Pending {
  fileName: string;
  parsed: ParsedSales;
  /** Invoices in the file that are already held (updated, not duplicated). */
  existing: number;
}

const TEXT: Record<SalesType, { noun: string; title: string; note: string }> = {
  Export: {
    noun: "export sales invoice",
    title: "Upload export sales invoices",
    note:
      "The Business Central export sales line list (Excel or CSV). Each invoice no. becomes one invoice below with its item lines. " +
      "Freight, insurance and other charge lines are marked and left out of FOB, which is what Export reconciliation uses: " +
      "every invoice is added to Export reconciliation in its invoice month, and the customs columns fill from the export CusDecs below.",
  },
  Local: {
    noun: "local sales invoice",
    title: "Upload local sales invoices",
    note:
      "The Business Central local sales line list (Excel or CSV). Each invoice no. becomes one invoice below with its item lines; " +
      "TIEP uses the lines to work out the duty to pay on local sales.",
  },
};

/** Month key of an invoice date, or UNDATED. */
const monthOf = (i: SalesInvoice) => (i.invoice_date ? i.invoice_date.slice(0, 7) : UNDATED);

/**
 * Registers › Export Register and Local Sales Register: Business Central sales invoices and their item lines.
 * The Export Register also takes the export CusDecs (customs side of Export reconciliation).
 */
export default function SalesRegisterView({ type }: { type: SalesType }) {
  const { supabase, company, months, perm, flash, loading: appLoading } = useApp();
  const p = perm(type === "Export" ? "reg_exports" : "reg_local");
  const t = TEXT[type];

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [lines, setLines] = useState<SalesLine[]>([]);
  const [exportEntries, setExportEntries] = useState<CustomsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [inv, ln, ent] = await Promise.all([
        loadSalesInvoices(supabase, company.id, type),
        loadSalesLines(supabase, company.id, type),
        type === "Export" ? loadCustomsEntries(supabase, "export", company.id) : Promise.resolve([] as CustomsEntry[]),
      ]);
      setInvoices(inv);
      setLines(ln);
      setExportEntries(ent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(
        /schema cache|does not exist/i.test(msg)
          ? "Run supabase/migrations/0024_registers.sql in the Supabase SQL Editor first."
          : "Could not load the register: " + msg,
      );
    }
    setLoading(false);
  }, [supabase, company, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const linesOf = useMemo(() => {
    const m = new Map<string, SalesLine[]>();
    for (const l of lines) m.set(l.invoice_id, [...(m.get(l.invoice_id) ?? []), l]);
    return m;
  }, [lines]);

  /** Latest export CusDec per invoice number. */
  const cusdecOf = useMemo(() => {
    const m = new Map<string, CustomsEntry>();
    for (const e of exportEntries) {
      const k = norm(e.invoice_no);
      const prev = m.get(k);
      if (!prev || e.created_at > prev.created_at) m.set(k, e);
    }
    return m;
  }, [exportEntries]);

  // ---- Upload -------------------------------------------------------------------------------------------
  const [unit, setUnit] = useState<"auto" | "KG" | "LB">("auto");
  const [pending, setPending] = useState<Pending | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(null);
    setPending(null);
    try {
      const parsed = parseSalesFile(await file.arrayBuffer(), type, { unit });
      const held = new Set(invoices.map((i) => i.invoice_no));
      setPending({ fileName: file.name, parsed, existing: parsed.invoices.filter((i) => held.has(i.invoice_no)).length });
    } catch (err) {
      setParseError(err instanceof UploadError ? err.message : "Could not read the file: " + String(err));
    }
  }

  async function save() {
    if (!pending || !company) return;
    const all = pending.parsed.invoices;
    let added = 0;
    let updated = 0;
    let recon = 0;
    try {
      for (let i = 0; i < all.length; i += CHUNK) {
        setSaving(`Saving ${Math.min(i + CHUNK, all.length)} of ${all.length}…`);
        const { data, error } = await supabase.rpc("upload_sales_invoices", {
          p_company: company.id,
          p_type: type,
          p_file_name: pending.fileName,
          p_rows: all.slice(i, i + CHUNK),
        });
        if (error) throw new Error(error.message);
        const r = data as { added: number; updated: number; reconciliation: number };
        added += r.added;
        updated += r.updated;
        recon += r.reconciliation;
      }
      setPending(null);
      flash(
        `Saved ${all.length} ${t.noun}${all.length === 1 ? "" : "s"}: ${added} new, ${updated} updated.` +
          (type === "Export" ? ` ${recon} Export reconciliation row${recon === 1 ? "" : "s"} added or updated.` : ""),
      );
    } catch (err) {
      flash("Could not save: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setSaving(null);
    await load();
  }

  // ---- View ---------------------------------------------------------------------------------------------
  const [month, setMonth] = useState<string>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const countFor = (k: string) => invoices.filter((i) => monthOf(i) === k).length;
  const undatedCount = countFor(UNDATED);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return invoices.filter((i) => {
      if (s)
        return [i.invoice_no, i.customer, i.export_cusdec, cusdecOf.get(norm(i.invoice_no))?.cusdec_no]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(s));
      const k = monthOf(i);
      return month ? k === month : months.includes(k) || k === UNDATED;
    });
  }, [invoices, q, month, months, cusdecOf]);

  const groups = useMemo(() => {
    const keys = [...new Set(shown.map(monthOf))].sort((a, b) => (a === UNDATED ? 1 : b === UNDATED ? -1 : a.localeCompare(b)));
    return keys.map((k) => ({ key: k, label: k === UNDATED ? "No date" : mLabel(k), rows: shown.filter((i) => monthOf(i) === k) }));
  }, [shown]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function setCharge(l: SalesLine, on: boolean) {
    setBusyId(l.id);
    const { error } = await supabase.rpc("set_sales_line_charge", { p_line: l.id, p_charge: on });
    if (error) flash("Could not save: " + error.message, true);
    else flash(null);
    setBusyId(null);
    await load();
  }

  async function remove(i: SalesInvoice) {
    if (
      !window.confirm(
        `Delete ${t.noun} ${i.invoice_no} and its ${i.line_count} line${i.line_count === 1 ? "" : "s"}?` +
          (type === "Export" ? " Its Export reconciliation row is kept." : ""),
      )
    )
      return;
    setBusyId(i.id);
    const { error } = await supabase.from("sales_invoices").delete().eq("id", i.id);
    if (error) flash("Could not delete: " + error.message, true);
    else flash(`Deleted ${i.invoice_no}.`);
    setBusyId(null);
    await load();
  }

  const isExport = type === "Export";
  const COLS = isExport ? 12 : 10;
  const Totals = ({ rows, label }: { rows: SalesInvoice[]; label: string }) => (
    <tr className="total">
      <td colSpan={4}>{label}</td>
      <td className="num">{sum(rows, (r) => r.line_count)}</td>
      <td></td>
      <td className="num">{fmt(sum(rows, (r) => r.fob_fc))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.amount_fc - r.fob_fc))}</td>
      <td></td>
      <td className="num">{fmt(sum(rows, (r) => r.fob_lkr))}</td>
      {isExport && <td colSpan={2}></td>}
    </tr>
  );

  if (appLoading && !company) return <div className="note">Loading…</div>;

  return (
    <>
      {p.upload && (
        <div className="panel">
          <h2 className="text-[15px] font-semibold m-0">{t.title}</h2>
          <div className="note">{t.note}</div>
          <div className="bar">
            <label className="field">
              File (.xlsx, .xls, .csv)
              <input className="control" type="file" accept=".xlsx,.xls,.csv" onChange={onFile} disabled={!!saving} />
            </label>
            <label className="field" title="Quantities in pounds are converted to kg at 0.454">
              Quantities in
              <select className="control" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
                <option value="auto">Auto-detect</option>
                <option value="KG">Kg</option>
                <option value="LB">Lb (× 0.454)</option>
              </select>
            </label>
            <button
              className="btn"
              type="button"
              onClick={() => downloadWorkbook(salesTemplateWorkbook(type), `${type} sales lines template.xlsx`)}
            >
              Template
            </button>
          </div>
          {parseError && <div className="msg msg-err">{parseError}</div>}
          {pending && <PendingSummary pending={pending} type={type} canReplace={p.delete} saving={saving} onSave={save} onCancel={() => setPending(null)} />}
        </div>
      )}

      {isExport && (p.upload || p.view) && (
        <ExportCustomsPanel entries={exportEntries} invoices={invoices} canUpload={p.upload} onDone={load} />
      )}

      <div className="bar">
        <label className="field">
          Month
          <select className="control" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Whole tax year</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)}` : ""}
              </option>
            ))}
            {undatedCount > 0 && <option value={UNDATED}>No date · {undatedCount}</option>}
          </select>
        </label>
        <label className="field">
          Search (all years)
          <input
            className="control min-w-[220px]"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isExport ? "Invoice, customer or CusDec" : "Invoice or customer"}
          />
        </label>
        <span className="note pb-1.5">
          {shown.length} invoice{shown.length === 1 ? "" : "s"} · FOB LKR{" "}
          <span className="font-mono tabular-nums">{fmt(sum(shown, (r) => r.fob_lkr))}</span>
          {isExport && (
            <>
              {" · "}
              {shown.filter((i) => i.export_cusdec || cusdecOf.has(norm(i.invoice_no))).length} with export CusDec
            </>
          )}
        </span>
      </div>

      {loadError && <div className="msg msg-err">{loadError}</div>}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Invoice no</th>
              <th>Date</th>
              <th>Customer</th>
              <th className="num">Lines</th>
              <th>Currency</th>
              <th className="num">FOB (FC)</th>
              <th className="num">Charges (FC)</th>
              <th className="num">Ex. rate</th>
              <th className="num">FOB (LKR)</th>
              {isExport && <th>Export CusDec</th>}
              {isExport && <th></th>}
              {!isExport && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLS} className="note">
                  Loading invoices…
                </td>
              </tr>
            ) : !groups.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  {q.trim()
                    ? `No invoices match “${q.trim()}”.`
                    : `No ${t.noun}s held for ${month ? (month === UNDATED ? "invoices without a date" : mLabel(month)) : "this tax year"}.`}
                  {p.upload && !q.trim() ? " Upload the Business Central line list above." : ""}
                </td>
              </tr>
            ) : (
              <>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="group">
                      <td colSpan={COLS}>
                        {g.label} · {g.rows.length} invoice{g.rows.length === 1 ? "" : "s"}
                      </td>
                    </tr>
                    {g.rows.map((i) => {
                      const ce = cusdecOf.get(norm(i.invoice_no));
                      const isOpen = open.has(i.id);
                      const ls = linesOf.get(i.id) ?? [];
                      return (
                        <Fragment key={i.id}>
                          <tr className={busyId === i.id ? "opacity-60" : undefined}>
                            <td>
                              <button
                                className="btn px-1.5 py-0 text-[12px]"
                                type="button"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Hide" : "Show"} lines of ${i.invoice_no}`}
                                onClick={() => toggle(i.id)}
                              >
                                {isOpen ? "−" : "+"}
                              </button>
                            </td>
                            <td className="font-mono">{i.invoice_no}</td>
                            <td>{i.invoice_date ?? "—"}</td>
                            <td className="whitespace-normal min-w-[180px]">{i.customer ?? ""}</td>
                            <td className="num">{i.line_count}</td>
                            <td>{i.currency ?? ""}</td>
                            <td className="num">{fmt(i.fob_fc)}</td>
                            <td className="num">{i.amount_fc - i.fob_fc ? fmt(i.amount_fc - i.fob_fc) : "—"}</td>
                            <td className="num">{i.ex_rate != null ? i.ex_rate.toFixed(4) : "—"}</td>
                            <td className="num">{fmt(i.fob_lkr)}</td>
                            {isExport && (
                              <td className="font-mono">
                                {ce?.cusdec_no ?? i.export_cusdec ?? <span className="text-warn">none yet</span>}
                              </td>
                            )}
                            <td>
                              {p.delete && (
                                <button className="btn btn-danger py-0" type="button" disabled={busyId === i.id} onClick={() => void remove(i)}>
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td></td>
                              <td colSpan={COLS - 1} className="p-0">
                                <LinesTable lines={ls} canEdit={p.edit} busyId={busyId} onCharge={(l, on) => void setCharge(l, on)} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    <Totals rows={g.rows} label={`Total ${g.label}`} />
                  </Fragment>
                ))}
                {groups.length > 1 && <Totals rows={shown} label="Total" />}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        FOB is the invoice’s product lines; charge lines (freight, insurance, G/L account lines) are left out. Open an
        invoice with + to see its lines{p.edit ? " and correct which lines are charges" : ""}.
        {isExport &&
          " Export reconciliation takes each invoice’s FOB in foreign currency and LKR. Invoices that were already in Export reconciliation from the old monthly upload keep the figures held there."}
      </div>
    </>
  );
}

function PendingSummary({
  pending,
  type,
  canReplace,
  saving,
  onSave,
  onCancel,
}: {
  pending: Pending;
  type: SalesType;
  canReplace: boolean;
  saving: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { parsed, existing } = pending;
  const dates = parsed.invoices.map((i) => i.invoice_date).filter((d): d is string => !!d).sort();
  const totals = parsed.invoices.map((i) => invoiceTotals(i.lines));
  const charges = parsed.invoices.reduce((n, i) => n + i.lines.filter((l) => l.is_charge).length, 0);
  const blocked = existing > 0 && !canReplace;
  return (
    <div className="flex flex-col gap-2">
      <div className="msg" role="status">
        <b>{pending.fileName}</b> (sheet “{parsed.sheet}”): {parsed.invoices.length} invoice
        {parsed.invoices.length === 1 ? "" : "s"}, {parsed.lines} line{parsed.lines === 1 ? "" : "s"}
        {dates.length ? `, ${dates[0]} to ${dates[dates.length - 1]}` : ""}. FOB{" "}
        <span className="font-mono">{fmt(sum(totals, (x) => x.fob_fc))}</span> FC /{" "}
        <span className="font-mono">{fmt(sum(totals, (x) => x.fob_lkr))}</span> LKR; {charges} charge line
        {charges === 1 ? "" : "s"} left out of FOB.
        {parsed.skipped > 0 && ` ${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} skipped (totals, blanks${type === "Export" ? " or local rows" : " or export rows"}).`}
        {existing > 0 && ` ${existing} invoice${existing === 1 ? " is" : "s are"} already held and will be updated.`}
      </div>
      {parsed.warnings.map((w) => (
        <div key={w} className="msg msg-err">
          {w}
        </div>
      ))}
      {blocked && (
        <div className="msg msg-err">Updating invoices already held needs delete permission on this tab.</div>
      )}
      <div className="bar">
        <button className="btn btn-primary" type="button" onClick={onSave} disabled={!!saving || blocked}>
          {saving ?? `Save ${parsed.invoices.length} invoice${parsed.invoices.length === 1 ? "" : "s"}`}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={!!saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function LinesTable({
  lines,
  canEdit,
  busyId,
  onCharge,
}: {
  lines: SalesLine[];
  canEdit: boolean;
  busyId: string | null;
  onCharge: (l: SalesLine, on: boolean) => void;
}) {
  if (!lines.length) return <div className="note p-2">No lines.</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Item no</th>
          <th>Description</th>
          <th className="num">Qty</th>
          <th>UOM</th>
          <th className="num">Unit price</th>
          <th className="num">Amount (FC)</th>
          <th className="num">Amount (LKR)</th>
          <th>Charge</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className={l.is_charge ? "text-muted" : undefined}>
            <td className="num">{l.line_no}</td>
            <td className="font-mono">{l.item_code ?? ""}</td>
            <td className="whitespace-normal min-w-[240px]">{l.description ?? ""}</td>
            <td className="num" title={l.uom_in && l.uom_in !== l.uom ? `${l.qty_in} ${l.uom_in} in the file` : undefined}>
              {l.qty ?? ""}
            </td>
            <td>{l.uom ?? ""}</td>
            <td className="num">{l.unit_price ?? ""}</td>
            <td className="num">{fmt(l.amount_fc)}</td>
            <td className="num">{fmt(l.amount_lkr)}</td>
            <td>
              {canEdit ? (
                <input
                  type="checkbox"
                  checked={l.is_charge}
                  disabled={busyId === l.id}
                  aria-label={`Line ${l.line_no} is a charge`}
                  onChange={(e) => onCharge(l, e.target.checked)}
                />
              ) : l.is_charge ? (
                "Yes"
              ) : (
                ""
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Export CusDecs: the customs side of Export reconciliation, uploaded here. */
function ExportCustomsPanel({
  entries,
  invoices,
  canUpload,
  onDone,
}: {
  entries: CustomsEntry[];
  invoices: SalesInvoice[];
  canUpload: boolean;
  onDone: () => Promise<void>;
}) {
  const declarations = useMemo(() => new Set(entries.map((e) => e.cusdec_no + "|" + e.invoice_no)).size, [entries]);
  const held = useMemo(() => new Set(invoices.map((i) => norm(i.invoice_no))), [invoices]);
  const unmatched = useMemo(
    () => new Set(entries.filter((e) => !held.has(norm(e.invoice_no))).map((e) => e.cusdec_no + "|" + e.invoice_no)).size,
    [entries, held],
  );
  return (
    <>
      {canUpload && <CustomsUpload direction="export" entries={entries} onDone={onDone} />}
      <div className="note">
        {declarations} export CusDec{declarations === 1 ? "" : "s"} held
        {unmatched > 0 && `, ${unmatched} with an invoice no. not in this register yet`}. Their documents and customs
        figures show in VAT › Export reconciliation.
      </div>
    </>
  );
}
