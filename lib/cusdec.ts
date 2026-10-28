/**
 * Read a Sri Lanka Customs goods declaration (ASYCUDA CusDec printout) from its text items and
 * produce a customs entry. Fields are found by the printed box labels, so the rules hold for any
 * CusDec printed from the same template, however many continuation pages it has.
 */
import { mLabel } from "./format";
import type { TextItem } from "./pdfText";
import type { CustomsUploadRow, ReconDirection } from "./types";

export interface ParseOptions {
  /** Widen the alignment tolerances, for OCR output whose positions are approximate. */
  loose?: boolean;
}

export interface CusdecResult {
  row: CustomsUploadRow;
  /** "EX" or "IM" from box 1, or "" when not found. */
  declaration: string;
  warnings: string[];
}

/** Trailing punctuation that OCR tacks onto a figure ("334.8094,") is ignored. */
const tidy = (s: string) => s.replace(/[,.;:]+$/, "");
const num = (s: string): number | null => {
  const n = parseFloat(tidy(s).replace(/,/g, ""));
  return isNaN(n) ? null : n;
};
const isNum = (s: string) => /^-?[\d,]+(\.\d+)?$/.test(tidy(s));

/** Items on page `page` whose box lies within the rectangle (PDF points, y upwards). */
const within = (items: TextItem[], page: number, x0: number, x1: number, y0: number, y1: number) =>
  items.filter((i) => i.page === page && i.x >= x0 && i.x < x1 && i.y > y0 && i.y < y1).sort((a, b) => b.y - a.y || a.x - b.x);

/** Tolerance added to every box when reading OCR output, whose positions are approximate. */
let slack = 0;

/** Value lines directly below a label: same column, within `depth` points, left edge within `dx`. */
function below(items: TextItem[], label: TextItem, depth: number, dx = 20, width = 260): TextItem[] {
  return within(items, label.page, label.x - dx - slack, label.x + width + slack, label.y - depth - slack, label.y - 1);
}

const find = (items: TextItem[], re: RegExp, page = 1) => items.find((i) => i.page === page && re.test(i.s));

export function parseCusdec(items: TextItem[], direction: ReconDirection, opts: ParseOptions = {}): CusdecResult {
  slack = opts.loose ? 10 : 0;
  const warnings: string[] = [];
  const p1 = items.filter((i) => i.page === 1);

  // Box 1: declaration type ("EX 1", "IM 7") on the top row.
  const decl = find(items, /^(EX|IM)$/);
  const declaration = decl?.s ?? "";
  if (declaration === "EX" && direction === "import") warnings.push("This is an export declaration (EX) uploaded as an import.");
  if (declaration === "IM" && direction === "export") warnings.push("This is an import declaration (IM) uploaded as an export.");

  // Customs Reference Number: the row under the label holds the series letter, number and date.
  let cusdec_no = "";
  let cusdec_date = "";
  const refLabel = find(items, /Customs Reference Number/);
  if (refLabel) {
    const all = below(items, refLabel, 20, 2, 160);
    // Only the first printed line under the label: the series letter, number and date.
    const row = all.filter((i) => all.length && Math.abs(i.y - all[0].y) < 5 && !/^Manifest/i.test(i.s));
    const date = row.find((i) => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
    const parts = row.filter((i) => i !== date).map((i) => i.s);
    cusdec_no = parts.join(" ").trim();
    cusdec_date = date?.s ?? "";
  }
  if (!cusdec_no) warnings.push("Customs reference number not found.");
  if (!cusdec_date) {
    // Fall back to the assessment date in the accounting details.
    const a = find(items, /^Assessment Number/);
    const d = a && within(items, 1, a.x + 150, a.x + 260, a.y - 6, a.y + 6).find((i) => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
    if (d) cusdec_date = d.s;
  }
  const monthKey = cusdec_date ? `${cusdec_date.slice(6, 10)}-${cusdec_date.slice(3, 5)}` : null;

  // Box 22 currency and total amount invoiced; box 23 exchange rate.
  let currency_type = "";
  let invoice_value: number | null = null;
  let ex_rate: number | null = null;
  const b22 = find(items, /^22 Currency/) ?? find(items, /Currency & Total Amount/);
  if (b22) {
    const row = below(items, b22, 18, 2, 118);
    currency_type = row.find((i) => /^[A-Z]{3}$/.test(i.s))?.s ?? "";
    invoice_value = num(row.find((i) => isNum(i.s))?.s ?? "");
  }
  const b23 = find(items, /^23 Exchange Rate/) ?? find(items, /Exchange Rate/);
  if (b23) ex_rate = num(below(items, b23, 18, 2, 62).find((i) => isNum(i.s))?.s ?? "");
  if (invoice_value == null) warnings.push("Total amount invoiced (box 22) not found.");
  if (ex_rate == null) warnings.push("Exchange rate (box 23) not found.");

  // Box 46 statistical value on every page (continuation sheets carry one per item).
  let statistical = 0;
  let statFound = false;
  for (const lbl of items.filter((i) => /^46 Statistical Value/.test(i.s))) {
    const v = below(items, lbl, 20, 2, 120).find((i) => isNum(i.s));
    if (v) {
      statistical += num(v.s) ?? 0;
      statFound = true;
    }
  }
  const customs_value =
    statFound ? Math.round(statistical * 100) / 100 : ex_rate != null && invoice_value != null ? Math.round(ex_rate * invoice_value * 100) / 100 : null;
  if (!statFound) warnings.push("Statistical value (box 46) not found; customs value taken as invoice value × rate.");
  // Cross-check: invoice value × rate should agree with the statistical value, otherwise one of the
  // three figures was misread (an OCR slip, most often). Exports are FOB, so within 1%; the import
  // statistical value is CIF and includes freight and insurance, so only a gross difference is flagged.
  if (statFound && ex_rate != null && invoice_value != null) {
    const expected = ex_rate * invoice_value;
    const band = direction === "export" ? 0.01 : 0.25;
    if (expected > 0 && Math.abs(statistical - expected) / expected > band)
      warnings.push(
        `Invoice value × rate (${Math.round(expected).toLocaleString("en-LK")}) is far from the statistical value (${Math.round(statistical).toLocaleString("en-LK")}); check these figures.`,
      );
  }

  // VAT: the VTD (deferred) or VAT (upfront) lines of the tax table on each page:
  // Type | Tax base | Rate | Amount | MP.
  let vat: number | null = null;
  for (const t of items.filter((i) => /^(VTD|VAT)$/.test(i.s))) {
    const row = items
      .filter((i) => i.page === t.page && Math.abs(i.y - t.y) < 3 && i.x > t.x && isNum(i.s))
      .sort((a, b) => a.x - b.x);
    if (row.length >= 3) vat = (vat ?? 0) + (num(row[2].s) ?? 0);
  }

  // Invoice number: an "INV NO:" note anywhere on the form (box 44 or the bank reference); else the
  // reference in box 44 under A.D. (imports); else the bill of lading / AWB number in box 40.
  let invoice_no = "";
  const inv = items.map((i) => i.s.match(/\bINV(?:OICE)?\.?\s*NO\.?\s*:?\s*([A-Z0-9][A-Z0-9\-\/\.]*)/i)).find(Boolean);
  if (inv) invoice_no = inv[1];
  if (!invoice_no) {
    // OCR may split "INVOICE NO : EXP-1883" into separate runs; join each line's runs and retry.
    const lines = new Map<string, string[]>();
    for (const i of items) {
      const k = i.page + ":" + Math.round(i.y / 4);
      lines.set(k, [...(lines.get(k) ?? []), i.s]);
    }
    for (const parts of lines.values()) {
      const m = parts.join(" ").match(/\bINV(?:OICE)?\.?\s*NO\.?\s*:?\s*([A-Z0-9][A-Z0-9\-\/\.]*)/i);
      if (m) {
        invoice_no = m[1];
        break;
      }
    }
  }
  if (!invoice_no) {
    const ad = find(items, /^A\.D\.$/);
    const v = ad && below(items, ad, 30, 0, 260).find((i) => !/^[\d+\-]+$/.test(i.s) && !/^INV/i.test(i.s));
    if (v) {
      invoice_no = v.s;
      warnings.push(`Invoice number taken from box 44 (${v.s}); check it against the purchase ledger.`);
    }
  }
  if (!invoice_no) {
    const b40 = find(items, /^40 Previous/);
    const v = b40 && below(items, b40, 20, 2, 150)[0];
    if (v) {
      invoice_no = v.s;
      warnings.push(`No invoice number on the form; the BL / AWB number (${v.s}) was used.`);
    }
  }
  if (!invoice_no) warnings.push("Invoice number not found; enter it before saving.");

  // Party: the consignee (box 8) for exports, the exporter (box 2) for imports. First line = name.
  const partyLabel = find(items, direction === "export" ? /^8 Consignee/ : /^2 Exporter/);
  const party = partyLabel ? (below(items, partyLabel, 45, 2, 235).find((i) => !/^TIN:?$/.test(i.s) && !/^\d{10,}$/.test(i.s))?.s ?? "") : "";

  // Description of goods: the lines under "Description:" in box 31, down to box 44.
  const descLabel = find(items, /^Description:$/);
  const b44 = find(items, /^44 Add/);
  // Lines between the "Description:" label and the top of box 44 (no OCR slack here, or the box 44
  // labels creep in); the column stops short of box 40 to the right, and labels and bare numbers are skipped.
  const description = descLabel
    ? within(items, descLabel.page, descLabel.x - 2 - slack, descLabel.x + 230, b44 ? b44.y + 3 : descLabel.y - 40, descLabel.y - 1)
        .filter((i) => !/^\d{2} [A-Z]/.test(i.s) && !/^(Licence No|A\.D\.|D\.Val|D\.Qty)/.test(i.s) && !/^[\d.,\-+]+$/.test(i.s))
        .map((i) => i.s)
        .slice(0, 2)
        .join(" / ")
    : "";

  void p1;
  return {
    declaration,
    warnings,
    row: {
      cusdec_no,
      cusdec_date,
      cusdec_month: monthKey ? mLabel(monthKey) : null,
      invoice_no,
      currency_type,
      ex_rate,
      invoice_value,
      customs_value,
      vat_amount: direction === "import" ? vat : null,
      party,
      description,
    },
  };
}
