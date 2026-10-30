"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "./AppShell";
import UploadPanel from "./UploadPanel";
import CustomsUpload from "./CustomsUpload";
import AddReconRow from "./AddReconRow";
import BulkCustomsDocs from "./BulkCustomsDocs";
import CellInput, { EditSwitch, parseCellNumber } from "./CellInput";
import { CustomsDocHeadings, DOC_FILTER_COLUMNS, docFilterValues, useCustomsDocs } from "./CustomsDocs";
import { ClearFilters, FilterRow, useColumnFilters, type ColumnSpec } from "./ColumnFilters";
import { cents, fmt, mLabel, monthKey, norm, sum } from "@/lib/format";
import {
  RECON_TABLE,
  addReconRow,
  deleteReconRow,
  loadCustomsEntries,
  reloadRecon,
  updateCustomsEntry,
  updateReconReport,
} from "@/lib/data";
import { customsEntryMonth } from "@/lib/matchDocuments";
import type {
  CurrencyType,
  CustomsEditable,
  CustomsEntry,
  ExportEditable,
  ExportReportEditable,
  ExportSale,
  ReconDirection,
} from "@/lib/types";

/** Commit handler factory for an admin-editable field of the uploaded data. */
type Commit<T, K> = (target: T, field: K, kind: "text" | "num", places?: number) => (v: string) => void;

/** A customs declaration with no report row yet: its first item line, with the items' amounts summed. */
interface OrphanRow {
  entry: CustomsEntry;
  /** Every item line of the declaration. */
  items: CustomsEntry[];
  customs_value: number | null;
  vat_base: number | null;
  vat_amount: number | null;
}

/** Amounts of a declaration summed over its item lines. */
type OrphanTotal = "customs_value" | "vat_base" | "vat_amount";

/** Report and difference columns that a customs entry without a report invoice can be given. */
type OrphanReport = "amount_fc" | "ex_rate" | "net_sales" | "short_shipment" | "sales_reversed";

/** Report month key of a row. */
const sm = (r: ExportSale) => monthKey(r.sales_month);

/** Exchange difference (1): customs value in LKR less the ledger value. */
export const exchangeDifference = (r: ExportSale): number | null =>
  r.custom_value == null ? null : cents(r.custom_value - r.net_sales);

const CURRENCIES: CurrencyType[] = ["USD", "EUR"];

const TEXT: Record<
  ReconDirection,
  { group: string; amount: string; net: string; noun: string; report: string; invoiceNoun: string }
> = {
  export: {
    group: "Details in sales report",
    amount: "Amount FC (FOB) USD / EUR",
    net: "Net sales (A)",
    noun: "export sales",
    report: "export sales report",
    invoiceNoun: "invoices",
  },
  import: {
    group: "Details in purchase ledger",
    amount: "Amount FC (CIF) USD / EUR",
    net: "Ledger value (A)",
    noun: "import purchases",
    report: "import purchase report",
    invoiceNoun: "invoices",
  },
};

/**
 * Reconciliation of a report against customs entries. Used by the Export reconciliation tab; the import
 * branch (purchase ledger against customs) is kept for `import_purchases` but the Import Register tab
 * lists the customs entries directly instead.
 */
export default function ReconView({
  direction,
  rows: rows0,
  onPatched: patch,
}: {
  direction: ReconDirection;
  /** Report rows of the tax year. */
  rows: ExportSale[];
  /** Called with the re-read row after an inline edit. */
  onPatched: (row: ExportSale) => void;
}) {
  const { supabase, company, months, loading, canWrite, isAdmin, user, reload, flash } = useApp();
  const isImport = direction === "import";
  const t = TEXT[direction];
  const customsCols = isImport ? 9 : 7;
  const COLS = 12 + customsCols;

  const [upMonth, setUpMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Admins may correct the uploaded report columns and the customs entries without a report invoice.
  const [editOn, setEditOn] = useState(false);
  const editing = isAdmin && editOn;

  const countFor = (m: string) => rows0.filter((r) => sm(r) === m).length;

  // Customs entries held for this direction: for the CusDec column and for entries without a report invoice yet.
  const [entries, setEntries] = useState<CustomsEntry[]>([]);
  const [docTick, setDocTick] = useState(0);
  useEffect(() => {
    if (!company) {
      setEntries([]);
      return;
    }
    let live = true;
    loadCustomsEntries(supabase, direction, company.id)
      .then((e) => live && setEntries(e))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [supabase, company, direction, rows0, docTick]);

  /** Latest customs entry per invoice number, for the CusDec column. */
  const entryByInvoice = useMemo(() => {
    const m = new Map<string, CustomsEntry>();
    for (const e of entries) {
      const k = norm(e.invoice_no);
      const prev = m.get(k);
      if (!prev || e.created_at > prev.created_at) m.set(k, e);
    }
    return m;
  }, [entries]);

  // Filter boxes under the column headings, in column order.
  const columns = useMemo<ColumnSpec[]>(
    () => [
      { key: "invoice_no", label: "Invoice no" },
      { key: "month", label: "Month" },
      { key: "amount_fc", label: t.amount, num: true, className: "num" },
      { key: "ex_rate", label: "Ex. rate", num: true, className: "num" },
      { key: "net_sales", label: t.net, num: true, className: "num" },
      { key: "cusdec_no", label: "Cusdec no", className: "border-l border-line" },
      { key: "cusdec_date", label: "Date" },
      { key: "cusdec_month", label: "Customs month" },
      { key: "currency_type", label: "Currency" },
      { key: "custom_ex_rate", label: "Ex. rate customs", num: true, className: "num" },
      { key: "custom_invoice_value", label: "Invoice value as per customs", num: true, className: "num" },
      { key: "custom_value", label: "Customs value", num: true, className: "num" },
      ...(isImport
        ? [
            { key: "custom_vat_base", label: "Value for VAT", num: true, className: "num" },
            { key: "custom_vat_amount", label: "VAT as per customs", num: true, className: "num" },
          ]
        : []),
      { key: "exchange_difference", label: "Exchange difference", num: true, className: "num border-l border-line" },
      { key: "short_shipment", label: "Short shipment", num: true, className: "num" },
      { key: "sales_reversed", label: "Reversed in the month", num: true, className: "num" },
      { key: "updated_in_custom_report", label: "Updated in customs report" },
      ...DOC_FILTER_COLUMNS,
    ],
    [isImport, t],
  );
  const cf = useColumnFilters(columns);
  /** Report rows that pass the column filters. */
  const rowsF = useMemo(
    () =>
      cf.apply(rows0, (r) => {
        const e = entryByInvoice.get(norm(r.invoice_no));
        return {
          invoice_no: r.invoice_no,
          month: mLabel(sm(r)),
          amount_fc: r.amount_fc,
          ex_rate: r.ex_rate,
          net_sales: r.net_sales,
          cusdec_no: r.cusdec_no,
          cusdec_date: r.cusdec_date,
          cusdec_month: r.cusdec_month,
          currency_type: r.currency_type,
          custom_ex_rate: r.custom_ex_rate,
          custom_invoice_value: r.custom_invoice_value,
          custom_value: r.custom_value,
          custom_vat_base: r.custom_vat_base,
          custom_vat_amount: r.custom_vat_amount,
          exchange_difference: exchangeDifference(r),
          short_shipment: r.short_shipment,
          sales_reversed: r.sales_reversed,
          updated_in_custom_report: r.updated_in_custom_report,
          ...docFilterValues(e),
        };
      }),
    [rows0, entryByInvoice, cf.apply],
  );

  // CusDec, other documents and all documents of the customs entry carrying the row's invoice number.
  const docs = useCustomsDocs(direction, () => setDocTick((n) => n + 1));
  /** The three document cells for a row: dashes without a customs entry, else the document actions. */
  const docCell = docs.cells;

  /** Entries whose invoice number matches no loaded row, by CusDec month, one row per declaration with its items summed. */
  const orphans = useMemo(() => {
    const have = new Set(rows0.map((r) => norm(r.invoice_no)));
    const by = new Map<string, OrphanRow[]>();
    for (const e of entries) {
      if (have.has(norm(e.invoice_no))) continue;
      const k = customsEntryMonth(e);
      if (!k) continue;
      const list = by.get(k) ?? [];
      const same = list.find((o) => o.entry.cusdec_no === e.cusdec_no && o.entry.invoice_no === e.invoice_no);
      const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
      if (same) {
        same.customs_value = add(same.customs_value, e.customs_value);
        same.vat_base = add(same.vat_base, e.vat_base);
        same.vat_amount = add(same.vat_amount, e.vat_amount);
        same.items.push(e);
        if (e.item_no < same.entry.item_no) same.entry = e;
      } else list.push({ entry: e, items: [e], customs_value: e.customs_value, vat_base: e.vat_base, vat_amount: e.vat_amount });
      by.set(k, list);
    }
    // The placeholder rows answer to the same filter boxes.
    for (const [k, list] of by)
      by.set(
        k,
        cf.apply(list, (o) => ({
          invoice_no: o.entry.invoice_no,
          month: mLabel(k),
          cusdec_no: o.entry.cusdec_no,
          cusdec_date: o.entry.cusdec_date,
          cusdec_month: o.entry.cusdec_month,
          currency_type: o.entry.currency_type,
          custom_ex_rate: o.entry.ex_rate,
          custom_invoice_value: o.entry.invoice_value,
          custom_value: o.customs_value,
          custom_vat_base: o.vat_base,
          custom_vat_amount: o.vat_amount,
          updated_in_custom_report: o.entry.party,
          ...docFilterValues(o.entry),
        })),
      );
    return by;
  }, [entries, rows0, cf.apply]);

  // Default the upload month and the view range to the latest month with data, else the first month.
  useEffect(() => {
    const withData = months.filter((k) => rows0.some((r) => sm(r) === k));
    const latest = withData[withData.length - 1] ?? months[0];
    if (!upMonth || !months.includes(upMonth)) setUpMonth(latest);
    if (!from || !months.includes(from)) setFrom(latest);
    if (!to || !months.includes(to)) setTo(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, rows0, company?.id]);

  const f = from || months[0];
  const tt = to || months[0];
  const lo = f <= tt ? f : tt;
  const hi = f <= tt ? tt : f;
  const rangeMonths = useMemo(() => months.filter((k) => k >= lo && k <= hi), [months, lo, hi]);
  const groups = useMemo(
    () =>
      rangeMonths
        .map((k) => ({ month: k, rows: rowsF.filter((r) => sm(r) === k), extra: orphans.get(k) ?? [] }))
        .filter((g) => g.rows.length || g.extra.length),
    [rangeMonths, rowsF, orphans],
  );
  const all = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const orphanCount = groups.reduce((n, g) => n + g.extra.length, 0);

  async function update(row: ExportSale, patchData: Partial<ExportEditable>) {
    // Customs value follows invoice value x customs rate whenever either of those changes.
    if ("custom_ex_rate" in patchData || "custom_invoice_value" in patchData) {
      const rate = "custom_ex_rate" in patchData ? patchData.custom_ex_rate : row.custom_ex_rate;
      const val = "custom_invoice_value" in patchData ? patchData.custom_invoice_value : row.custom_invoice_value;
      patchData.custom_value = rate != null && val != null ? cents(rate * val) : null;
    }
    setBusyId(row.id);
    const { error } = await supabase
      .from(RECON_TABLE[direction])
      .update({ ...patchData, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      flash("Could not save: " + error.message, true);
      setBusyId(null);
      return;
    }
    try {
      patch(await reloadRecon(supabase, direction, row.id));
      flash(null);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Saved, but the row could not be refreshed.", true);
    }
    setBusyId(null);
  }

  const text = (row: ExportSale, field: keyof ExportEditable) => (v: string) => {
    const next = v.trim() || null;
    if (next !== (row[field] ?? null)) void update(row, { [field]: next });
  };
  const numeric = (row: ExportSale, field: keyof ExportEditable, places = 2) => (v: string) => {
    const next = parseCellNumber(v, places);
    if (next === undefined) {
      flash(`“${v}” is not a number.`, true);
      return;
    }
    if (next !== (row[field] ?? null)) void update(row, { [field]: next });
  };

  /** Reads an admin's edit of the uploaded data: undefined (with a message) when it cannot be saved. */
  function readEdit(v: string, kind: "text" | "num", places: number, required: boolean): string | number | null | undefined {
    const next = kind === "text" ? v.trim() || null : parseCellNumber(v, places);
    if (next === undefined) flash(`“${v}” is not a number.`, true);
    else if (next == null && required) flash("This field cannot be blank.", true);
    else return next;
    return undefined;
  }

  // Report columns of a row (invoice number, amount, rate, net value), as uploaded.
  async function updateReport(row: ExportSale, patchData: Partial<ExportReportEditable>) {
    setBusyId(row.id);
    try {
      await updateReconReport(supabase, direction, row, patchData, user.id);
      patch(await reloadRecon(supabase, direction, row.id));
      flash(null);
    } catch (e) {
      flash("Could not save: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusyId(null);
  }
  const commitReport: Commit<ExportSale, keyof ExportReportEditable> = (row, field, kind, places = 2) => (v) => {
    const next = readEdit(v, kind, places, field !== "ex_rate");
    if (next !== undefined && next !== (row[field] ?? null)) void updateReport(row, { [field]: next });
  };

  // Customs entries without a report invoice: their declaration fields, saved to every item line.
  async function updateEntry(entry: CustomsEntry, patchData: Partial<CustomsEditable>) {
    setBusyId(entry.id);
    try {
      await updateCustomsEntry(supabase, entry, patchData);
      await reload();
      flash(null);
    } catch (e) {
      flash("Could not save: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusyId(null);
  }
  const commitEntry: Commit<CustomsEntry, keyof CustomsEditable> = (entry, field, kind, places = 2) => (v) => {
    const next = readEdit(v, kind, places, field === "cusdec_no" || field === "invoice_no");
    if (next !== undefined && next !== (entry[field] ?? null)) void updateEntry(entry, { [field]: next });
  };
  /**
   * A value typed into a blank report or difference column of a customs entry without a report invoice:
   * creates the report row for its invoice number in the CusDec month, which the customs entry then fills.
   */
  const commitNew = (o: OrphanRow, month: string, field: OrphanReport, kind: "text" | "num", places = 2) => (v: string) => {
    const next = readEdit(v, kind, places, false);
    if (next === undefined || next == null || !company) return;
    const e = o.entry;
    const cur = (e.currency_type ?? "").toUpperCase();
    setBusyId(e.id);
    void (async () => {
      try {
        await addReconRow(
          supabase,
          direction,
          company.id,
          month + "-01",
          {
            invoice_no: e.invoice_no,
            amount_fc: 0,
            ex_rate: null,
            net_sales: 0,
            currency_type: isImport ? cur || "USD" : CURRENCIES.includes(cur as CurrencyType) ? cur : "USD",
            [field]: next,
          },
          user.id,
        );
        await reload();
        flash(null);
      } catch (err) {
        flash("Could not save: " + (err instanceof Error ? err.message : String(err)), true);
      }
      setBusyId(null);
    })();
  };

  /** Deletes a report row, after asking. */
  async function remove(row: ExportSale) {
    if (!window.confirm(`Delete invoice ${row.invoice_no} from ${mLabel(sm(row))}?`)) return;
    setBusyId(row.id);
    try {
      await deleteReconRow(supabase, direction, row.id);
      await reload();
      flash(null);
    } catch (e) {
      flash("Could not delete: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusyId(null);
  }

  /** Moves a report row to another report month. */
  const moveMonth = (row: ExportSale, key: string) => {
    if (key !== sm(row)) void updateReport(row, { sales_month: key + "-01" });
  };

  /**
   * A summed amount of a declaration without a report invoice. With one item line the line takes the typed
   * value; with several, the first line takes the typed total less the other lines, and blank clears them all.
   */
  async function updateTotal(o: OrphanRow, field: OrphanTotal, next: number | null) {
    const first = o.entry;
    const others = o.items.filter((i) => i.id !== first.id);
    setBusyId(first.id);
    try {
      if (next == null) for (const i of o.items) await updateCustomsEntry(supabase, i, { [field]: null });
      else await updateCustomsEntry(supabase, first, { [field]: cents(next - sum(others, (i) => i[field])) });
      await reload();
      flash(null);
    } catch (e) {
      flash("Could not save: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusyId(null);
  }
  const commitTotal = (o: OrphanRow, field: OrphanTotal) => (v: string) => {
    const next = readEdit(v, "num", 2, false) as number | null | undefined;
    if (next !== undefined && next !== o[field]) void updateTotal(o, field, next);
  };

  const Totals = ({ rows, label }: { rows: ExportSale[]; label: string }) => (
    <tr className="total">
      <td colSpan={2}>{label}</td>
      <td className="num">{fmt(sum(rows, (r) => r.amount_fc))}</td>
      <td></td>
      <td className="num">{fmt(sum(rows, (r) => r.net_sales))}</td>
      <td colSpan={6}></td>
      <td className="num">{fmt(sum(rows, (r) => r.custom_value ?? 0))}</td>
      {isImport && <td className="num">{fmt(sum(rows, (r) => r.custom_vat_base ?? 0))}</td>}
      {isImport && <td className="num">{fmt(sum(rows, (r) => r.custom_vat_amount ?? 0))}</td>}
      <td className="num">{fmt(sum(rows, (r) => exchangeDifference(r) ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.short_shipment ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.sales_reversed ?? 0))}</td>
      <td colSpan={4}></td>
    </tr>
  );

  return (
    <>
      {canWrite && (
        <>
          <UploadPanel
            kind={direction}
            month={upMonth || months[0]}
            onMonthChange={setUpMonth}
            existingCount={countFor}
            onSaved={(m) => {
              setFrom(m);
              setTo(m);
            }}
          />
          <CustomsUpload direction={direction} />
          <BulkCustomsDocs direction={direction} entries={entries} onDone={() => setDocTick((n) => n + 1)} />
        </>
      )}

      <div className="bar">
        <label className="field">
          View from
          <select className="control" value={f} onChange={(e) => setFrom(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} ${t.invoiceNoun}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          To
          <select className="control" value={tt} onChange={(e) => setTo(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} ${t.invoiceNoun}` : ""}
              </option>
            ))}
          </select>
        </label>
        <ClearFilters state={cf} />
        {isAdmin && <EditSwitch on={editOn} onChange={setEditOn} />}
        <span className="note pb-1.5">
          {all.length} {t.invoiceNoun} · {isImport ? "ledger value" : "net sales"}{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => r.net_sales))}</span>
          {" · "}exchange difference{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => exchangeDifference(r) ?? 0))}</span>
          {" · "}
          {all.filter((r) => r.cusdec_no).length} with customs entry
          {orphanCount > 0 && (
            <>
              {" · "}
              <span className="text-warn">
                {orphanCount} customs entr{orphanCount === 1 ? "y" : "ies"} without a {isImport ? "purchase" : "sales"} invoice yet
              </span>
            </>
          )}
        </span>
      </div>

      {canWrite && (
        <div className="bar">
          <AddReconRow
            direction={direction}
            month={hi}
            onAdded={(m) => {
              if (m < lo || m > hi) {
                setFrom(m);
                setTo(m);
              }
            }}
          />
        </div>
      )}

      {docs.input}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th colSpan={5} className="text-center" style={{ position: "static" }}>
                {t.group}
              </th>
              <th colSpan={customsCols} className="text-center border-l border-line" style={{ position: "static" }}>
                As per customs
              </th>
              <th colSpan={4} className="text-center border-l border-line" style={{ position: "static" }}>
                Differences
              </th>
              <th colSpan={3} className="text-center border-l border-line" style={{ position: "static" }}>
                Documents
              </th>
            </tr>
            <tr>
              <th>Invoice no</th>
              <th>Month</th>
              <th className="num">{t.amount}</th>
              <th className="num">Ex. rate</th>
              <th className="num">{t.net}</th>
              <th className="border-l border-line">Cusdec no</th>
              <th>Date</th>
              <th>Month</th>
              <th>Currency</th>
              <th className="num">Ex. rate customs LKR</th>
              <th className="num">Invoice value as per USD / EUR</th>
              <th className="num">Customs value</th>
              {isImport && <th className="num">Value for VAT (customs)</th>}
              {isImport && <th className="num">VAT as per customs</th>}
              <th className="num border-l border-line">Exchange difference (1)</th>
              <th className="num">Short shipment (3)</th>
              <th className="num">{isImport ? "Reversed in the month (4)" : "Sales reversed in the month (4)"}</th>
              <th>Updated in customs report</th>
              <CustomsDocHeadings canWrite={canWrite} />
            </tr>
            <FilterRow state={cf} />
          </thead>
          <tbody>
            {loading && !rows0.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !groups.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  {cf.active ? (
                    "No rows match the column filters."
                  ) : (
                    <>
                      No {t.noun} saved for {lo === hi ? mLabel(lo) : `${mLabel(lo)} to ${mLabel(hi)}`}.
                      {canWrite ? ` Upload a month’s ${t.report} above, or add invoices by hand.` : ""}
                    </>
                  )}
                </td>
              </tr>
            ) : (
              <>
                {groups.map((g) => (
                  <GroupRows
                    key={g.month}
                    g={g}
                    extra={g.extra}
                    docCell={docCell}
                    entryFor={(inv) => entryByInvoice.get(norm(inv))}
                    isImport={isImport}
                    canWrite={canWrite}
                    editing={editing}
                    busyId={busyId}
                    text={text}
                    numeric={numeric}
                    update={update}
                    commitReport={commitReport}
                    commitEntry={commitEntry}
                    commitTotal={commitTotal}
                    months={months}
                    moveMonth={moveMonth}
                    remove={remove}
                    commitNew={commitNew}
                    Totals={Totals}
                  />
                ))}
                {groups.length > 1 && <Totals rows={all} label="Total" />}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        The first five columns come from the uploaded {t.report}, or are entered by hand with “Add invoice by hand”. The customs columns are filled automatically from
        uploaded customs entries with the same invoice number, or entered by hand. A customs entry whose invoice is
        not in any uploaded {t.report} is listed under its CusDec month with the first columns blank until that
        month’s report is uploaded; typing an amount, rate or net value in those blank columns adds the invoice to
        the report by hand. Customs value is invoice value ×
        customs rate and exchange difference (1) is customs value less {isImport ? "ledger value" : "net sales"}.
        Re-uploading a month keeps customs details already held for the same invoice number.
        {isAdmin &&
          ` Admins can correct the uploaded data with “Edit uploaded data”: every ${t.report} column of each invoice, its month included, and every customs column of an entry without a ${isImport ? "purchase" : "sales"} invoice yet (correcting its invoice number matches it to the report; a summed amount of a CusDec with several items is adjusted on its first item line). Re-uploading the month or the CusDec replaces the corrections.`}
      </div>
    </>
  );
}

function GroupRows({
  g,
  extra,
  docCell,
  entryFor,
  isImport,
  canWrite,
  editing,
  busyId,
  text,
  numeric,
  update,
  commitReport,
  commitEntry,
  commitTotal,
  months,
  moveMonth,
  remove,
  commitNew,
  Totals,
}: {
  g: { month: string; rows: ExportSale[] };
  /** Customs declarations of this month with no report invoice yet. */
  extra: OrphanRow[];
  docCell: (entry: CustomsEntry | null | undefined) => ReactNode;
  entryFor: (invoiceNo: string) => CustomsEntry | undefined;
  isImport: boolean;
  canWrite: boolean;
  /** An admin is correcting the uploaded data. */
  editing: boolean;
  busyId: string | null;
  text: (row: ExportSale, field: keyof ExportEditable) => (v: string) => void;
  numeric: (row: ExportSale, field: keyof ExportEditable, places?: number) => (v: string) => void;
  update: (row: ExportSale, patch: Partial<ExportEditable>) => Promise<void>;
  commitReport: Commit<ExportSale, keyof ExportReportEditable>;
  commitEntry: Commit<CustomsEntry, keyof CustomsEditable>;
  commitTotal: (o: OrphanRow, field: OrphanTotal) => (v: string) => void;
  /** Report months of the tax year, for moving a row. */
  months: string[];
  moveMonth: (row: ExportSale, key: string) => void;
  remove: (row: ExportSale) => void;
  commitNew: (o: OrphanRow, month: string, field: OrphanReport, kind: "text" | "num", places?: number) => (v: string) => void;
  Totals: (p: { rows: ExportSale[]; label: string }) => React.JSX.Element;
}) {
  return (
    <>
      {g.rows.map((r) => {
        const busy = busyId === r.id;
        const diff = exchangeDifference(r);
        const cell = (field: keyof ExportEditable, kind: "text" | "num", places = 2, width = "w-[110px]") => {
          const raw = r[field];
          if (!canWrite)
            return kind === "num" ? fmt(raw as number | null) : <span className={raw ? "" : "text-muted"}>{(raw as string) || "—"}</span>;
          const value = raw == null ? "" : String(raw);
          return (
            <CellInput
              key={r.id + ":" + field + ":" + value}
              value={value}
              kind={kind}
              className={width}
              disabled={busy}
              label={`${field.replace(/_/g, " ")} for ${r.invoice_no}`}
              onCommit={kind === "num" ? numeric(r, field, places) : text(r, field)}
            />
          );
        };
        /** A report column: an input while an admin edits, else the shown value. */
        const report = (field: keyof ExportReportEditable, shown: ReactNode, kind: "text" | "num", places = 2, width = "w-[110px]") => {
          if (!editing) return shown;
          const value = r[field] == null ? "" : String(r[field]);
          return (
            <CellInput
              key={r.id + ":" + field + ":" + value}
              value={value}
              kind={kind}
              className={width}
              disabled={busy}
              label={`${field.replace(/_/g, " ")} for ${r.invoice_no}`}
              onCommit={commitReport(r, field, kind, places)}
            />
          );
        };
        return (
          <tr key={r.id} className={busy ? "opacity-60" : undefined}>
            <td>
              {report("invoice_no", r.invoice_no, "text")}
              {editing && (
                <button
                  type="button"
                  className="btn ml-1"
                  disabled={busy}
                  aria-label={`Delete invoice ${r.invoice_no}`}
                  title="Delete this invoice"
                  onClick={() => remove(r)}
                >
                  ×
                </button>
              )}
            </td>
            <td>
              {editing ? (
                <select
                  className="control"
                  value={sm(r)}
                  disabled={busy}
                  aria-label={`Report month for ${r.invoice_no}`}
                  onChange={(e) => moveMonth(r, e.target.value)}
                >
                  {(months.includes(sm(r)) ? months : [sm(r), ...months]).map((k) => (
                    <option key={k} value={k}>
                      {mLabel(k)}
                    </option>
                  ))}
                </select>
              ) : (
                mLabel(sm(r))
              )}
            </td>
            <td className="num">{report("amount_fc", fmt(r.amount_fc), "num")}</td>
            <td className="num">{report("ex_rate", r.ex_rate == null ? "" : String(r.ex_rate), "num", 6, "w-[100px]")}</td>
            <td className="num">{report("net_sales", fmt(r.net_sales), "num", 2, "w-[130px]")}</td>
            <td className="border-l border-line">{cell("cusdec_no", "text", 0, "w-[90px]")}</td>
            <td>{cell("cusdec_date", "text", 0, "w-[100px]")}</td>
            <td>{cell("cusdec_month", "text", 0, "w-[90px]")}</td>
            <td>
              {canWrite ? (
                isImport ? (
                  cell("currency_type", "text", 0, "w-[70px]")
                ) : (
                  <select
                    className="control"
                    value={r.currency_type}
                    disabled={busy}
                    aria-label={`Currency type for ${r.invoice_no}`}
                    onChange={(e) => void update(r, { currency_type: e.target.value as CurrencyType })}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                r.currency_type
              )}
            </td>
            <td className="num">{cell("custom_ex_rate", "num", 6, "w-[100px]")}</td>
            <td className="num">{cell("custom_invoice_value", "num")}</td>
            <td className="num">{cell("custom_value", "num", 2, "w-[130px]")}</td>
            {isImport && <td className="num">{cell("custom_vat_base", "num", 2, "w-[130px]")}</td>}
            {isImport && <td className="num">{cell("custom_vat_amount", "num", 2, "w-[120px]")}</td>}
            <td className={"num border-l border-line" + (diff != null && diff !== 0 ? "" : " text-muted")}>
              {diff == null ? "" : fmt(diff)}
            </td>
            <td className="num">{cell("short_shipment", "num")}</td>
            <td className="num">{cell("sales_reversed", "num")}</td>
            <td>{cell("updated_in_custom_report", "text", 0, "w-[120px]")}</td>
            {docCell(entryFor(r.invoice_no))}
          </tr>
        );
      })}
      {extra.map((o) => {
        const { entry: e } = o;
        const busy = busyId === e.id;
        /** A blank report or difference column: an input that creates the report row, else a dash. */
        const newCell = (field: OrphanReport, places = 2, width = "w-[110px]") =>
          canWrite ? (
            <CellInput
              key={e.id + ":" + field}
              value=""
              kind="num"
              className={width}
              disabled={busy}
              label={`${field.replace(/_/g, " ")} for invoice ${e.invoice_no}`}
              onCommit={commitNew(o, g.month, field, "num", places)}
            />
          ) : (
            "—"
          );
        /** An amount summed over the declaration's item lines: an input while an admin edits, else the sum. */
        const totalCell = (field: OrphanTotal, width: string) => {
          if (!editing) return fmt(o[field]);
          const value = o[field] == null ? "" : String(o[field]);
          return (
            <CellInput
              key={e.id + ":" + field + ":" + value}
              value={value}
              kind="num"
              className={width}
              disabled={busy}
              label={`${field.replace(/_/g, " ")} for CusDec ${e.cusdec_no}`}
              onCommit={commitTotal(o, field)}
            />
          );
        };
        /** A declaration field of the customs entry: an input while an admin edits, else the shown value. */
        const entryCell = (field: keyof CustomsEditable, shown: ReactNode, kind: "text" | "num", places = 2, width = "w-[100px]") => {
          if (!editing) return shown;
          const value = e[field] == null ? "" : String(e[field]);
          return (
            <CellInput
              key={e.id + ":" + field + ":" + value}
              value={value}
              kind={kind}
              className={width}
              disabled={busy}
              label={`${field.replace(/_/g, " ")} for CusDec ${e.cusdec_no}`}
              onCommit={commitEntry(e, field, kind, places)}
            />
          );
        };
        return (
          <tr key={"e" + e.id} className={"text-muted" + (busy ? " opacity-60" : "")}>
            <td>
              {entryCell("invoice_no", e.invoice_no, "text")}{" "}
              <span className="pill pill-warn">No {isImport ? "purchase" : "sales"} invoice yet</span>
            </td>
            <td>{mLabel(g.month)}</td>
            <td className="num">{newCell("amount_fc")}</td>
            <td className="num">{newCell("ex_rate", 6, "w-[100px]")}</td>
            <td className="num">{newCell("net_sales", 2, "w-[130px]")}</td>
            <td className="border-l border-line text-ink">{entryCell("cusdec_no", e.cusdec_no, "text", 2, "w-[90px]")}</td>
            <td className="text-ink">{entryCell("cusdec_date", e.cusdec_date, "text")}</td>
            <td className="text-ink">{entryCell("cusdec_month", e.cusdec_month, "text", 2, "w-[90px]")}</td>
            <td className="text-ink">{entryCell("currency_type", e.currency_type, "text", 2, "w-[70px]")}</td>
            <td className="num text-ink">{entryCell("ex_rate", e.ex_rate ?? "", "num", 6)}</td>
            <td className="num text-ink">{entryCell("invoice_value", fmt(e.invoice_value), "num", 2, "w-[110px]")}</td>
            <td className="num text-ink">{totalCell("customs_value", "w-[130px]")}</td>
            {isImport && <td className="num text-ink">{totalCell("vat_base", "w-[130px]")}</td>}
            {isImport && <td className="num text-ink">{totalCell("vat_amount", "w-[120px]")}</td>}
            <td className="border-l border-line"></td>
            <td className="num">{newCell("short_shipment")}</td>
            <td className="num">{newCell("sales_reversed")}</td>
            <td className="wrapc">{entryCell("party", e.party, "text", 2, "w-[120px]")}</td>
            {docCell(e)}
          </tr>
        );
      })}
      <Totals rows={g.rows} label={mLabel(g.month)} />
    </>
  );
}

