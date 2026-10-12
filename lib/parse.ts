/**
 * Upload parsing for ledger invoice lists and IRD input schedules.
 * Ported faithfully from reference/prototype.html (parseUpload, xlDate, xlText, num).
 * Pure functions: no DOM, no storage, so they run in the browser and in unit tests.
 */
import * as XLSX from "xlsx";
import { MN, mLabel, fmt, sum, cents } from "./format";
import type { ExportUploadRow, LedgerUploadRow, ReturnPeriodRow, ScheduleUploadRow } from "./types";

export type UploadKind = "ledger" | "schedule" | "export";

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
): ParsedUpload<ExportUploadRow> {
  const { name, A } = readSheet(buf, "export");
  const { hi, col } = findHeader(A, /^\s*invoice no/i, "Invoice No", name);
  const c = {
    inv: col(/^invoice no/),
    m: col(/^month$/, /^month/),
    amt: col(/^amount/, /fob/),
    rate: col(/^ex\.? ?rate$/, /^ex\.? ?rate(?!.*custom)/),
    net: col(/net sales/),
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
    });
  }
  if (!rows.length) throw noRows(month, name, skipped);
  const total = cents(sum(rows, (r) => r.net_sales));
  return {
    kind: "export",
    month,
    sheet: name,
    rows,
    skipped,
    total,
    text: previewText("export", name, rows.length, month, total, skipped, existing),
  };
}

/** Cage code (column B of the workbook) -> vat_returns field. */
const CAGE_FIELD: Record<string, Exclude<keyof ReturnPeriodRow, "return_month" | "submitted_on">> = {
  D: "zero_rated",
  E: "exempt",
  H: "imports_value",
  "4": "imports_deferred",
  "5": "imports_upfront",
  I: "local_value",
  "6": "local_tax",
  "8": "disallowed",
  "10": "brought_forward",
};

export interface ParsedReturns {
  sheet: string;
  /** Ascending by period. */
  periods: ReturnPeriodRow[];
  text: string;
}

/**
 * Parse the "VAT Return_Upload" workbook: one column per taxable period, one row per cage.
 * Row "Taxable period" holds the first day of each period; "Date of submission" the acknowledgement
 * date; the cage rows are matched by the code in column B (D, E, H, 4, 5, I, 6, 8, 10).
 * Periods with no figures in any of those cages are left out. The first sheet is used.
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
    const code = str(r[1]).toUpperCase();
    if (i !== pi && CAGE_FIELD[code] !== undefined && cageRows[code] === undefined) cageRows[code] = i;
  });
  if (Object.keys(cageRows).length < 3)
    throw new UploadError(`Could not find the cage codes (D, E, H, 4, 5, I, 6, 8, 10) in column B of sheet “${name}”.`);

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
    const row: ReturnPeriodRow = {
      return_month: month,
      submitted_on: null,
      zero_rated: 0,
      exempt: 0,
      imports_value: 0,
      imports_deferred: 0,
      imports_upfront: 0,
      local_value: 0,
      local_tax: 0,
      disallowed: 0,
      brought_forward: 0,
    };
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
      kind === "ledger" ? "input VAT " : kind === "export" ? "net sales " : "VAT "
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
