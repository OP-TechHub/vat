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

/** Trailing punctuation that OCR tacks onto a figure ("334.8094,") is ignored, and "18:00" is 18.00. */
const tidy = (s: string) => s.replace(/[,.;:]+$/, "").replace(/(\d):(\d)/g, "$1.$2");
const num = (s: string): number | null => {
  const n = parseFloat(tidy(s).replace(/,/g, ""));
  return isNaN(n) ? null : n;
};
const isNum = (s: string) => /^-?[\d,]+(\.\d+)?$/.test(tidy(s));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A tax type label in the item's tax table, as printed or as OCR renders it ("C1D", "VID"). */
const TAX_TYPE = /^(C[I1l]D|PA[Ll1]|SS[Ll1]|SSC[Ll1]|V[TI1l][DO0]|VAT)$/;

/** Tolerance added to every box when reading OCR output, whose positions are approximate. */
let slack = 0;

/**
 * Reading order: top line first, left to right within a line. Items whose baselines differ by a few
 * points (OCR words on one printed line) count as the same line.
 */
function lineSort(arr: TextItem[]): TextItem[] {
  const byY = [...arr].sort((a, b) => b.y - a.y);
  const line = new Map<TextItem, number>();
  let n = 0;
  let prev = Infinity;
  for (const i of byY) {
    if (prev - i.y > 3 + slack / 2) n++;
    prev = i.y;
    line.set(i, n);
  }
  return byY.sort((a, b) => line.get(a)! - line.get(b)! || a.x - b.x);
}

/** Items on page `page` whose box lies within the rectangle (PDF points, y upwards), in reading order. */
const within = (items: TextItem[], page: number, x0: number, x1: number, y0: number, y1: number) =>
  lineSort(items.filter((i) => i.page === page && i.x >= x0 && i.x < x1 && i.y > y0 && i.y < y1));

/**
 * Scale the positions to the printout's geometry when the form was printed or scanned at another
 * size, judged from the distance between two labels on one row (box 22 to box 23, else box 32 to 33).
 */
function normaliseScale(items: TextItem[]): TextItem[] {
  const p1 = items.filter((i) => i.page === 1);
  const a = p1.find((i) => /^22 Currency/.test(i.s));
  const b = p1.find((i) => /^23 Exchange/.test(i.s));
  let s: number | null = null;
  if (a && b && b.x > a.x) s = (b.x - a.x) / 119;
  else {
    const c = p1.find((i) => /^3[2Z]\s*[Il1]tem\s*No/i.test(i.s));
    const d = p1.find((i) => /^33 Commodity/i.test(i.s));
    if (c && d && d.x > c.x) s = (d.x - c.x) / 45;
  }
  if (s == null || s < 0.5 || s > 1.6 || Math.abs(s - 1) < 0.03) return items;
  return items.map((i) => ({ ...i, x: i.x / s, y: i.y / s, w: i.w / s }));
}

/** Value lines directly below a label: same column, within `depth` points, left edge within `dx`. */
function below(items: TextItem[], label: TextItem, depth: number, dx = 20, width = 260): TextItem[] {
  return within(items, label.page, label.x - dx - slack, label.x + width + slack, label.y - depth - slack, label.y - 1);
}

const find = (items: TextItem[], re: RegExp, page = 1) => items.find((i) => i.page === page && re.test(i.s));

/**
 * The customs declarations in a document: each starts at a main CusDec page (the one carrying the
 * customs reference number) and takes the continuation sheets that follow it. Other pages (invoices,
 * packing lists, bills of lading in a scanned bundle) are dropped, and the pages of each declaration
 * are renumbered from 1 so the parser sees them as a printout. A document with no recognisable main
 * page is returned whole, so a plain CusDec PDF still parses as before.
 */
export function splitCusdecs(items: TextItem[]): TextItem[][] {
  const groups = cusdecPageGroups(items);
  if (!groups.length) return items.length ? [items] : [];
  return groups.map((g) => items.filter((i) => g.includes(i.page)).map((i) => ({ ...i, page: g.indexOf(i.page) + 1 })));
}

/** What a page is, judged from its text with all spaces removed (a scanner's layer splits words and even letters). */
export function cusdecPageKind(items: TextItem[], page: number): "main" | "continuation" | null {
  const txt = items
    .filter((i) => i.page === page)
    .map((i) => i.s)
    .join("")
    .replace(/\s+/g, "")
    .toUpperCase();
  // One wrong letter in a heading is common on a rough scan ("GOODS FECLARATION", "Reforance").
  if (/CONTINUATI.NSHEET|CONTINUATION.HEET/.test(txt)) return "continuation";
  if (
    /CUSTOMSREF.{0,5}NUMBER/.test(txt) ||
    /GOODS.ECLARATION|GOODSDECLARATI.N/.test(txt) ||
    /SRI.?LANKACUSTOMS/.test(txt) ||
    (/STATISTICALVALUE/.test(txt) && /COMMODITY/.test(txt))
  )
    return "main";
  return null;
}

/** Page numbers of each declaration in the document: a main page followed by its continuation sheets. */
export function cusdecPageGroups(items: TextItem[]): number[][] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const p of pages) {
    const kind = cusdecPageKind(items, p);
    if (kind === "main") groups.push([p]);
    else if (kind === "continuation" && groups.length) groups[groups.length - 1].push(p);
  }
  return groups;
}

/** One line of the tax table: Type | Tax base | Rate | Amount | MP. */
interface TaxLine {
  base: number | null;
  rate: number | null;
  amount: number | null;
  code: string | null;
  /** The amount was unreadable or inconsistent and has been computed as base × rate. */
  computed?: boolean;
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
  /** Box 46 was unreadable and the statistical value is the CID tax base. */
  statFromCid?: boolean;
  taxes: Taxes;
}

/**
 * Tax tables on a page, in reading order (top to bottom, left to right), each as the lines under a
 * "Type" heading. The continuation sheet's "Summary of Taxes" block is left out.
 */
function taxTables(items: TextItem[], page: number): Taxes[] {
  const onPage = items.filter((i) => i.page === page);
  const TAX = TAX_TYPE;
  /** The printed tax type behind an OCR reading of it. */
  const taxType = (x: string) =>
    /^C[I1l]D$/.test(x) ? "CID" : /^PA[Ll1]$/.test(x) ? "PAL" : /^SS[Ll1]$/.test(x) ? "SSL" : /^SSC[Ll1]$/.test(x) ? "SSCL" : /^V[TI1l][DO0]$/.test(x) ? "VTD" : x;
  let heads = onPage
    .filter((h) => /^Type$/.test(h.s))
    .filter((h) => !onPage.some((s) => /Summary of Taxes/i.test(s.s) && Math.abs(s.y - h.y) < 4 + slack && s.x > h.x && s.x < h.x + 160))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  if (!heads.length) {
    // OCR often loses the small "Type" heading: stand one in above each column of tax-type labels
    // (a new table where the column shifts or the rows are far apart). The summary block on a
    // continuation sheet has no rates, so its labels are left out.
    const labels = onPage
      .filter((t) => TAX.test(t.s) && onPage.some((i) => Math.abs(i.y - t.y) < 3 + slack / 2 && i.x > t.x && i.x < t.x + 250 && isNum(i.s)))
      .sort((a, b) => b.y - a.y);
    // Labels in one column within a short gap of each other form one table (top down, so the first
    // label met is the table's top); the heading goes above that label.
    const clusters: { x: number; top: number; low: number }[] = [];
    for (const t of labels) {
      const c = clusters.find((k) => Math.abs(k.x - t.x) < 12 + slack && k.low - t.y >= -2 && k.low - t.y < 40 + slack);
      if (c) c.low = Math.min(c.low, t.y);
      else clusters.push({ x: t.x, top: t.y, low: t.y });
    }
    heads = clusters.map((c) => ({ page, x: c.x, y: c.top + 10, w: 20, s: "Type" })).sort((a, b) => b.y - a.y || a.x - b.x);
  }
  return heads.map((h) => {
    // The table ends where the next "Type" heading in the same column begins.
    const next = heads.filter((o) => o !== h && Math.abs(o.x - h.x) < 20 + slack && o.y < h.y).sort((a, b) => b.y - a.y)[0];
    const bottom = next ? next.y : -1;
    const out: Taxes = {};
    const types = onPage.filter(
      (i) => TAX.test(i.s) && Math.abs(i.x - h.x) < 8 + slack && i.y < h.y - 2 && i.y > bottom,
    );
    for (const t of types) {
      // The figures on this label's line: close in height, and closer to this label than to any other.
      const row = onPage
        .filter(
          (i) =>
            Math.abs(i.y - t.y) < 3 + slack / 2 &&
            i.x > t.x &&
            i.x < h.x + 250 + slack &&
            isNum(i.s) &&
            !types.some((o) => o !== t && Math.abs(i.y - o.y) < Math.abs(i.y - t.y)),
        )
        .sort((a, b) => a.x - b.x);
      if (row.length < 3) continue;
      const typ = taxType(t.s);
      const line: TaxLine & { type: string } = { type: typ, base: num(row[0].s), rate: num(row[1].s), amount: num(row[2].s), code: row[3] ? tidy(row[3].s) : null };
      // The amount must be base × rate: OCR drops or shifts separators ("267.4051" for 267,405), so an
      // amount that disagrees with the base and rate is replaced by the computed one.
      if (line.base != null && line.rate != null && line.rate >= 0 && line.rate <= 100) {
        const expected = Math.round(line.base * line.rate) / 100;
        if (line.amount == null || Math.abs(line.amount - expected) > Math.max(2, 0.02 * expected)) {
          line.amount = Math.round(expected);
          line.computed = true;
        }
      }
      const key = typ === "SSCL" ? "SSL" : typ === "VTD" ? "VAT" : typ;
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
      // "Description:" in box 31 (OCR reads it as "Pescrption;" and the like); not the box's side
      // label "Description" at the page edge.
      const desc = bfind(/^[DP]escr[il]pt[il]on[:;]$/i) ?? block.find((i) => /^[DP]escr[il]pt[il]on$/i.test(i.s) && i.x > 30);
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
      const uomLbl = bfind(/^4[1l]\s*UOM\s*&\s*Qty\.?\s*[1l]$/i);
      const uom2 = bfind(/^4[1l]\s*UOM\s*&\s*Qty\.?\s*2$/i);
      let uom: string | null = null;
      let quantity: number | null = null;
      // "NIU" and "20.00" as separate runs, or "20.00 3,140" when the quantity runs into the item price.
      // When OCR has garbled the "Qty. 1" label, the values sit just above the "Qty. 2" label instead.
      const toks = uomLbl
        ? below(block, uomLbl, 20, 2, 78).flatMap((i) => i.s.split(/\s+/))
        : uom2
          ? within(block, page, uom2.x - 2 - slack, uom2.x + 78 + slack, uom2.y + 1, uom2.y + 16 + slack).flatMap((i) => i.s.split(/\s+/))
          : [];
      uom = toks.find((s) => /^[A-Z0-9]{2,3}$/.test(s) && !/^\d+$/.test(s)) ?? null;
      if (uom) uom = /^K?GM$/.test(uom) ? "KGM" : /^N[I1l]U$/.test(uom) ? "NIU" : uom;
      const q = toks.find((s) => isNum(s));
      quantity = q ? num(q) : null;
      const stat = bfind(/^46 Statistical Value/i);
      const sv = stat && below(block, stat, 22, 2, 120).find((i) => isNum(i.s));
      const taxes = tables[j] ?? {};
      if (!no && !hs_code && !sv && !Object.keys(taxes).length) return; // an empty continuation block
      // On an import the CID tax base is the same CIF value as box 46, so it stands in when box 46 is unreadable.
      const statistical = sv ? num(sv.s) : (taxes.CID?.base ?? null);
      out.push({
        item_no: no ? parseInt(tidy(no.s), 10) : null,
        hs_code,
        description,
        uom,
        quantity,
        statistical,
        statFromCid: !sv && taxes.CID?.base != null,
        taxes,
      });
    });
  }
  return out;
}

export function parseCusdec(raw: TextItem[], direction: ReconDirection, opts: ParseOptions = {}): CusdecResult {
  slack = opts.loose ? 10 : 0;
  const items = normaliseScale(raw);
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
  const refLabel = find(items, /Customs\s+Ref\w*\s+Number/i);
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
  if (!currency_type) {
    // The accounting block at the foot repeats it: "Invoice Value: USD 1,960.00".
    const iv = find(items, /^Invoice Value/i);
    const cur = iv && items.find((i) => i.page === 1 && Math.abs(i.y - iv.y) < 4 + slack && i.x > iv.x && i.x < iv.x + 120 && /^[A-Z]{3}$/.test(i.s));
    if (cur) currency_type = cur.s;
  }
  const b23 = find(items, /^23 Exchange Rate/) ?? find(items, /Exchange Rate/);
  if (b23) ex_rate = num(below(items, b23, 18, 2, 62).find((i) => isNum(i.s))?.s ?? "");
  if (ex_rate == null) {
    // OCR often garbles the box 23 label; the customs rate is the one figure on page 1 printed with
    // four decimals (e.g. 303.7007), in the top half of the form to the right of the middle.
    const p1 = items.filter((i) => i.page === 1);
    const top = p1.length ? Math.max(...p1.map((i) => i.y)) : 0;
    const r = p1.filter((i) => /^\d{1,3}\.\d{4}$/.test(tidy(i.s)) && i.y > top * 0.5 && i.x > 300).sort((a, b) => b.y - a.y)[0];
    if (r) ex_rate = num(r.s);
  }
  if (invoice_value == null) warnings.push("Total amount invoiced (box 22) not found.");
  if (ex_rate == null) warnings.push("Exchange rate (box 23) not found.");

  // The items: boxes 31 to 46 and the tax table of each.
  const parsed = readItems(items);
  const statFound = parsed.some((i) => i.statistical != null);
  const statistical = parsed.reduce((t, i) => t + (i.statistical ?? 0), 0);
  const fallbackValue = ex_rate != null && invoice_value != null ? r2(ex_rate * invoice_value) : null;
  if (!statFound) warnings.push("Statistical value (box 46) not found; customs value taken as invoice value × rate.");
  parsed.forEach((it, i) => {
    const n = it.item_no ?? i + 1;
    if (it.statFromCid) warnings.push(`Item ${n}: box 46 unreadable; the customs value is the CID tax base.`);
    const fixed = Object.values(it.taxes)
      .filter((t) => t?.computed)
      .map((t) => t!.type);
    if (fixed.length) warnings.push(`Item ${n}: ${fixed.join(", ")} amount${fixed.length === 1 ? "" : "s"} computed from tax base × rate (misread on the scan).`);
  });
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

  // Invoice number: always box 44 (Documents produced), the lines under its "A.D." entry: "INV NO:
  // EXP-1844" on an export, the bare reference ("31/EXP/26-27", "INV2600050") on an import. The box
  // ends where the tax table (box 47: Type, Tax Base...) begins.
  let invoice_no = "";
  const INV = /\bINV(?:OICE)?\.?\s*N[O0]\.?\s*:?\s*([A-Z0-9][A-Z0-9\-\/.]*)/i;
  // The box's column headings, and the form's side labels (whole or as OCR fragments, "pe Autho-"),
  // which OCR may glue onto a value.
  const NOT_REF = /^(A\.?D\.?|Licence\s*No|D\.?Val|D\.?Qty|Type|Tax\s*Base|Rate|Amount|MP|UOM|Qty|Statistical.*)$/i;
  const SIDE = /^(?:[A-Za-z]{1,3}\s+)?(Autho-?|r?ization|zation|c?ertificates|d?ocuments|uments|p?roduced|ation\s+of|tion\s+of|t?axes)\b[.:]?\s*/i;
  // Other papers listed in the box that are not the invoice.
  const OTHER = /^(CPC|B\/?L|AWB|[HM]BL)\b/i;
  const ad = find(items, /^A\.?D\.?$/);
  const b44 = ad ?? find(items, /^44\s*Add/i);
  if (b44) {
    const x0 = ad ? b44.x : b44.x + 40; // the "44 Add. Info" column label sits left of the box's text
    // The box ends where the tax table begins: its "Type" heading, or the first tax line (CID, PAL...)
    // when OCR garbled the heading.
    const under = items.filter((i) => i.page === b44.page && i.y < b44.y - 2 && i.x >= x0 - 10 - slack && i.x < x0 + 60 + slack);
    const head = under.filter((i) => /^(Type|Tax\s*Base)$/i.test(i.s) || TAX_TYPE.test(tidy(i.s))).sort((p, q) => q.y - p.y)[0];
    const floor = head ? head.y + 1 : b44.y - 40 - slack;
    const inBox = within(items, b44.page, x0 - 45 - slack, x0 + 250 + slack, floor, b44.y + 2 + slack)
      .map((i) => ({ ...i, s: i.s.replace(SIDE, "").replace(SIDE, "") }))
      .filter((i) => i.s && !NOT_REF.test(tidy(i.s)));
    // Lines of the box, top first, each line's runs joined ("INV NO:" and "EXP-1884" may be separate runs).
    const lines: string[] = [];
    let last: TextItem | null = null;
    for (const i of inBox) {
      if (last && Math.abs(last.y - i.y) <= 3 + slack / 2) lines[lines.length - 1] += " " + i.s;
      else lines.push(i.s);
      last = i;
    }
    // A reference as printed on an import: digits in it, not the "0+0+..." sum, not an amount, not a permit.
    const looksRef = (v: string) => v.length >= 4 && /\d/.test(v) && !v.includes("+") && !/^\d+\.\d{2}$/.test(v) && !OTHER.test(v);
    // The reference token of a run that OCR glued to a label fragment ("E 202500033").
    const refOf = (run: string) => {
      const toks = tidy(run).split(/\s+/);
      const v = toks.length === 1 ? toks[0] : toks.filter((t) => looksRef(t)).sort((p, q) => q.length - p.length)[0] ?? "";
      return looksRef(v) ? v : "";
    };
    // An "INV NO:" line anywhere in the box wins; else the reference printed at the right of the box,
    // as ASYCUDA lays it out; else any reference-like line (a poor scan with the positions off).
    const noted = lines.map((ln) => ln.match(INV)).find(Boolean);
    if (noted) invoice_no = noted[1];
    else invoice_no = inBox.filter((i) => i.x >= x0 + 100 - slack).map((i) => refOf(i.s)).find(Boolean) ?? lines.map(refOf).find(Boolean) ?? "";
  }
  // Nothing outside box 44 is taken for the invoice number: an empty or unreadable box leaves it blank.
  if (!invoice_no) warnings.push("Invoice number not found in box 44; enter it before saving if there is one.");

  // Party: the consignee (box 8) for exports, the exporter (box 2) for imports. First line = name.
  const partyLabel = find(items, direction === "export" ? /^8\s*Consignee/i : /^2\s*Exporte/i);
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
