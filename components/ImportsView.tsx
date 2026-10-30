"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "./AppShell";
import CustomsUpload from "./CustomsUpload";
import BulkCustomsDocs from "./BulkCustomsDocs";
import CellInput, { EditSwitch, parseCellNumber } from "./CellInput";
import {
  CustomsDocHeadings,
  CustomsSearch,
  DOC_FILTER_COLUMNS,
  cusdecFileName,
  docFilterValues,
  searchMatches,
  useCustomsDocs,
} from "./CustomsDocs";
import { ClearFilters, FilterRow, useColumnFilters, type ColumnSpec } from "./ColumnFilters";
import { fmt, mLabel, sum } from "@/lib/format";
import { customsEntryMonth } from "@/lib/matchDocuments";
import { updateCustomsEntry } from "@/lib/data";
import type { CustomsEditable, CustomsEntry } from "@/lib/types";

const UNDATED = "undated";

/** Filter boxes under the column headings, in column order. */
const COLUMNS: ColumnSpec[] = [
  { key: "file_name", label: "File name" },
  { key: "cusdec_no", label: "Cusdec no" },
  { key: "cusdec_date", label: "Date" },
  { key: "cusdec_month", label: "Month" },
  { key: "invoice_no", label: "Invoice no" },
  { key: "item_no", label: "Item", num: true, className: "num border-l border-line" },
  { key: "hs_code", label: "HS code" },
  { key: "description", label: "Description" },
  { key: "party", label: "Supplier" },
  { key: "uom", label: "UOM" },
  { key: "quantity", label: "Quantity", num: true, className: "num" },
  { key: "currency_type", label: "Currency", className: "border-l border-line" },
  { key: "ex_rate", label: "Ex. rate", num: true, className: "num" },
  { key: "invoice_value", label: "Invoice value", num: true, className: "num" },
  { key: "customs_value", label: "Customs value", num: true, className: "num" },
  { key: "cid_amount", label: "CID", num: true, className: "num border-l border-line" },
  { key: "cid_code", label: "CID code" },
  { key: "pal_amount", label: "PAL", num: true, className: "num" },
  { key: "pal_code", label: "PAL code" },
  { key: "sscl_amount", label: "SSCL", num: true, className: "num" },
  { key: "sscl_code", label: "SSCL code" },
  { key: "vat_base", label: "Value for VAT", num: true, className: "num" },
  { key: "vat_amount", label: "VAT", num: true, className: "num" },
  { key: "vat_type", label: "VAT type" },
  { key: "vat_code", label: "VAT code" },
  ...DOC_FILTER_COLUMNS,
];
/** Columns of the register table, for the empty / loading rows. */
const COLS = 28;

/** Quantity with up to three decimals, without trailing zeros. */
const qty = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("en-LK", { maximumFractionDigits: 3 });

/**
 * Import Register: every import customs entry (one line per CusDec item) held for the company,
 * grouped by CusDec month within the selected tax year, with the stored CusDec file. Entries come
 * from the CusDec PDF / spreadsheet upload above the table.
 */
export default function ImportsView() {
  const { supabase, company, months, data, loading, perm, reload, flash } = useApp();
  const p = perm("imports");
  // CusDec, other documents and all documents of each declaration, shared by its item lines.
  const docs = useCustomsDocs("import", reload);
  const entries = data.importEntries;

  // With edit permission users may correct the uploaded data in place; the switch keeps the register read-only otherwise.
  const [editOn, setEditOn] = useState(false);
  const editing = p.edit && editOn;
  const [savingId, setSavingId] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const cf = useColumnFilters(COLUMNS);
  // Search over file name, CusDec and invoice number; while it is in use the whole tax year is shown.
  const [q, setQ] = useState("");
  const searching = q.trim() !== "";

  /** Entries by month key, in CusDec and item order; entries whose date cannot be read go under UNDATED. */
  const byMonth = useMemo(() => {
    const m = new Map<string, CustomsEntry[]>();
    const sorted = [...entries].sort(
      (a, b) => a.cusdec_no.localeCompare(b.cusdec_no) || a.invoice_no.localeCompare(b.invoice_no) || a.item_no - b.item_no,
    );
    const shown = cf
      .apply(sorted, (e) => ({ ...e, file_name: cusdecFileName(e), ...docFilterValues(e) }))
      .filter((e) => searchMatches(q, cusdecFileName(e), e.cusdec_no, e.invoice_no));
    for (const e of shown) {
      const k = customsEntryMonth(e) ?? UNDATED;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [entries, cf.apply, q]);
  const countFor = (m: string) => byMonth.get(m)?.length ?? 0;

  // Default the view range to the latest month with entries, else the first month of the year.
  useEffect(() => {
    const withData = months.filter((k) => countFor(k));
    const latest = withData[withData.length - 1] ?? months[0];
    if (!from || !months.includes(from)) setFrom(latest);
    if (!to || !months.includes(to)) setTo(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, entries, company?.id]);

  const f = from || months[0];
  const tt = to || months[0];
  const lo = f <= tt ? f : tt;
  const hi = f <= tt ? tt : f;
  const groups = useMemo(
    () =>
      months
        .filter((k) => searching || (k >= lo && k <= hi))
        .map((k) => ({ month: k, label: mLabel(k), rows: byMonth.get(k) ?? [] }))
        .filter((g) => g.rows.length),
    [months, lo, hi, byMonth, searching],
  );
  const undated = byMonth.get(UNDATED) ?? [];
  const all = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const cusdecs = (rows: CustomsEntry[]) => new Set(rows.map((r) => r.cusdec_no + "|" + r.invoice_no)).size;

  async function save(e: CustomsEntry, patch: Partial<CustomsEditable>) {
    setSavingId(e.id);
    try {
      await updateCustomsEntry(supabase, e, patch);
      await reload();
      flash(null);
    } catch (err) {
      flash("Could not save: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setSavingId(null);
  }
  /** Commit handler for one field: blank clears it, except on the CusDec, invoice and item numbers. */
  const commit = (e: CustomsEntry, field: keyof CustomsEditable, kind: "text" | "int" | "num", places: number) => (v: string) => {
    let next: string | number | null;
    if (kind === "text") next = v.trim() || null;
    else {
      const n = parseCellNumber(v, kind === "int" ? 0 : places);
      if (n === undefined || (kind === "int" && n != null && n < 1)) {
        flash(`“${v}” is not ${kind === "int" ? "an item number" : "a number"}.`, true);
        return;
      }
      next = n;
    }
    if (next === (e[field] ?? null)) return;
    if (next == null && (field === "cusdec_no" || field === "invoice_no" || field === "item_no")) {
      flash("The CusDec, invoice and item numbers cannot be blank.", true);
      return;
    }
    void save(e, { [field]: next });
  };

  const sameDoc = (a: CustomsEntry, b: CustomsEntry | undefined) =>
    !!b && a.cusdec_no === b.cusdec_no && a.invoice_no === b.invoice_no;
  const Row = ({ e, prev }: { e: CustomsEntry; prev?: CustomsEntry }) => {
    const busy = docs.busyId === e.id || savingId === e.id;
    // Header fields print on the first item line of a declaration only; later items repeat them muted.
    const first = !sameDoc(e, prev);
    const hdr = first ? "" : "text-muted";
    /** A field's cell: an input while an admin edits (declaration fields are saved to every line of the CusDec), else the shown value. */
    const cell = (
      field: keyof CustomsEditable,
      shown: ReactNode,
      kind: "text" | "int" | "num" = "text",
      places = 2,
      width = "w-[100px]",
    ) => {
      if (!editing) return shown;
      const raw = e[field];
      const value = raw == null ? "" : String(raw);
      return (
        <CellInput
          key={e.id + ":" + field + ":" + value}
          value={value}
          kind={kind === "text" ? "text" : "num"}
          className={width}
          disabled={busy}
          label={`${field.replace(/_/g, " ")} for CusDec ${e.cusdec_no} item ${e.item_no}`}
          onCommit={commit(e, field, kind, places)}
        />
      );
    };
    return (
      <tr className={busy ? "opacity-60" : undefined}>
        <td className={"wrapc " + hdr}>
          {cell("file_name", cusdecFileName(e) || <span className="text-muted">—</span>, "text", 0, "w-[110px]")}
        </td>
        <td className={hdr}>{cell("cusdec_no", e.cusdec_no)}</td>
        <td className={hdr}>{cell("cusdec_date", e.cusdec_date ?? "")}</td>
        <td className={hdr}>{cell("cusdec_month", e.cusdec_month ?? "", "text", 0, "w-[90px]")}</td>
        <td className={hdr}>{cell("invoice_no", e.invoice_no)}</td>
        <td className="num border-l border-line">{cell("item_no", e.item_no, "int", 0, "w-[60px]")}</td>
        <td>{cell("hs_code", e.hs_code ?? "")}</td>
        <td className="wrapc">{cell("description", e.description ?? "", "text", 0, "w-[200px]")}</td>
        <td className={"wrapc " + hdr}>{cell("party", e.party ?? "", "text", 0, "w-[160px]")}</td>
        <td>{cell("uom", e.uom ?? "", "text", 0, "w-[60px]")}</td>
        <td className="num">{cell("quantity", qty(e.quantity), "num", 3)}</td>
        <td className={"border-l border-line " + hdr}>{cell("currency_type", e.currency_type ?? "", "text", 0, "w-[60px]")}</td>
        <td className={"num " + hdr}>{cell("ex_rate", e.ex_rate == null ? "" : String(e.ex_rate), "num", 6)}</td>
        <td className={"num " + hdr}>{cell("invoice_value", fmt(e.invoice_value), "num", 2, "w-[120px]")}</td>
        <td className="num">{cell("customs_value", fmt(e.customs_value), "num", 2, "w-[120px]")}</td>
        <td className="num border-l border-line">{cell("cid_amount", fmt(e.cid_amount), "num")}</td>
        <td className="text-center">{cell("cid_code", e.cid_code ?? "", "text", 0, "w-[60px]")}</td>
        <td className="num">{cell("pal_amount", fmt(e.pal_amount), "num")}</td>
        <td className="text-center">{cell("pal_code", e.pal_code ?? "", "text", 0, "w-[60px]")}</td>
        <td className="num">{cell("sscl_amount", fmt(e.sscl_amount), "num")}</td>
        <td className="text-center">{cell("sscl_code", e.sscl_code ?? "", "text", 0, "w-[60px]")}</td>
        <td className="num">{cell("vat_base", fmt(e.vat_base), "num", 2, "w-[120px]")}</td>
        <td className="num">{cell("vat_amount", fmt(e.vat_amount), "num", 2, "w-[110px]")}</td>
        <td className="text-center">{cell("vat_type", e.vat_type ?? "", "text", 0, "w-[60px]")}</td>
        <td className="text-center">{cell("vat_code", e.vat_code ?? "", "text", 0, "w-[60px]")}</td>
        {docs.cells(e)}
      </tr>
    );
  };
  const Totals = ({ rows, label }: { rows: CustomsEntry[]; label: string }) => (
    <tr className="total">
      <td colSpan={14}>
        {label} · {cusdecs(rows)} CusDec{cusdecs(rows) === 1 ? "" : "s"}, {rows.length} item line{rows.length === 1 ? "" : "s"}
      </td>
      <td className="num">{fmt(sum(rows, (r) => r.customs_value ?? 0))}</td>
      <td className="num border-l border-line">{fmt(sum(rows, (r) => r.cid_amount ?? 0))}</td>
      <td></td>
      <td className="num">{fmt(sum(rows, (r) => r.pal_amount ?? 0))}</td>
      <td></td>
      <td className="num">{fmt(sum(rows, (r) => r.sscl_amount ?? 0))}</td>
      <td></td>
      <td className="num">{fmt(sum(rows, (r) => r.vat_base ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.vat_amount ?? 0))}</td>
      <td colSpan={5}></td>
    </tr>
  );

  return (
    <>
      {p.upload && <CustomsUpload direction="import" />}
      {p.upload && <BulkCustomsDocs direction="import" entries={entries} onDone={reload} />}

      <div className="bar">
        <label className="field">
          View from
          <select className="control" value={f} onChange={(e) => setFrom(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} lines` : ""}
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
                {countFor(m) ? ` · ${countFor(m)} lines` : ""}
              </option>
            ))}
          </select>
        </label>
        <CustomsSearch value={q} onChange={setQ} />
        <ClearFilters state={cf} />
        {p.edit && <EditSwitch on={editOn} onChange={setEditOn} />}
        <span className="note pb-1.5">
          {cusdecs(all)} CusDec{cusdecs(all) === 1 ? "" : "s"}, {all.length} item line{all.length === 1 ? "" : "s"} · value for VAT{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => r.vat_base ?? 0))}</span>
          {" · "}VAT as per customs{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => r.vat_amount ?? 0))}</span>
          {" · "}
          {cusdecs(all.filter((r) => r.doc_path))} with the CusDec held · {cusdecs(all.filter((r) => r.other_doc_path))} with other
          documents · {cusdecs(all.filter((r) => r.all_doc_path))} with all documents
          {undated.length > 0 && (
            <>
              {" · "}
              <span className="text-warn">
                {undated.length} line{undated.length === 1 ? "" : "s"} without a readable date (listed last)
              </span>
            </>
          )}
        </span>
      </div>

      {docs.input}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th colSpan={5} className="text-center" style={{ position: "static" }}>
                Declaration
              </th>
              <th colSpan={6} className="text-center border-l border-line" style={{ position: "static" }}>
                Item
              </th>
              <th colSpan={4} className="text-center border-l border-line" style={{ position: "static" }}>
                Values
              </th>
              <th colSpan={10} className="text-center border-l border-line" style={{ position: "static" }}>
                Taxes as per customs (amount and MP code)
              </th>
              <th colSpan={3} className="text-center border-l border-line" style={{ position: "static" }}>
                Documents
              </th>
            </tr>
            <tr>
              <th>File name</th>
              <th>Cusdec no</th>
              <th>Date</th>
              <th>Month</th>
              <th>Invoice no</th>
              <th className="num border-l border-line">Item</th>
              <th>HS code</th>
              <th>Description</th>
              <th>Supplier</th>
              <th>UOM</th>
              <th className="num">Quantity</th>
              <th className="border-l border-line">Currency</th>
              <th className="num">Ex. rate customs LKR</th>
              <th className="num">Invoice value as per USD / EUR</th>
              <th className="num">Customs value</th>
              <th className="num border-l border-line">CID</th>
              <th>Code</th>
              <th className="num">PAL</th>
              <th>Code</th>
              <th className="num">SSCL</th>
              <th>Code</th>
              <th className="num">Value for VAT</th>
              <th className="num">VAT</th>
              <th>Type</th>
              <th>Code</th>
              <CustomsDocHeadings perm={p} />
            </tr>
            <FilterRow state={cf} />
          </thead>
          <tbody>
            {loading && !entries.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !groups.length && !undated.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  {searching ? (
                    `No lines in the tax year match “${q.trim()}”.`
                  ) : cf.active ? (
                    "No lines match the column filters."
                  ) : (
                    <>
                      No import customs entries for {lo === hi ? mLabel(lo) : `${mLabel(lo)} to ${mLabel(hi)}`}.
                      {p.upload ? " Upload the CusDec PDFs or a spreadsheet of entries above." : ""}
                    </>
                  )}
                </td>
              </tr>
            ) : (
              <>
                {groups.map((g) => (
                  <GroupRows key={g.month} rows={g.rows} label={g.label} Row={Row} Totals={Totals} />
                ))}
                {undated.length > 0 && <GroupRows rows={undated} label="No readable date" Row={Row} Totals={Totals} />}
                {groups.length > 1 && <Totals rows={all} label="Total" />}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        One line per item (HS code line) of each import CusDec, as read from the uploaded CusDec PDFs or spreadsheet,
        under the month of the CusDec date; a declaration with several items has its reference, date, rate and invoice
        repeated on each line. Customs value is the item’s statistical value (box 46). The tax columns are the CID, PAL,
        SSCL and VAT lines of the item’s tax table with their MP codes; Value for VAT is the VAT line’s tax base and feeds
        the imports check on the VAT reconciliation tab. Uploading the same CusDec and invoice number again replaces its
        lines. Each CusDec keeps three files, whether its lines came from the PDFs or a spreadsheet: the CusDec itself,
        the other documents (invoice, packing list, bill of lading) and all documents as one bundle; upload or open them
        in the Documents columns.
        {p.edit &&
          " With edit permission the uploaded data can be corrected with “Edit uploaded data”: every column of every item line, with a declaration column (CusDec, date, month, invoice, supplier, currency, rate, invoice value) saved to all lines of its CusDec. Uploading that CusDec again replaces the corrections."}
      </div>
    </>
  );
}

function GroupRows({
  rows,
  label,
  Row,
  Totals,
}: {
  rows: CustomsEntry[];
  label: string;
  Row: (p: { e: CustomsEntry; prev?: CustomsEntry }) => React.JSX.Element;
  Totals: (p: { rows: CustomsEntry[]; label: string }) => React.JSX.Element;
}) {
  return (
    <>
      {rows.map((e, i) => (
        <Row key={e.id} e={e} prev={rows[i - 1]} />
      ))}
      <Totals rows={rows} label={label} />
    </>
  );
}
