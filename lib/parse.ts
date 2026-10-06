/**
 * Upload parsing for ledger invoice lists and IRD input schedules.
 * Ported faithfully from reference/prototype.html (parseUpload, xlDate, xlText, num).
 * Pure functions: no DOM, no storage, so they run in the browser and in unit tests.
 */
import * as XLSX from "xlsx";
import { MN, mLabel, fmt, sum, cents } from "./format";
import type { LedgerUploadRow, ScheduleUploadRow } from "./types";

export type UploadKind = "ledger" | "schedule";

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

function readSheet(buf: ArrayBuffer | Uint8Array, kind: UploadKind) {
  // raw: true keeps CSV cells as written, so "01/05/2026" is not re-read as a US date (5 January).
  // Workbook cells already carry their types and are unaffected.
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  const want = kind === "ledger" ? /invoice listing/i : /input/i;
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
    `Sheet “${sheet}”: ${n} rows for ${mLabel(month)}, ${kind === "ledger" ? "input VAT " : "VAT "}${fmt(total)}.` +
    (skipped ? ` ${skipped} rows outside this month were left out.` : "") +
    (existing ? ` Saving replaces the ${existing} rows already held for this month.` : "")
  );
}

/** Build the blank upload template workbook for download. */
export function templateWorkbook(kind: UploadKind): XLSX.WorkBook {
  const led = kind === "ledger";
  const head = led
    ? ["Invoice No.", "Posting Date", "Vendor Name", "External Document No.", "Description", "Amount (LCY)", "Source Currency Amount"]
    : ["Month", "Serial No", "Invoice Date", "Tax Invoice No", "Supplier's TIN", "Name of the Supplier", "Description", "Value of purchase", "VAT Amount"];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([head]);
  ws["!cols"] = head.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, led ? "Invoice Listing" : "IRD Input Schedule");
  return wb;
}

export const templateFilename = (kind: UploadKind) =>
  (kind === "ledger" ? "Ledger invoice list" : "IRD input schedule") + " template.xlsx";
