/**
 * Read a Sri Lanka Customs goods declaration (ASYCUDA CusDec printout) from its text items and
 * produce customs entries: one per item (HS code line). Fields are found by the printed box labels,
 * so the rules hold for any CusDec printed from the same template. Page 1 carries item 1 and its tax
 * table; each continuation sheet carries up to three item blocks, a tax table per block and a
 * "Summary of Taxes" block that is skipped.
 */
import { mLabel } from "./format";
import type { TextItem } from "./pdfText";
import type { CustomsUploadRow, ReconDirection } from "./types";

export interface ParseOptions {
  /** Widen the alignment tolerances, for OCR output whose positions are approximate. */
  loose?: boolean;
}

export interface CusdecResult {
  /** The declaration as a whole: header fields with the items' values summed. */
  row: CustomsUploadRow;
  /** One row per item, each repeating the header fields (reference, date, rate, invoice...). */
  items: CustomsUploadRow[];
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
const r2 = (n: number) => Math.round(n * 100) / 100;

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

/** One line of the tax table: Type | Tax base | Rate | Amount | MP. */
interface TaxLine {
  base: number | null;
  rate: number | null;
  amount: number | null;
  code: string | null;
}
type Taxes = Partial<Record<"CID" | "PAL" | "SSL" | "VAT", TaxLine & { type: string }>>;

/** Fields read from one item block (boxes 31 to 46 and its tax table). */
interface Item {
  item_no: number | null;
  hs_code: string | null;
  description: string;
  uom: string | null;
  quantity: number | null;
  statistical: number | null;
  taxes: Taxes;
}

/**
 * Tax tables on a page, in reading order (top to bottom, left to right), each as the lines under a
 * "Type" heading. The continuation sheet's "Summary of Taxes" block is left out.
 */
function taxTables(items: TextItem[], page: number): Taxes[] {
  const onPage = items.filter((i) => i.page === page);
  const heads = onPage
    .filter((h) => /^Type$/.test(h.s))
    .filter((h) => !onPage.some((s) => /Summary of Taxes/i.test(s.s) && Math.abs(s.y - h.y) < 4 + slack && s.x > h.x && s.x < h.x + 160))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  return heads.map((h) => {
    // The table ends where the next "Type" heading in the same column begins.
    const next = heads.filter((o) => o !== h && Math.abs(o.x - h.x) < 20 + slack && o.y < h.y).sort((a, b) => b.y - a.y)[0];
    const bottom = next ? next.y : -1;
    const out: Taxes = {};
    for (const t of onPage.filter(
      (i) => /^[A-Z]{2,4}$/.test(i.s) && i.s !== "Type" && Math.abs(i.x - h.x) < 8 + slack && i.y < h.y - 2 && i.y > bottom,
    )) {
      const row = onPage
        .filter((i) => Math.abs(i.y - t.y) < 3 + slack / 2 && i.x > t.x && i.x < h.x + 250 + slack && isNum(i.s))
        .sort((a, b) => a.x - b.x);
      if (row.length < 3) continue;
      const line = { type: t.s, base: num(row[0].s), rate: num(row[1].s), amount: num(row[2].s), code: row[3] ? tidy(row[3].s) : null };
      const key = t.s === "SSCL" ? "SSL" : t.s === "VTD" ? "VAT" : t.s;
      if (key === "CID" || key === "PAL" || key === "SSL" || key === "VAT") out[key] = line;
    }
    return out;
  });
}

/** The item blocks of the form: one under every "32 Item No." label, with that page's tax tables matched in order. */
function readItems(items: TextItem[]): Item[] {
  // OCR renders "32 Item No." as "321tem No." and the like, so the anchor is matched loosely.
  let labels = items.filter((i) => /^3[2Z]\s*[Il1]tem\s*No/i.test(i.s)).sort((a, b) => a.page - b.page || b.y - a.y);
  let anchorIsItemNo = true;
  if (!labels.length) {
    // No item label at all (a poor scan): read page 1 as the one item block, anchored on box 33 or the top of the page.
    const p1 = items.filter((i) => i.page === 1).sort((a, b) => b.y - a.y);
    const anchor = p1.find((i) => /^33 Commodity/i.test(i.s)) ?? p1[0];
    if (anchor) labels = [anchor];
    anchorIsItemNo = false;
  }
  const out: Item[] = [];
  const pages = [...new Set(labels.map((l) => l.page))];
  for (const page of pages) {
    const onPage = labels.filter((l) => l.page === page);
    const tables = taxTables(items, page);
    onPage.forEach((lbl, j) => {
      const bottom = onPage[j + 1]?.y ?? -1;
      // Everything in this block: below the label row, above the next block.
      const block = items.filter((i) => i.page === page && i.y <= lbl.y + 2 && i.y > bottom);
      const bfind = (re: RegExp) => block.find((i) => re.test(i.s));
      const no = anchorIsItemNo ? below(block, lbl, 22, 2, 40).find((i) => /^\d{1,3}$/.test(tidy(i.s))) : undefined;
      const hs = bfind(/^33 Commodity/i);
      const hsParts = hs ? below(block, hs, 22, 2, 110).map((i) => tidy(i.s)).filter((s) => /^\d{2,8}$/.test(s)) : [];
      const hs_code = hsParts.length ? hsParts.join(".") : null;
      const desc = bfind(/^Description:$/);
      const b44 = bfind(/^44 Add/i);
      const description = desc
        ? within(block, page, desc.x - 2 - slack, desc.x + 230, b44 ? b44.y + 3 : desc.y - 40, desc.y - 1)
            .filter(
              (i) =>
                !/^\d{2} [A-Z]/.test(i.s) &&
                !/^(Licence No|A\.D\.|D\.Val|D\.Qty)/.test(i.s) &&
                !/^[\d.,\-+]+$/.test(i.s) &&
                !/^[\d.,]+\s*[A-Z]{2,5}$/.test(i.s),
            )
            .map((i) => i.s)
            .slice(0, 2)
            .join(" / ")
        : "";
      const uomLbl = bfind(/^41 UOM & Qty\.? 1/i);
      let uom: string | null = null;
      let quantity: number | null = null;
      if (uomLbl) {
        // "NIU" and "20.00" as separate runs, or "20.00 3,140" when the quantity runs into the item price.
        const toks = below(block, uomLbl, 20, 2, 78).flatMap((i) => i.s.split(/\s+/));
        uom = toks.find((s) => /^[A-Z]{2,3}$/.test(s)) ?? null;
        const q = toks.find((s) => isNum(s));
        quantity = q ? num(q) : null;
      }
      const stat = bfind(/^46 Statistical Value/i);
      const sv = stat && below(block, stat, 22, 2, 120).find((i) => isNum(i.s));
      const taxes = tables[j] ?? {};
      if (!no && !hs_code && !sv && !Object.keys(taxes).length) return; // an empty continuation block
      out.push({
        item_no: no ? parseInt(tidy(no.s), 10) : null,
        hs_code,
        description,
        uom,
        quantity,
        statistical: sv ? num(sv.s) : null,
        taxes,
      });
    });
  }
  return out;
}

export function parseCusdec(items: TextItem[], direction: ReconDirection, opts: ParseOptions = {}): CusdecResult {
  slack = opts.loose ? 10 : 0;
  const warnings: string[] = [];
  const isImport = direction === "import";

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

  // The items: boxes 31 to 46 and the tax table of each.
  const parsed = readItems(items);
  const statFound = parsed.some((i) => i.statistical != null);
  const statistical = parsed.reduce((t, i) => t + (i.statistical ?? 0), 0);
  const fallbackValue = ex_rate != null && invoice_value != null ? r2(ex_rate * invoice_value) : null;
  if (!statFound) warnings.push("Statistical value (box 46) not found; customs value taken as invoice value × rate.");
  if (parsed.length > 1 && parsed.some((i) => i.item_no == null)) warnings.push("An item number (box 32) could not be read; check the item lines.");
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

  const header = { cusdec_no, cusdec_date, cusdec_month: monthKey ? mLabel(monthKey) : null, invoice_no, currency_type, ex_rate, invoice_value, party };
  const amt = (t: TaxLine | undefined) => (t ? t.amount : null);
  const code = (t: TaxLine | undefined) => (t ? t.code : null);
  const toRow = (it: Item, n: number): CustomsUploadRow => ({
    ...header,
    item_no: it.item_no ?? n,
    hs_code: it.hs_code,
    description: it.description,
    uom: it.uom,
    quantity: it.quantity,
    customs_value: it.statistical ?? (parsed.length === 1 ? fallbackValue : null),
    cid_amount: amt(it.taxes.CID),
    cid_code: code(it.taxes.CID),
    pal_amount: amt(it.taxes.PAL),
    pal_code: code(it.taxes.PAL),
    sscl_amount: amt(it.taxes.SSL),
    sscl_code: code(it.taxes.SSL),
    vat_base: isImport ? (it.taxes.VAT?.base ?? null) : null,
    vat_amount: isImport ? amt(it.taxes.VAT) : null,
    vat_type: isImport ? (it.taxes.VAT?.type ?? null) : null,
    vat_code: isImport ? code(it.taxes.VAT) : null,
  });
  const rows = parsed.length ? parsed.map((it, i) => toRow(it, i + 1)) : [toRow({ item_no: 1, hs_code: null, description: "", uom: null, quantity: null, statistical: null, taxes: {} }, 1)];

  // The declaration as a whole: the first item's descriptive fields with every item's amounts summed.
  const sumOf = (f: (r: CustomsUploadRow) => number | null) => (rows.some((r) => f(r) != null) ? r2(rows.reduce((t, r) => t + (f(r) ?? 0), 0)) : null);
  const row: CustomsUploadRow = {
    ...rows[0],
    customs_value: statFound ? r2(statistical) : fallbackValue,
    quantity: sumOf((r) => r.quantity),
    cid_amount: sumOf((r) => r.cid_amount),
    pal_amount: sumOf((r) => r.pal_amount),
    sscl_amount: sumOf((r) => r.sscl_amount),
    vat_base: sumOf((r) => r.vat_base),
    vat_amount: sumOf((r) => r.vat_amount),
  };

  return { declaration, warnings, row, items: rows };
}
