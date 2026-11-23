/**
 * Sales invoices from Business Central (Registers › Export and Local Sales). The file is a sales line list
 * (Excel or CSV): one row per invoice line, grouped here into invoices. Columns are found by their headings,
 * as the TIEP app read them: Document / Invoice No, Posting Date, Item No, Description, Quantity, Unit of
 * Measure, Unit Price, Amount, Amount (LCY), Currency, Customer, plus optional Export CusDec, Boxes, Gross.
 *
 * Charge lines (freight, insurance and other charges, G/L account lines) are flagged so they are left out of
 * the invoice's FOB amount, which is what Export reconciliation uses. Weights in pounds are converted to kg.
 * Pure functions: no DOM, no storage, so they run in the browser and in unit tests.
 */
import * as XLSX from "xlsx";
import { xlDate, numOrNull, UploadError } from "./parse";

export type SalesType = "Export" | "Local";

/** Pounds to kilograms, as the TIEP app and the customs forms use it. */
export const LB_KG = 0.454;

export interface SalesUploadLine {
  line_no: number;
  line_date: string | null;
  item_code: string;
  description: string;
  qty: number | null;
  uom: string;
  qty_in: number | null;
  uom_in: string;
  boxes: number | null;
  gross: number | null;
  unit_price: number | null;
  amount_fc: number;
  amount_lkr: number;
  is_charge: boolean;
}

export interface SalesUploadInvoice {
  invoice_no: string;
  invoice_date: string | null;
  customer: string;
  currency: string;
  ex_rate: number | null;
  order_no: string;
  export_cusdec: string;
  source: string;
  lines: SalesUploadLine[];
}

export interface ParsedSales {
  sheet: string;
  invoices: SalesUploadInvoice[];
  lines: number;
  /** Rows left out: blank invoice number, subtotal rows, or the other market (Export / Local). */
  skipped: number;
  warnings: string[];
}

/** An invoice as held (sales_invoices), with its lines when loaded. */
export interface SalesInvoice {
  id: string;
  company_id: string;
  type: SalesType;
  invoice_no: string;
  invoice_date: string | null;
  customer: string | null;
  currency: string | null;
  ex_rate: number | null;
  order_no: string | null;
  export_cusdec: string | null;
  amount_fc: number;
  amount_lkr: number;
  fob_fc: number;
  fob_lkr: number;
  line_count: number;
  source: string | null;
  file_name: string | null;
  void_ref: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface SalesLine {
  id: string;
  invoice_id: string;
  line_no: number;
  line_date: string | null;
  item_code: string | null;
  description: string | null;
  qty: number | null;
  uom: string | null;
  qty_in: number | null;
  uom_in: string | null;
  boxes: number | null;
  gross: number | null;
  unit_price: number | null;
  amount_fc: number;
  amount_lkr: number;
  is_charge: boolean;
}

type Cell = string | number | boolean | Date | null;
const str = (v: Cell | undefined) => String(v ?? "").trim();
const norm = (v: Cell | undefined) => str(v).toLowerCase().replace(/\s+/g, " ");
const cents = (n: number) => Math.round(n * 100) / 100;
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Freight, insurance and other charges: not goods, so not part of the FOB amount. */
const CHARGE_TEXT =
  /\b(freight|insurance|courier|handling|transport(ation)?|cartage|clearing|documentation|bank charges?|charges?|surcharge|delivery fee|airway bill|awb fee)\b/i;

/**
 * True for a charge line. `lineType` is Business Central's line Type (Item, G/L Account, Resource, Charge
 * (Item)): anything but Item is a charge. Otherwise service item codes (SE0031) and charge descriptions.
 */
export function isChargeLine(code: string, description: string, lineType = ""): boolean {
  const t = lineType.trim().toLowerCase();
  if (t && t !== "item" && /g\/l|account|charge|resource|fixed asset/.test(t)) return true;
  if (/^SE\d/i.test(code.trim())) return true;
  return CHARGE_TEXT.test(description);
}

/** Header columns, by the first pattern that matches a heading. */
function columns(H: string[]) {
  const col = (...res: RegExp[]) => {
    for (const re of res) {
      const i = H.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const amountLkr = col(/amount.*\((lcy|lkr)\)/, /amount.*\b(lcy|lkr)\b/, /\b(lcy|lkr)\b.*amount/, /^amount lkr/);
  const c = {
    inv: col(/^document no/, /^invoice no/, /^inv(oice)?\.? ?no/, /^document number/, /^invoice$/),
    date: col(/^posting date/, /^invoice date/, /^document date/, /^date$/, /date/),
    code: col(/^item no/, /^item code/, /^no\.?$/, /^code$/, /^item$/),
    desc: col(/^description/, /^desc/, /^product/, /item name/),
    qty: col(/^net (wt|weight|kg|qty)/, /^net$/, /^quantity/, /^qty/, /quantity/, /^kg$/, /weight/),
    uom: col(/unit of measure/, /^uom/, /^unit$/),
    price: col(/^unit price/, /^price/),
    amountLkr,
    amount: -1,
    currency: col(/^currency/),
    rate: col(/^exchange rate/, /^ex\.? ?rate/, /^rate$/),
    customer: col(/sell-to customer name/, /^customer name/, /bill-to name/, /^customer$/, /^consignee/, /^customer/),
    order: col(/^order no/, /^external document/),
    cusdec: col(/cusdec/, /export entry/, /^e no/, /^entry no/),
    boxes: col(/^boxes/, /^cartons/, /^no\.? of (boxes|cartons)/),
    gross: col(/^gross/),
    lineType: col(/^type$/),
    market: col(/^market/, /^sales type/),
  };
  // FC amount: Line Amount or Amount, but never the LKR column found above.
  c.amount = (() => {
    for (const re of [/^line amount(?!.*(lcy|lkr))/, /^amount(?!.*(lcy|lkr))/, /amount.*\b(fc|usd|eur)\b/, /^value/]) {
      const i = H.findIndex((h, j) => j !== amountLkr && re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  })();
  return c;
}

/** The sheet and header row of the line list: the first row with an invoice number and quantity or amount. */
function findSheet(wb: XLSX.WorkBook): { name: string; A: Cell[][]; hi: number; H: string[] } {
  for (const name of wb.SheetNames) {
    const A = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    for (let hi = 0; hi < Math.min(A.length, 20); hi++) {
      const H = A[hi].map(norm);
      const c = columns(H);
      if (c.inv >= 0 && (c.qty >= 0 || c.amount >= 0 || c.amountLkr >= 0) && (c.code >= 0 || c.desc >= 0))
        return { name, A, hi, H };
    }
  }
  throw new UploadError(
    "Could not find the sales line headings. The file needs Document No (or Invoice No), Item No or Description, and Quantity or Amount columns.",
  );
}

/**
 * Read a Business Central sales line list. `type` is the register being uploaded; when the file has a Market
 * column (Export / Local) only that market's rows are kept. `unit` forces the weight unit of Quantity.
 */
export function parseSalesFile(
  buf: ArrayBuffer | Uint8Array,
  type: SalesType,
  opts: { unit?: "auto" | "KG" | "LB"; source?: string } = {},
): ParsedSales {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  if (!wb.SheetNames.length) throw new UploadError("The file has no worksheets.");
  const { name, A, hi, H } = findSheet(wb);
  const c = columns(H);
  const unit = opts.unit ?? "auto";
  // A weight heading in pounds ("Net Wt (lbs)") means the quantities are in pounds.
  const qtyInLb = c.qty >= 0 && /\b(lbs?|pounds?)\b/.test(H[c.qty]);
  const warnings: string[] = [];

  const byInv = new Map<string, SalesUploadInvoice>();
  let skipped = 0;
  let noDate = 0;
  let noLkr = 0;
  for (const r of A.slice(hi + 1)) {
    const inv = str(r[c.inv]);
    if (!inv || /^total/i.test(inv) || /^[a-z]{3,9}\s+\d{4}$/i.test(inv)) {
      if (r.some((x) => str(x))) skipped++;
      continue;
    }
    if (c.market >= 0) {
      const mk = norm(r[c.market]);
      if (mk && !mk.startsWith(type.toLowerCase())) {
        skipped++;
        continue;
      }
    }
    const code = c.code >= 0 ? str(r[c.code]) : "";
    const desc = c.desc >= 0 ? str(r[c.desc]) : "";
    if (!code && !desc) {
      skipped++;
      continue;
    }

    let inv0 = byInv.get(inv);
    if (!inv0) {
      inv0 = {
        invoice_no: inv,
        invoice_date: null,
        customer: "",
        currency: "",
        ex_rate: null,
        order_no: "",
        export_cusdec: "",
        source: opts.source ?? "Business Central",
        lines: [],
      };
      byInv.set(inv, inv0);
    }
    const d = c.date >= 0 ? xlDate(r[c.date]) : "";
    const lineDate = isIsoDate(d) ? d : null;
    if (!inv0.invoice_date && lineDate) inv0.invoice_date = lineDate;
    if (!inv0.customer && c.customer >= 0) inv0.customer = str(r[c.customer]);
    if (!inv0.currency && c.currency >= 0) inv0.currency = str(r[c.currency]).toUpperCase();
    if (inv0.ex_rate == null && c.rate >= 0) inv0.ex_rate = numOrNull(r[c.rate], 6);
    if (!inv0.order_no && c.order >= 0) inv0.order_no = str(r[c.order]);
    if (!inv0.export_cusdec && c.cusdec >= 0) inv0.export_cusdec = str(r[c.cusdec]);

    // Quantity, converted from pounds where the unit says so.
    const qtyIn = c.qty >= 0 ? numOrNull(r[c.qty], 3) : null;
    const uomIn = (c.uom >= 0 ? str(r[c.uom]) : "").toUpperCase() || (qtyInLb ? "LB" : "");
    const isLb = unit === "LB" || (unit === "auto" && (qtyInLb || /^(LBS?|POUNDS?)$/.test(uomIn)));
    const qty = qtyIn == null ? null : isLb ? Math.round(qtyIn * LB_KG * 1000) / 1000 : qtyIn;
    const uom = isLb ? "KG" : uomIn || (unit === "KG" ? "KG" : "");

    // Amounts. Local invoices are in LKR, so one amount column is the LKR amount.
    let fc = c.amount >= 0 ? numOrNull(r[c.amount]) : null;
    let lkr = c.amountLkr >= 0 ? numOrNull(r[c.amountLkr]) : null;
    if (type === "Local" && lkr == null) lkr = fc;
    if (type === "Local" && fc == null) fc = lkr;
    if (lkr == null && fc != null && inv0.ex_rate != null) lkr = cents(fc * inv0.ex_rate);
    if (type === "Export" && lkr == null && fc) noLkr++;
    const lineType = c.lineType >= 0 ? str(r[c.lineType]) : "";

    inv0.lines.push({
      line_no: inv0.lines.length + 1,
      line_date: lineDate,
      item_code: code,
      description: desc,
      qty,
      uom,
      qty_in: qtyIn,
      uom_in: uomIn,
      boxes: c.boxes >= 0 ? numOrNull(r[c.boxes]) : null,
      gross: c.gross >= 0 ? numOrNull(r[c.gross], 3) : null,
      unit_price: c.price >= 0 ? numOrNull(r[c.price], 4) : null,
      amount_fc: fc ?? 0,
      amount_lkr: lkr ?? 0,
      is_charge: isChargeLine(code, desc, lineType),
    });
  }

  const invoices = [...byInv.values()];
  for (const i of invoices) {
    if (!i.invoice_date) noDate++;
    if (type === "Local" && !i.currency) i.currency = "LKR";
  }
  if (!invoices.length) throw new UploadError(`No invoice lines found in sheet “${name}”.`);
  if (noDate)
    warnings.push(
      `${noDate} invoice${noDate === 1 ? " has" : "s have"} no date: they are saved, but cannot be placed in a month until a date is uploaded.`,
    );
  if (noLkr)
    warnings.push(
      `${noLkr} line${noLkr === 1 ? "" : "s"} have no LKR amount and no exchange rate: Net sales stays 0 for them in Export reconciliation.`,
    );
  return { sheet: name, invoices, lines: invoices.reduce((n, i) => n + i.lines.length, 0), skipped, warnings };
}

/** Totals of a parsed invoice as the database will keep them. */
export function invoiceTotals(lines: Pick<SalesUploadLine, "amount_fc" | "amount_lkr" | "is_charge">[]) {
  let amount_fc = 0;
  let amount_lkr = 0;
  let fob_fc = 0;
  let fob_lkr = 0;
  for (const l of lines) {
    amount_fc += l.amount_fc;
    amount_lkr += l.amount_lkr;
    if (!l.is_charge) {
      fob_fc += l.amount_fc;
      fob_lkr += l.amount_lkr;
    }
  }
  return { amount_fc: cents(amount_fc), amount_lkr: cents(amount_lkr), fob_fc: cents(fob_fc), fob_lkr: cents(fob_lkr) };
}

/** A blank line list in the expected layout, for people building the file by hand. */
export function salesTemplateWorkbook(type: SalesType): XLSX.WorkBook {
  const head = [
    "Document No.",
    "Posting Date",
    "Customer Name",
    "Type",
    "No.",
    "Description",
    "Quantity",
    "Unit of Measure",
    "Unit Price",
    "Currency Code",
    "Amount",
    "Amount (LCY)",
    ...(type === "Export" ? ["Export CusDec"] : []),
  ];
  const ws = XLSX.utils.aoa_to_sheet([head]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${type} sales`);
  return wb;
}
