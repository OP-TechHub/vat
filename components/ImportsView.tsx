"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import CustomsUpload from "./CustomsUpload";
import { DocActions, DocHeading } from "./DocActions";
import { fmt, mLabel, sum } from "@/lib/format";
import { cusdecDocumentUrl, removeCusdecDocument, uploadCusdecDocument } from "@/lib/customsDocs";
import { customsEntryMonth } from "@/lib/matchDocuments";
import type { CustomsEntry } from "@/lib/types";

/** What the CusDec column's action buttons work on. */
interface CusdecDoc {
  filename: string;
  entry: CustomsEntry;
}

const UNDATED = "undated";
/** Columns of the register table, for the empty / loading rows. */
const COLS = 25;

/** Quantity with up to three decimals, without trailing zeros. */
const qty = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("en-LK", { maximumFractionDigits: 3 });

/**
 * Import Register: every import customs entry (one line per CusDec item) held for the company,
 * grouped by CusDec month within the selected tax year, with the stored CusDec file. Entries come
 * from the CusDec PDF / spreadsheet upload above the table.
 */
export default function ImportsView() {
  const { supabase, company, months, data, loading, canWrite, reload, flash } = useApp();
  const entries = data.importEntries;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  /** Entries by month key, in CusDec and item order; entries whose date cannot be read go under UNDATED. */
  const byMonth = useMemo(() => {
    const m = new Map<string, CustomsEntry[]>();
    const sorted = [...entries].sort(
      (a, b) => a.cusdec_no.localeCompare(b.cusdec_no) || a.invoice_no.localeCompare(b.invoice_no) || a.item_no - b.item_no,
    );
    for (const e of sorted) {
      const k = customsEntryMonth(e) ?? UNDATED;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [entries]);
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
        .filter((k) => k >= lo && k <= hi)
        .map((k) => ({ month: k, label: mLabel(k), rows: byMonth.get(k) ?? [] }))
        .filter((g) => g.rows.length),
    [months, lo, hi, byMonth],
  );
  const undated = byMonth.get(UNDATED) ?? [];
  const all = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const cusdecs = (rows: CustomsEntry[]) => new Set(rows.map((r) => r.cusdec_no + "|" + r.invoice_no)).size;

  // CusDec document actions (Open / Upload / Replace / Remove) on the stored customs entry; the file
  // is shared by every item line of the declaration.
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const docTarget = useRef<CustomsEntry | null>(null);
  async function onDocFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const entry = docTarget.current;
    e.target.value = "";
    if (!file || !entry || !company) return;
    setDocBusy(entry.id);
    try {
      await uploadCusdecDocument(supabase, company.id, "import", entry, file, entry.doc_path);
      flash(`CusDec ${entry.cusdec_no} file kept.`);
      await reload();
    } catch (err) {
      flash("Could not upload: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setDocBusy(null);
  }
  async function openDoc(d: CusdecDoc) {
    try {
      window.open(await cusdecDocumentUrl(supabase, d.entry.doc_path!), "_blank", "noopener");
    } catch (err) {
      flash("Could not open the file: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }
  async function removeDoc(d: CusdecDoc) {
    if (!window.confirm(`Remove the CusDec file for ${d.entry.cusdec_no} (${d.filename})?`)) return;
    setDocBusy(d.entry.id);
    try {
      await removeCusdecDocument(supabase, d.entry);
      flash(`CusDec ${d.entry.cusdec_no} file removed.`);
      await reload();
    } catch (err) {
      flash("Could not remove: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setDocBusy(null);
  }

  const sameDoc = (a: CustomsEntry, b: CustomsEntry | undefined) =>
    !!b && a.cusdec_no === b.cusdec_no && a.invoice_no === b.invoice_no;
  const Row = ({ e, prev }: { e: CustomsEntry; prev?: CustomsEntry }) => {
    const busy = docBusy === e.id;
    // Header fields print on the first item line of a declaration only; later items repeat them muted.
    const first = !sameDoc(e, prev);
    const hdr = first ? "" : "text-muted";
    return (
      <tr className={busy ? "opacity-60" : undefined}>
        <td className={hdr}>{e.cusdec_no}</td>
        <td className={hdr}>{e.cusdec_date ?? ""}</td>
        <td className={hdr}>{e.cusdec_month ?? ""}</td>
        <td className={hdr}>{e.invoice_no}</td>
        <td className="num border-l border-line">{e.item_no}</td>
        <td>{e.hs_code ?? ""}</td>
        <td className="wrapc">{e.description ?? ""}</td>
        <td className={"wrapc " + hdr}>{e.party ?? ""}</td>
        <td>{e.uom ?? ""}</td>
        <td className="num">{qty(e.quantity)}</td>
        <td className={"border-l border-line " + hdr}>{e.currency_type ?? ""}</td>
        <td className={"num " + hdr}>{e.ex_rate == null ? "" : String(e.ex_rate)}</td>
        <td className={"num " + hdr}>{fmt(e.invoice_value)}</td>
        <td className="num">{fmt(e.customs_value)}</td>
        <td className="num border-l border-line">{fmt(e.cid_amount)}</td>
        <td className="text-center">{e.cid_code ?? ""}</td>
        <td className="num">{fmt(e.pal_amount)}</td>
        <td className="text-center">{e.pal_code ?? ""}</td>
        <td className="num">{fmt(e.sscl_amount)}</td>
        <td className="text-center">{e.sscl_code ?? ""}</td>
        <td className="num">{fmt(e.vat_base)}</td>
        <td className="num">{fmt(e.vat_amount)}</td>
        <td className="text-center">{e.vat_type ?? ""}</td>
        <td className="text-center">{e.vat_code ?? ""}</td>
        <td className="border-l border-line">
          <DocActions<CusdecDoc>
            doc={e.doc_path ? { filename: e.doc_name ?? e.cusdec_no, entry: e } : null}
            canWrite={canWrite}
            busy={busy}
            yes="Held"
            no="None"
            pillClass="pill-info"
            onOpen={(d) => void openDoc(d)}
            onPick={() => {
              docTarget.current = e;
              docFileRef.current?.click();
            }}
            onRemove={(d) => void removeDoc(d)}
          />
        </td>
      </tr>
    );
  };
  const Totals = ({ rows, label }: { rows: CustomsEntry[]; label: string }) => (
    <tr className="total">
      <td colSpan={13}>
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
      <td colSpan={3}></td>
    </tr>
  );

  return (
    <>
      {canWrite && <CustomsUpload direction="import" />}

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
        <span className="note pb-1.5">
          {cusdecs(all)} CusDec{cusdecs(all) === 1 ? "" : "s"}, {all.length} item line{all.length === 1 ? "" : "s"} · value for VAT{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => r.vat_base ?? 0))}</span>
          {" · "}VAT as per customs{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => r.vat_amount ?? 0))}</span>
          {" · "}
          {all.filter((r) => r.doc_path).length} line{all.filter((r) => r.doc_path).length === 1 ? "" : "s"} with the CusDec file held
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

      <input ref={docFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => void onDocFile(e)} />

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th colSpan={4} className="text-center" style={{ position: "static" }}>
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
              <th className="text-center border-l border-line" style={{ position: "static" }}>
                Document
              </th>
            </tr>
            <tr>
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
              <DocHeading title="CusDec" canWrite={canWrite} className="border-l border-line" />
            </tr>
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
                  No import customs entries for {lo === hi ? mLabel(lo) : `${mLabel(lo)} to ${mLabel(hi)}`}.
                  {canWrite ? " Upload the CusDec PDFs or a spreadsheet of entries above." : ""}
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
        lines.
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
