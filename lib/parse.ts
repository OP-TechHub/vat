/**
 * Upload parsing for ledger invoice lists and IRD input schedules.
 * Ported faithfully from reference/prototype.html (parseUpload, xlDate, xlText, num).
 * Pure functions: no DOM, no storage, so they run in the browser and in unit tests.
 */
import * as XLSX from "xlsx";
import { MN, mLabel, fmt, sum, cents, periodCode } from "./format";
import {
  CAGES,
  type CageField,
  type CustomsUploadRow,
  type ExportUploadRow,
  type LedgerUploadRow,
  type ReconDirection,
  type ReturnPeriodRow,
  type ScheduleUploadRow,
} from "./types";
import { kindsFromText, periodFromText, type IndexRow } from "./matchDocuments";
import {
  comparePeriods,
  cusdecsAvailability,
  isPeriodCode,
  periodFromLabel,
  periodLabel,
  schedulesSubmitted,
  submissionTotals,
  type SubmissionRow,
} from "./submissions";

export type UploadKind = "ledger" | "schedule" | "export" | "import";

/**
 * Excel serial number or dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd text -> "YYYY-MM-DD".
 * Anything unrecognised is returned trimmed as-is.
 */
export function xlDate(v: unknown): string {
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  // A bare 5-digit number in a CSV is an Excel date serial written out as text.
  if (/^\d{5}$/.test(s)) return xlDate(Number(s));
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)))
    return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/)))
    return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return s;
}

/** Cell to display text. Excel date serials become dd.mm.yyyy; everything else is trimmed. */
export function xlText(v: unknown): string {
  if ((typeof v === "number" && v > 40000 && v < 60000) || v instanceof Date) {
    const d = xlDate(v);
    return d.slice(8) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
  }
  return String(v ?? "").trim();
}

/** Cell to a number rounded to cents. Strips thousands separators. 0 when not numeric. */
export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) ? 0 : cents(n);
};

/** Cell to a number, or null when blank or not numeric. `places` decimals (default 2). */
export const numOrNull = (v: unknown, places = 2): number | null => {
  if (v == null || String(v).trim() === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  if (isNaN(n)) return null;
  const p = 10 ** places;
  return Math.round(n * p) / p;
};

export interface ParsedUpload<R> {
  kind: UploadKind;
  month: string; // YYYY-MM
  sheet: string;
  rows: R[];
  skipped: number;
  total: number; // ledger: sum of amount_lcy; schedule: sum of vat_amount
  text: string;
}

export class UploadError extends Error {}

type Cell = string | number | boolean | Date | null;

const SHEET_NAME: Record<UploadKind, RegExp> = {
  ledger: /invoice listing/i,
  schedule: /input/i,
  export: /export/i,
  import: /import|purchase/i,
};

function readSheet(buf: ArrayBuffer | Uint8Array, kind: UploadKind) {
  // raw: true keeps CSV cells as written, so "01/05/2026" is not re-read as a US date (5 January).
  // Workbook cells already carry their types and are unaffected.
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  const want = SHEET_NAME[kind];
  const name = wb.SheetNames.find((n) => want.test(n)) || wb.SheetNames[0];
  if (!name) throw new UploadError("The file has no worksheets.");
  const A = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
  return { name, A };
}

function findHeader(A: Cell[][], key: RegExp, label: string, sheet: string) {
  const hi = A.slice(0, 15).findIndex((r) => r.some((c) => key.test(String(c))));
  if (hi < 0)
    throw new UploadError(
      `Could not find the ${label} column heading in sheet “${sheet}”. Check the file has the expected headings.`,
    );
  const H = A[hi].map((c) => String(c).toLowerCase().replace(/\s+/g, " ").trim());
  const col = (...res: RegExp[]) => {
    for (const re of res) {
      const i = H.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  return { hi, col };
}

const str = (v: Cell | undefined) => String(v ?? "").trim();

/**
 * Parse a ledger invoice list. Only rows posted in `month` ("YYYY-MM") are kept.
 * Duplicate invoice numbers are summed. `existing` is the count of rows already held for the month.
 */
export function parseLedger(
  buf: ArrayBuffer | Uint8Array,
  month: string,
  existing = 0,
): ParsedUpload<LedgerUploadRow> {
  const { name, A } = readSheet(buf, "ledger");
  const { hi, col } = findHeader(A, /posting date/i, "Posting Date", name);
  const c = {
    no: col(/^invoice no/, /^document no/),
    date: col(/posting date/),
    vendor: col(/vendor/),
    ext: col(/external doc/),
    desc: col(/^description/),
    amt: col(/^amount \(lcy\)/, /^amount/),
    src: col(/source currency/),
  };
  if (c.no < 0 || c.amt < 0)
    throw new UploadError("The file needs Invoice No. (or Document No.) and Amount (LCY) columns.");
  const body = A.slice(hi + 1);
  const rows: LedgerUploadRow[] = [];
  const by: Record<string, LedgerUploadRow> = {};
  let skipped = 0;
  for (const r of body) {
    const no = str(r[c.no]);
    if (!no) continue;
    const d = xlDate(r[c.date]);
    if (d.slice(0, 7) !== month) {
      skipped++;
      continue;
    }
    if (by[no]) {
      by[no].amount_lcy = num(by[no].amount_lcy + num(r[c.amt]));
      continue;
    }
    by[no] = {
      invoice_no: no,
      posting_date: d,
      vendor_name: c.vendor < 0 ? "" : str(r[c.vendor]),
      external_doc_no: c.ext < 0 ? "" : str(r[c.ext]),
      description: c.desc < 0 ? "" : str(r[c.desc]),
      amount_lcy: num(r[c.amt]),
      source_amount: c.src < 0 ? 0 : num(r[c.src]),
    };
    rows.push(by[no]);
  }
  if (!rows.length) throw noRows(month, name, skipped);
  const total = cents(sum(rows, (r) => r.amount_lcy));
  return {
    kind: "ledger",
    month,
    sheet: name,
    rows,
    skipped,
    total,
    text: previewText("ledger", name, rows.length, month, total, skipped, existing),
  };
}

/**
 * Parse an IRD input schedule. If the file has a Month column holding several months,
 * only the chosen month's rows are kept. Blank VAT Amount is taken as 18% of the value.
 */
export function parseSchedule(
  buf: ArrayBuffer | Uint8Array,
  month: string,
  existing = 0,
): ParsedUpload<ScheduleUploadRow> {
  const { name, A } = readSheet(buf, "schedule");
  const { hi, col } = findHeader(A, /tax invoice no/i, "Tax Invoice No", name);
  const c = {
    m: col(/^month/),
    sn: col(/serial/),
    date: col(/invoice date/),
    inv: col(/tax invoice no/),
    tin: col(/tin/),
    sup: col(/supplier$/, /name of/),
    desc: col(/^description/),
    val: col(/value of purchase/, /value/),
    vat: col(/vat amount/, /vat/),
  };
  const body = A.slice(hi + 1);
  const ab = MN[+month.slice(5) - 1].toUpperCase();
  const multi =
    c.m >= 0 &&
    new Set(body.map((r) => str(r[c.m]).toUpperCase().slice(0, 3)).filter(Boolean)).size > 1;
  const rows: ScheduleUploadRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const inv = xlText(r[c.inv]);
    if (!inv && !num(r[c.val])) continue;
    if (!inv) {
      skipped++;
      continue;
    }
    if (multi && str(r[c.m]).toUpperCase().slice(0, 3) !== ab) {
      skipped++;
      continue;
    }
    const value = num(r[c.val]);
    rows.push({
      serial_no: c.sn < 0 ? String(rows.length + 1) : str(r[c.sn]),
      invoice_date: c.date < 0 ? "" : xlText(r[c.date]),
      tax_invoice_no: inv,
      supplier_tin: c.tin < 0 ? "" : str(r[c.tin]),
      supplier_name: c.sup < 0 ? "" : str(r[c.sup]),
      description: c.desc < 0 ? "" : str(r[c.desc]),
      purchase_value: value,
      vat_amount: c.vat < 0 || r[c.vat] === "" ? num(value * 0.18) : num(r[c.vat]),
    });
  }
  if (!rows.length) throw noRows(month, name, skipped);
  const total = cents(sum(rows, (r) => r.vat_amount));
  return {
    kind: "schedule",
    month,
    sheet: name,
    rows,
    skipped,
    total,
    text: previewText("schedule", name, rows.length, month, total, skipped, existing),
  };
}

/** True when a cell holds a month name or "Jul 2025"-style label for the given month key (first 3 letters). */
const sameMonth = (cell: unknown, month: string) => {
  const s = str(cell as Cell);
  if (!s) return false;
  const ab = MN[+month.slice(5) - 1].toUpperCase();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7) === month;
  if (typeof cell === "number") return xlDate(cell).slice(0, 7) === month;
  return s.toUpperCase().slice(0, 3) === ab;
};

/**
 * Parse an export reconciliation sheet (the monthly export sales report with its customs columns).
 * Only the "Details in sales report" columns are required: Invoice No, Amount FC (FOB), Ex.rate,
 * Net Sales. The customs and difference columns are taken when present and may be left blank.
 * If the file has a Month column holding several months, only the chosen month's rows are kept.
 * Blank Net Sales is taken as Amount x Ex.rate; blank Custom Value as invoice value x customs rate.
 */
export function parseExport(
  buf: ArrayBuffer | Uint8Array,
  month: string,
  existing = 0,
  direction: ReconDirection = "export",
): ParsedUpload<ExportUploadRow> {
  const { name, A } = readSheet(buf, direction);
  const { hi, col } = findHeader(A, /^\s*invoice no/i, "Invoice No", name);
  const c = {
    inv: col(/^invoice no/),
    m: col(/^month$/, /^month/),
    amt: col(/^amount/, /fob/, /cif/),
    rate: col(/^ex\.? ?rate$/, /^ex\.? ?rate(?!.*custom)/),
    net: col(/net sales/, /net value/, /ledger value/, /value \(a\)/, /\(lcy\)/),
    cusdec: col(/cusdec/),
    date: col(/^date/),
    cmonth: col(/^month/), // first Month column is the sales one; customs Month found below
    cur: col(/currency/),
    crate: col(/ex\.? ?rate.*custom/, /custom.*rate/),
    cval: col(/invoice val/),
    cvalue: col(/^custom value/, /customs? value/),
    short: col(/short ship/),
    rev: col(/sales rev/),
    upd: col(/updated in custom/),
    cvbase: direction === "import" ? col(/value for vat/, /vat base/, /taxable value/) : -1,
    cvat: direction === "import" ? col(/vat as per/, /vat amount/, /deferred/, /custom.*vat/, /^vat$/, /^vat/) : -1,
  };
  // The sheet has two "Month" columns: sales report, then customs. Use the second if present.
  {
    const H = A[hi].map((x) => String(x).toLowerCase().replace(/\s+/g, " ").trim());
    const months = H.map((h, i) => (/^month$/.test(h) ? i : -1)).filter((i) => i >= 0);
    c.cmonth = months.length > 1 ? months[1] : -1;
  }
  if (c.inv < 0 || c.amt < 0)
    throw new UploadError("The file needs Invoice No and Amount FC (FOB) columns.");
  const body = A.slice(hi + 1);
  const multi =
    c.m >= 0 && new Set(body.map((r) => str(r[c.m]).toUpperCase().slice(0, 3)).filter(Boolean)).size > 1;
  const rows: ExportUploadRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of body) {
    const inv = str(r[c.inv]);
    if (!inv) continue;
    // Subtotal rows carry a month label ("July 2025") where the invoice number would be.
    if (/^[a-z]{3,9}\s+\d{4}$/i.test(inv) || /^total/i.test(inv)) continue;
    if (c.m >= 0 && !str(r[c.m])) {
      skipped++;
      continue;
    }
    if (multi && !sameMonth(r[c.m], month)) {
      skipped++;
      continue;
    }
    if (seen.has(inv)) {
      skipped++;
      continue;
    }
    seen.add(inv);
    const amount = num(r[c.amt]);
    const rate = c.rate < 0 ? null : numOrNull(r[c.rate], 6);
    const net = c.net < 0 ? null : numOrNull(r[c.net]);
    const crate = c.crate < 0 ? null : numOrNull(r[c.crate], 6);
    const cval = c.cval < 0 ? null : numOrNull(r[c.cval]);
    const cvalue = c.cvalue < 0 ? null : numOrNull(r[c.cvalue]);
    const cur = c.cur < 0 ? "" : str(r[c.cur]).toUpperCase();
    rows.push({
      invoice_no: inv,
      amount_fc: amount,
      ex_rate: rate,
      net_sales: net ?? (rate != null ? cents(amount * rate) : 0),
      cusdec_no: c.cusdec < 0 ? "" : xlText(r[c.cusdec]),
      cusdec_date: c.date < 0 ? "" : xlText(r[c.date]),
      cusdec_month: c.cmonth < 0 ? "" : xlText(r[c.cmonth]),
      currency_type: cur === "EUR" ? "EUR" : cur === "USD" ? "USD" : "",
      custom_ex_rate: crate,
      custom_invoice_value: cval,
      custom_value: cvalue ?? (crate != null && cval != null ? cents(crate * cval) : null),
      short_shipment: c.short < 0 ? null : numOrNull(r[c.short]),
      sales_reversed: c.rev < 0 ? null : numOrNull(r[c.rev]),
      updated_in_custom_report: c.upd < 0 ? "" : xlText(r[c.upd]),
      ...(direction === "import"
        ? {
            custom_vat_base: c.cvbase < 0 ? null : numOrNull(r[c.cvbase]),
            custom_vat_amount: c.cvat < 0 ? null : numOrNull(r[c.cvat]),
          }
        : {}),
    });
  }
  if (!rows.length) throw noRows(month, name, skipped);
  const total = cents(sum(rows, (r) => r.net_sales));
  return {
    kind: direction,
    month,
    sheet: name,
    rows,
    skipped,
    total,
    text: previewText(direction, name, rows.length, month, total, skipped, existing),
  };
}

/**
 * Parse customs entries (CusDec lines) for exports or imports. Columns are matched by heading text:
 * Cusdec No, Date, Invoice No, Currency, Ex. Rate, Invoice Value (FC), Customs Value (LKR), VAT Amount
 * (imports), Consignee / Supplier, Description, To Complete (Yes tags the line), Remarks. A CusDec needs at
 * least a CusDec number and, for exports, an invoice number (logbook imports may have none). Blank Customs
 * Value is taken as invoice value x rate. Rows repeating the same CusDec, invoice and item keep the last. The sheet named like "customs" / "cusdec" is used, else the first.
 */
export function parseCustoms(
  buf: ArrayBuffer | Uint8Array,
  direction: ReconDirection,
): { sheet: string; rows: CustomsUploadRow[]; skipped: number; text: string } {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  const name = wb.SheetNames.find((n) => /cusdec|customs|entries|declaration/i.test(n)) || wb.SheetNames[0];
  if (!name) throw new UploadError("The file has no worksheets.");
  const A = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
  const { hi, col } = findHeader(A, /cus ?dec|declaration|entry ?no/i, "Cusdec No", name);
  const c = {
    cusdec: col(/cus ?dec ?(no|number)/, /declaration ?(no|number)/, /entry ?(no|number)/, /cus ?dec/, /declaration/),
    date: col(/cus ?dec date/, /declaration date/, /entry date/, /^date/, /date/),
    inv: col(/invoice ?(no|number)/, /invoice/, /document ?no/),
    cur: col(/currency/, /^cur$/),
    rate: col(/ex\.? ?rate/, /exchange/, /rate/),
    fc: col(/invoice value/, /fob/, /cif/, /fc value/, /value.*(usd|eur|fc)/, /foreign/),
    lkr: col(/customs? value/, /assessed/, /value \(lkr\)/, /lkr/),
    vbase: col(/vat base/, /value for vat/, /tax base/),
    vat: col(/vat amount/, /deferred/, /^vat$/, /^vat \(/, /^vat$/),
    vcode: col(/vat code/, /vat mp/),
    vtype: col(/vat type/),
    item: col(/item ?(no|number)/, /^item$/),
    hs: col(/hs ?code/, /commodity/, /^hs$/),
    uom: col(/^uom/, /unit/),
    qty: col(/quantity/, /^qty/),
    cid: col(/^cid$/, /cid amount/, /cid value/, /^cid/),
    cidc: col(/cid code/, /cid mp/),
    pal: col(/^pal$/, /pal amount/, /pal value/, /^pal/),
    palc: col(/pal code/, /pal mp/),
    sscl: col(/^sscl$/, /^ssl$/, /sscl amount/, /sscl value/, /^sscl/, /^ssl/),
    ssclc: col(/sscl code/, /ssl code/, /sscl mp/),
    party: col(/consignee/, /exporter/, /importer/, /supplier/, /party/, /^name/),
    desc: col(/description/, /goods/),
    m: col(/^month/),
    file: col(/file ?name/, /^file$/, /^pdf/),
    tag: col(/to ?complete/, /incomplete/),
    remarks: col(/remarks?/, /^notes?$/),
  };
  const needInvoice = direction === "export";
  if (c.cusdec < 0 || (needInvoice && c.inv < 0))
    throw new UploadError(
      `The file needs ${needInvoice ? "Cusdec No and Invoice No columns" : "a Cusdec No column"} (sheet “${name}”).`,
    );
  const by = new Map<string, CustomsUploadRow>();
  let skipped = 0;
  for (const r of A.slice(hi + 1)) {
    const cusdec = xlText(r[c.cusdec]);
    const inv = c.inv < 0 ? "" : xlText(r[c.inv]);
    if (!cusdec && !inv) continue;
    if (!cusdec || (needInvoice && !inv) || /^total/i.test(cusdec)) {
      skipped++;
      continue;
    }
    const d = c.date < 0 ? "" : xlDate(r[c.date]);
    const monthFromDate = /^\d{4}-\d{2}-\d{2}$/.test(d) ? mLabel(d.slice(0, 7)) : null;
    const rate = c.rate < 0 ? null : numOrNull(r[c.rate], 6);
    const fc = c.fc < 0 ? null : numOrNull(r[c.fc]);
    const lkr = c.lkr < 0 ? null : numOrNull(r[c.lkr]);
    const itemNo = c.item < 0 ? null : numOrNull(r[c.item], 0);
    const item_no = itemNo && itemNo > 0 ? itemNo : 1;
    const text = (i: number) => (i < 0 ? null : str(r[i]) || null);
    const amount = (i: number) => (i < 0 ? null : numOrNull(r[i]));
    by.set(cusdec + "|" + inv.toUpperCase().replace(/\s+/g, "") + "|" + item_no, {
      cusdec_no: cusdec,
      cusdec_date: c.date < 0 ? "" : xlText(r[c.date]),
      cusdec_month: monthFromDate ?? (c.m < 0 ? null : xlText(r[c.m]) || null),
      invoice_no: inv,
      currency_type: c.cur < 0 ? "" : str(r[c.cur]).toUpperCase(),
      ex_rate: rate,
      invoice_value: fc,
      customs_value: lkr ?? (rate != null && fc != null ? cents(rate * fc) : null),
      vat_base: c.vbase < 0 || c.vbase === c.vat ? null : numOrNull(r[c.vbase]),
      vat_amount: c.vat < 0 ? null : numOrNull(r[c.vat]),
      party: c.party < 0 ? "" : str(r[c.party]),
      description: c.desc < 0 ? "" : str(r[c.desc]),
      item_no,
      hs_code: text(c.hs),
      uom: text(c.uom),
      quantity: c.qty < 0 ? null : numOrNull(r[c.qty], 3),
      cid_amount: amount(c.cid),
      cid_code: text(c.cidc),
      pal_amount: amount(c.pal),
      pal_code: text(c.palc),
      sscl_amount: amount(c.sscl),
      sscl_code: text(c.ssclc),
      vat_type: text(c.vtype),
      vat_code: text(c.vcode),
      file_name: text(c.file),
      to_complete: c.tag >= 0 && /^(y|yes|true|1|x)$/i.test(str(r[c.tag])),
      remarks: text(c.remarks),
    });
  }
  const rows = [...by.values()];
  if (!rows.length) throw new UploadError(`No customs entries were found in sheet “${name}”.`);
  const value = cents(sum(rows, (r) => r.customs_value ?? 0));
  const tagged = rows.filter((r) => r.to_complete).length;
  return {
    sheet: name,
    rows,
    skipped,
    text:
      `Sheet “${name}”: ${rows.length} ${direction} customs entries, customs value ${fmt(value)}.` +
      (tagged ? ` ${tagged} of them are tagged “To complete”.` : "") +
      (skipped ? ` ${skipped} rows without a CusDec${needInvoice ? " or invoice" : ""} number were left out.` : "") +
      " Saving adds or updates these entries and fills the customs columns of matching invoices.",
  };
}

/** Blank template for a customs entries upload. */
export function customsTemplateWorkbook(direction: ReconDirection): XLSX.WorkBook {
  const head = [
    "File Name",
    "Cusdec No",
    "Date",
    "Invoice No",
    "Item No",
    "HS Code",
    "Description",
    "UOM",
    "Quantity",
    "Currency",
    "Ex. Rate",
    "Invoice Value (FC)",
    "Customs Value (LKR)",
    ...(direction === "import"
      ? ["CID Amount", "CID Code", "PAL Amount", "PAL Code", "SSCL Amount", "SSCL Code", "VAT Base", "VAT Amount", "VAT Code"]
      : []),
    direction === "import" ? "Supplier" : "Consignee",
    ...(direction === "import" ? ["To Complete", "Remarks"] : []),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([head]);
  ws["!cols"] = head.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, direction === "import" ? "Import Customs Entries" : "Export Customs Entries");
  return wb;
}

export const customsTemplateFilename = (direction: ReconDirection) =>
  (direction === "import" ? "Import" : "Export") + " customs entries template.xlsx";

/** Cage code (column B of the workbook, spaces removed) -> vat_returns field. */
const CAGE_FIELD: Record<string, CageField> = Object.fromEntries(CAGES.map(([field, code]) => [code, field]));

export interface ParsedReturns {
  sheet: string;
  /** Ascending by period. */
  periods: ReturnPeriodRow[];
  text: string;
}

/**
 * Parse the "VAT Return_Upload" workbook: one column per taxable period, one row per cage.
 * Row "Taxable period" holds the first day of each period; "Date of submission" the acknowledgement
 * date; the cage rows are matched by the code in column B (A, 0, B/2, C/2A, 3, D, D1, E, E1, H, 4, 5,
 * I, 6, J, K, J2, 8, 8A, 10, 11, 12, 15, 16, Q, R2, 17, 18). Derived cages 7, 9, 13, 14 are ignored.
 * Periods with no figures in any entered cage are left out. The first sheet is used.
 */
export function parseReturnWorkbook(buf: ArrayBuffer | Uint8Array): ParsedReturns {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  const name = wb.SheetNames[0];
  if (!name) throw new UploadError("The file has no worksheets.");
  const A = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
  const rowIdx = (re: RegExp) => A.findIndex((r) => re.test(str(r[0])));
  const pi = rowIdx(/^taxable period/i);
  if (pi < 0)
    throw new UploadError(`Could not find the “Taxable period” row in sheet “${name}”. Expected the VAT Return_Upload layout.`);
  const si = rowIdx(/date of submission/i);
  const cageRows: Record<string, number> = {};
  A.forEach((r, i) => {
    const code = str(r[1]).toUpperCase().replace(/\s+/g, "");
    if (i !== pi && CAGE_FIELD[code] !== undefined && cageRows[code] === undefined) cageRows[code] = i;
  });
  if (Object.keys(cageRows).length < 3)
    throw new UploadError(`Could not find the cage codes (D, E, H, 4, 5, I, 6, 8, 10 …) in column B of sheet “${name}”.`);

  const periods: ReturnPeriodRow[] = [];
  const seen = new Set<string>();
  const prow = A[pi];
  for (let c = 1; c < prow.length; c++) {
    const v = prow[c];
    if (v === "" || v == null) continue;
    const d = xlDate(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const month = d.slice(0, 7) + "-01";
    if (seen.has(month)) continue;
    const row = {
      return_month: month,
      submitted_on: null,
      ...(Object.fromEntries(CAGES.map(([f]) => [f, 0])) as Record<CageField, number>),
    } as ReturnPeriodRow;
    let any = false;
    for (const [code, ri] of Object.entries(cageRows)) {
      const cell = A[ri][c];
      if (cell === "" || cell == null) continue;
      any = true;
      row[CAGE_FIELD[code]] = num(cell);
    }
    if (si >= 0) {
      const sv = A[si][c];
      if (sv !== "" && sv != null) {
        const sd = xlDate(sv);
        if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) row.submitted_on = sd;
      }
    }
    if (!any && !row.submitted_on) continue;
    seen.add(month);
    periods.push(row);
  }
  if (!periods.length) throw new UploadError(`No periods with figures were found in sheet “${name}”.`);
  periods.sort((a, b) => a.return_month.localeCompare(b.return_month));
  const submitted = periods.filter((p) => p.submitted_on).length;
  const first = mLabel(periods[0].return_month.slice(0, 7));
  const last = mLabel(periods[periods.length - 1].return_month.slice(0, 7));
  return {
    sheet: name,
    periods,
    text:
      `Sheet “${name}”: ${periods.length} periods from ${first} to ${last}, ${submitted} with a submission date. ` +
      "Saving replaces the cage figures and submission date of these periods; ledger figures already entered are kept.",
  };
}

/**
 * Parse an index of return / acknowledgement files: a sheet with a file-name column and, where
 * present, a period column (period code, month text or date) and a document-type column.
 * Headings are matched by text. Rows without a file name are ignored.
 */
export function parseDocumentIndex(buf: ArrayBuffer | Uint8Array): IndexRow[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  const name = wb.SheetNames[0];
  if (!name) throw new UploadError("The index file has no worksheets.");
  const A = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
  const { hi, col } = findHeader(A, /file|document|name/i, "File name", name);
  const c = {
    // "New file name" is the name in the folder; "Current / original file name" is kept as an alias.
    file: col(/new file/, /file ?name/, /^file/, /document ?name/, /^name/, /file/, /document/),
    alt: col(/current file/, /original file/, /old file/),
    period: col(/taxable period/, /period/, /month/, /return ?date/, /date/),
    kind: col(/^document$/, /type/, /kind/, /category/, /document/),
  };
  if (c.file < 0) throw new UploadError(`Could not find a file-name column in sheet “${name}”.`);
  if (c.alt === c.file) c.alt = -1;
  const rows: IndexRow[] = [];
  for (const r of A.slice(hi + 1)) {
    const file = str(r[c.file]);
    if (!file) continue;
    let period: string | null = null;
    if (c.period >= 0) {
      const v = r[c.period];
      if (typeof v === "number" && v > 40000 && v < 60000) period = xlDate(v).slice(0, 7);
      else period = periodFromText(str(v));
    }
    const kinds = c.kind >= 0 && c.kind !== c.file ? kindsFromText(str(r[c.kind])) : [];
    const alt = c.alt >= 0 ? str(r[c.alt]) : "";
    rows.push({ file, ...(alt ? { alt } : {}), period, kinds });
  }
  return rows;
}

function noRows(month: string, sheet: string, skipped: number) {
  return new UploadError(
    `No rows for ${mLabel(month)} were found in sheet “${sheet}”` +
      (skipped ? ` (${skipped} rows belong to other months)` : "") +
      ".",
  );
}

function previewText(
  kind: UploadKind,
  sheet: string,
  n: number,
  month: string,
  total: number,
  skipped: number,
  existing: number,
) {
  return (
    `Sheet “${sheet}”: ${n} rows for ${mLabel(month)}, ${
      kind === "ledger" ? "input VAT " : kind === "export" ? "net sales " : kind === "import" ? "ledger value " : "VAT "
    }${fmt(total)}.` +
    (skipped ? ` ${skipped} rows outside this month were left out.` : "") +
    (existing ? ` Saving replaces the ${existing} rows already held for this month.` : "")
  );
}

const TEMPLATE: Record<UploadKind, { sheet: string; file: string; head: string[] }> = {
  ledger: {
    sheet: "Invoice Listing",
    file: "Ledger invoice list",
    head: ["Invoice No.", "Posting Date", "Vendor Name", "External Document No.", "Description", "Amount (LCY)", "Source Currency Amount"],
  },
  schedule: {
    sheet: "IRD Input Schedule",
    file: "IRD input schedule",
    head: ["Month", "Serial No", "Invoice Date", "Tax Invoice No", "Supplier's TIN", "Name of the Supplier", "Description", "Value of purchase", "VAT Amount"],
  },
  export: {
    sheet: "Export Reconciliation",
    file: "Export reconciliation",
    head: [
      "Invoice No",
      "Month",
      "Amount FC (FOB) USD / EUR",
      "Ex.rate",
      "Net Sales (A)",
      "Cusdec No",
      "Date",
      "Month",
      "Currency Type",
      "Ex. Rate Custom LKR",
      "Invoice Value as Per USD / EUR",
      "Custom Value",
      "Short Shipment (3)",
      "Sales Reversed in the Month (4)",
      "Updated in Custom Report",
    ],
  },
  import: {
    sheet: "Import Reconciliation",
    file: "Import reconciliation",
    head: [
      "Invoice No",
      "Month",
      "Amount FC (CIF) USD / EUR",
      "Ex.rate",
      "Ledger Value (A)",
      "Cusdec No",
      "Date",
      "Month",
      "Currency Type",
      "Ex. Rate Custom LKR",
      "Invoice Value as Per USD / EUR",
      "Custom Value",
      "Value for VAT (Customs)",
      "VAT as per Customs",
      "Short Shipment (3)",
      "Sales Reversed in the Month (4)",
      "Updated in Custom Report",
    ],
  },
};

/** Build the blank upload template workbook for download. */
export function templateWorkbook(kind: UploadKind): XLSX.WorkBook {
  const t = TEMPLATE[kind];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([t.head]);
  ws["!cols"] = t.head.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, t.sheet);
  return wb;
}

export const templateFilename = (kind: UploadKind) => TEMPLATE[kind].file + " template.xlsx";

/** Headings of the schedule submissions workbook, in its column order ("DVAT Plan"). */
const SUBMISSION_HEAD = [
  "Selected",
  "Period Code",
  "Month",
  "Deferred Input VAT",
  "Sch 1 Output",
  "Sch 2 Input VAT",
  "Sch 3 Import VAT",
  "Sch 4 Credit/Debit Notes",
  "Sch 6 Article Export",
  "Sch 7 Service Export",
  "Schedules Submitted",
  "SVAT 06",
  "RMI",
  "Return Availability",
  "Cusdecs Availability",
  "Sch 6 CusDecs",
  "CusDecs in Register",
  "Remarks",
];

/**
 * Parse the schedule submissions workbook. The heading row (with "Period Code") is found in the first 15 rows and
 * columns are matched by heading. A row needs a period code (IRD YYQM), or a Month the code can be worked out
 * from; title, note and "Periods submitted" rows are passed over. Schedules Submitted and Cusdecs Availability
 * are worked out by the app, so those columns are not read. Sch 2 holds an amount, or text such as
 * "No local purchases". A period given twice keeps its last row.
 */
export function parseSubmissions(buf: ArrayBuffer | Uint8Array): { sheet: string; rows: SubmissionRow[]; skipped: number; text: string } {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  const name = wb.SheetNames.find((n) => /submission|status|dvat|schedule/i.test(n)) || wb.SheetNames[0];
  if (!name) throw new UploadError("The file has no worksheets.");
  const A = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
  const { hi, col } = findHeader(A, /period ?code/i, "Period Code", name);
  const c = {
    selected: col(/^selected/, /tick/),
    code: col(/period ?code/),
    month: col(/^month/, /taxable period/),
    deferred: col(/deferred/),
    sch1: col(/^sch ?1\b/),
    sch2: col(/^sch ?2\b/),
    sch3: col(/^sch ?3\b/),
    sch4: col(/^sch ?4\b/),
    sch6: col(/^sch ?6 ?article/, /^sch ?6(?!.*cus ?dec)/),
    sch7: col(/^sch ?7\b/),
    svat: col(/svat/),
    rmi: col(/^rmi/),
    ret: col(/return ?avail/),
    sch6c: col(/^sch ?6 ?cus ?decs?$/, /^sch ?6 cus ?dec/),
    reg: col(/in register/),
    remarks: col(/remarks?/, /^notes?$/),
  };
  const text = (r: Cell[], i: number) => (i < 0 ? null : str(r[i]) || null);
  const amount = (r: Cell[], i: number) => (i < 0 ? null : numOrNull(r[i]));
  const by = new Map<string, SubmissionRow>();
  let skipped = 0;
  for (const r of A.slice(hi + 1)) {
    let code = c.code < 0 ? "" : str(r[c.code]).replace(/\.0+$/, "");
    if (!isPeriodCode(code) && c.month >= 0) {
      const m = r[c.month];
      const d = typeof m === "number" ? xlDate(m) : "";
      code = /^\d{4}-\d{2}/.test(d) ? periodCode(d.slice(0, 7)) : (periodFromLabel(str(m)) ?? code);
    }
    if (!isPeriodCode(code)) {
      if (code && !/submitted|total/i.test(code)) skipped++;
      continue;
    }
    const s2 = c.sch2 < 0 ? "" : r[c.sch2];
    const s2n = numOrNull(s2);
    by.set(code, {
      period_code: code,
      selected: c.selected >= 0 && (r[c.selected] === true || /^(true|yes|y|x|1|✓|✔)$/i.test(str(r[c.selected]))),
      deferred_input_vat: amount(r, c.deferred),
      sch1: text(r, c.sch1),
      sch2_input_vat: s2n,
      sch2_note: s2n == null ? str(s2) || null : null,
      sch3: text(r, c.sch3),
      sch4: text(r, c.sch4),
      sch6: text(r, c.sch6),
      sch7: text(r, c.sch7),
      svat06: text(r, c.svat),
      rmi: text(r, c.rmi),
      return_availability: text(r, c.ret),
      sch6_cusdecs: c.sch6c < 0 ? null : numOrNull(r[c.sch6c], 0),
      cusdecs_in_register: c.reg < 0 ? null : numOrNull(r[c.reg], 0),
      remarks: text(r, c.remarks),
    });
  }
  const rows = [...by.values()].sort((a, b) => comparePeriods(b.period_code, a.period_code));
  if (!rows.length) throw new UploadError(`No periods were found in sheet “${name}”. Each row needs a Period Code such as 2632.`);
  return {
    sheet: name,
    rows,
    skipped,
    text:
      `Sheet “${name}”: ${rows.length} period${rows.length === 1 ? "" : "s"} from ${periodLabel(rows[0].period_code)} ` +
      `to ${periodLabel(rows[rows.length - 1].period_code)}.` +
      (skipped ? ` ${skipped} row${skipped === 1 ? "" : "s"} without a valid period code ${skipped === 1 ? "was" : "were"} left out.` : ""),
  };
}

/** The schedule submissions workbook: the template when `rows` is empty, else the periods with a totals row. */
export function submissionsWorkbook(rows: SubmissionRow[], company = ""): XLSX.WorkBook {
  const data: (string | number | boolean | null)[][] = rows.map((r) => [
    r.selected,
    Number(r.period_code),
    periodLabel(r.period_code),
    r.deferred_input_vat,
    r.sch1,
    r.sch2_input_vat ?? r.sch2_note,
    r.sch3,
    r.sch4,
    r.sch6,
    r.sch7,
    `${schedulesSubmitted(r)} of 6`,
    r.svat06,
    r.rmi,
    r.return_availability,
    cusdecsAvailability(r),
    r.sch6_cusdecs,
    r.cusdecs_in_register,
    r.remarks,
  ]);
  const aoa: (string | number | boolean | null)[][] = [
    [`${company ? company + " — " : ""}VAT Schedule Submission Status by Period`],
    ['"Submitted" = at least one record in RAMIS for that period. Schedules Submitted and Cusdecs Availability are worked out on upload.'],
    SUBMISSION_HEAD,
    ...data,
  ];
  if (rows.length) {
    const t = submissionTotals(rows);
    const of = (k: number) => `${k} of ${t.n}`;
    aoa.push(["", "Periods submitted", "", of(t.deferred), of(t.sch1), of(t.sch2), of(t.sch3), of(t.sch4), of(t.sch6), of(t.sch7), "",
      `${t.svat} of ${t.svatOf}`, "", of(t.returns), `${t.full} Full / ${t.partial} Partial / ${t.none} None`, "", "", ""]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = SUBMISSION_HEAD.map((h) => ({ wch: h === "Remarks" ? 40 : Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Submission Status");
  return wb;
}
