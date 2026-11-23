/**
 * Packing list / commercial invoice PDF reader for the TIEP invoice register (ported from the
 * single-file TIEP Import Register). The PDF's text layer is read with positions and parsed by
 * layout: header labels (INVOICE NO, DATE, ...), the CONSIGNEE / DELIVER TO blocks and the product
 * table. Quantities stay in the document's own unit (KG or LB); `toKgRows` converts them.
 */
import { extractTextLayer } from "@/lib/pdfText";
import { LB_KG } from "@/lib/sales";
import type { PlRow } from "@/lib/tiep/invoices";

/** One run of text on a page; y runs top-down (larger = lower on the page). */
export interface PlTextItem {
  str: string;
  x: number;
  y: number;
  w?: number;
}

export interface PlHeader {
  invNo: string;
  dateRaw: string;
  /** dateRaw as an ISO date, or "" when it cannot be read. */
  date: string;
  orderNo: string;
  destination: string;
  vessel: string;
  bl: string;
  container: string;
  hcRef: string;
  incoterm: string;
  consignee: string;
  deliverTo: string;
  wUnit: "KG" | "LB";
  totBoxes: number;
  totNet: number;
  totGross: number;
  totAmount: number;
  source: "packing" | "invoice";
}

export type ParsedRow = Required<PlRow>;

export interface ParsedPL {
  header: PlHeader;
  rows: ParsedRow[];
  /** Set when a page had no recognisable product table. */
  err?: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Excel serials, yyyy-mm-dd, dd.mm.yyyy (or / -), dd-Mon-yyyy → ISO date; "" otherwise. */
export function parseAnyDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let m: RegExpMatchArray | null;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = +s;
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5).toISOString().slice(0, 10);
  }
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  }
  if ((m = s.match(/^(\d{1,2})[-\s\/.]([A-Za-z]{3})[A-Za-z]*[-\s\/.,]+(\d{2,4})$/))) {
    const mi = MON.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (mi >= 0) {
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      return y + "-" + String(mi + 1).padStart(2, "0") + "-" + m[1].padStart(2, "0");
    }
  }
  return "";
}

/** A column heading that names pounds, e.g. "NET WT (LBS)". */
const hdrLb = (h: string) => /(\(|\b)(lbs?|pounds?)(\)|\b)/i.test(String(h || ""));
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
/** "1,234.5" → 1234.5; anything unreadable → 0. */
const pn = (v: unknown) => +String(v || "").replace(/,/g, "") || 0;

interface It { s: string; x: number; y: number; w: number }
interface Line { y: number; items: It[]; text: string }
type PageHeader = Omit<PlHeader, "date" | "wUnit" | "totBoxes" | "totNet" | "totGross" | "totAmount" | "source"> &
  Partial<Pick<PlHeader, "wUnit" | "totBoxes" | "totNet" | "totGross" | "totAmount" | "source">>;
interface PageResult { header: PageHeader; rows: ParsedRow[]; err?: string }

const LBL =
  /^(INVOICE\s*NO\.?|DATE|YOUR\s*ORDER\s*NO\.?|ORDER\s*NO\.?|DESTINATION|VESSEL(\s*\/\s*FLIGHT)?|(?:BL|AWB)(?:\s*NO\.?)?(?:\s*\/\s*(?:BL|AWB)(?:\s*NO\.?)?)?|CONTAINER\s*NO\.?|HC\s*REF\s*NO\.?|INCOTERM|SCIENTIFIC\s*NAME)\s*:?\s*(.*)$/i;

/** Parse one page: header fields, address blocks and product rows (in the document's unit). */
export function parsePLPage(items: PlTextItem[]): PageResult {
  const its: It[] = items.filter((i) => norm(i.str)).map((i) => ({ s: norm(i.str), x: i.x, y: i.y, w: i.w || 0 }));
  its.sort((a, b) => a.y - b.y || a.x - b.x);

  // Group runs into lines (baselines within 2.5 pt), each read left to right.
  const lines: Line[] = [];
  for (const it of its) {
    let L = lines.find((l) => Math.abs(l.y - it.y) < 2.5);
    if (!L) lines.push((L = { y: it.y, items: [], text: "" }));
    L.items.push(it);
  }
  lines.sort((a, b) => a.y - b.y);
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.s).join(" ");
  }

  // Header labels: the value is the rest of the run plus the runs to its right on the same line.
  const H: PageHeader = { invNo: "", dateRaw: "", orderNo: "", destination: "", vessel: "", bl: "", container: "", hcRef: "", incoterm: "", consignee: "", deliverTo: "" };
  let labelX = 1e9; // left edge of the label column (right-hand block); address text stops there
  for (const l of lines) {
    for (let k = 0; k < l.items.length; k++) {
      const it = l.items[k];
      const m = it.s.match(LBL);
      if (!m) continue;
      const lab = m[1].toUpperCase().replace(/\s+/g, " ");
      const rest = norm([m[m.length - 1]].concat(l.items.slice(k + 1).filter((x) => x.x > it.x).map((x) => x.s)).join(" ")).replace(/^:\s*/, "");
      if (!rest) continue;
      const key: keyof PageHeader | null = /^INVOICE/.test(lab) ? "invNo" : /^DATE/.test(lab) ? "dateRaw" : /ORDER/.test(lab) ? "orderNo"
        : /^DESTINATION/.test(lab) ? "destination" : /^VESSEL/.test(lab) ? "vessel" : /^(BL|AWB)/.test(lab) ? "bl"
        : /^CONTAINER/.test(lab) ? "container" : /^HC/.test(lab) ? "hcRef" : /^INCOTERM/.test(lab) ? "incoterm" : null;
      if (key === "dateRaw") {
        const dm = rest.match(/[0-9]{1,2}[.\/-][0-9]{1,2}[.\/-][0-9]{2,4}/);
        if (!dm) continue; // "DATE" with no date after it: keep looking on this line
        H.dateRaw = H.dateRaw || dm[0];
      } else if (key && !H[key]) (H as unknown as Record<string, string>)[key] = rest;
      if (key) labelX = Math.min(labelX, it.x);
      break;
    }
  }

  // Packing-list table header ("Product ... Net / Box / Best before"), possibly over several lines.
  const hdrIdx = lines.findIndex((l) => /product/i.test(l.text) && /(net|box|best)/i.test(l.text));
  const hdrTop = hdrIdx < 0 ? -1 : lines.findIndex((l) => Math.abs(l.y - lines[hdrIdx].y) < 10);
  const leftText = (l: Line, x0: number, x1: number) => norm(l.items.filter((i) => i.x >= x0 - 2 && i.x < x1 - 5).map((i) => i.s).join(" "));
  const findIt = (re: RegExp) => {
    for (let i = 0; i < lines.length; i++) for (const it of lines[i].items) if (re.test(it.s)) return { i, it };
    return null;
  };
  const tblI = lines.findIndex((l) => /DESCRIPTION|NET\s*WEIGHT|OF\s*BOXES/i.test(l.text));
  const tblEnd = tblI < 0 ? lines.length : Math.max(0, lines.findIndex((l) => l.y > lines[tblI].y - 14));

  // CONSIGNEE / DELIVER TO: side by side (split at DELIVER TO's x) or stacked.
  const C = findIt(/^CONSIGNEE\b/i), Dl = findIt(/^DELIVER\s*TO\b/i), end = hdrTop >= 0 ? hdrTop : tblEnd;
  if (C && Dl && Math.abs(lines[C.i].y - lines[Dl.i].y) < 3) {
    const x1 = Dl.it.x;
    for (let i = C.i + 1; i < end; i++) {
      const a = leftText(lines[i], 0, x1), b = leftText(lines[i], x1, labelX);
      if (a) H.consignee += (H.consignee ? ", " : "") + a;
      if (b) H.deliverTo += (H.deliverTo ? ", " : "") + b;
    }
  } else if (C) {
    const stop = Dl && Dl.i > C.i ? Dl.i : end;
    for (let i = C.i + 1; i < stop; i++) {
      const a = leftText(lines[i], 0, labelX);
      if (a) H.consignee += (H.consignee ? ", " : "") + a;
    }
    if (Dl)
      for (let i = Dl.i + 1; i < end; i++) {
        const a = leftText(lines[i], 0, labelX);
        if (a) H.deliverTo += (H.deliverTo ? ", " : "") + a;
      }
  }
  H.consignee = H.consignee.replace(/,\s*,/g, ",");
  H.deliverTo = H.deliverTo.replace(/,\s*,/g, ",");

  if (hdrIdx < 0) {
    // Commercial-invoice layout: NO OF BOXES | DESCRIPTION OF GOODS | NET WEIGHT | UNIT PRICE | AMOUNT
    const di = lines.findIndex((l) => /DESCRIPTION/i.test(l.text));
    if (di < 0) return { header: H, rows: [], err: "Could not find the product table (Product / Description, Net Weight)." };
    H.wUnit = lines.filter((l) => Math.abs(l.y - lines[di].y) < 14).some((l) => l.items.some((i) => hdrLb(i.s))) ? "LB" : "KG";
    const below = lines.filter((l) => l.y > lines[di].y + 1);
    const ti = below.findIndex((l) => /^\s*\d*\s*TOTAL\b/i.test(l.text) || /\bTOTAL\b/i.test(l.text));
    const body = ti < 0 ? below : below.slice(0, ti);
    const numRe = /^[\d,]+(\.\d+)?$/;
    const rows: ParsedRow[] = [];
    for (const l of body) {
      // A row starts with the box count and ends with 2-3 numbers (net, [unit price], amount).
      const it = l.items;
      if (it.length < 4 || !/^\d+$/.test(it[0].s)) continue;
      const tail: string[] = [];
      let k = it.length - 1;
      while (k > 0 && numRe.test(it[k].s)) tail.unshift(it[k--].s);
      if (tail.length < 2) continue;
      const desc = norm(it.slice(1, k + 1).map((x) => x.s).join(" "));
      const net = pn(tail[0]), price = tail.length >= 3 ? pn(tail[1]) : 0, amount = pn(tail[tail.length - 1]);
      rows.push({ bbd: "", boxRange: "", boxes: pn(it[0].s), net, gross: 0, price, amount, desc });
    }
    // TOTAL line numbers: boxes, net, amount (fallback: sum of rows).
    const tl = ti < 0 ? null : below[ti];
    const tn = tl ? tl.items.map((i) => i.s).filter((x) => numRe.test(x)).map(pn) : [];
    H.totBoxes = tn.length >= 1 ? tn[0] : rows.reduce((a, r) => a + r.boxes, 0);
    H.totNet = tn.length >= 2 ? tn[1] : rows.reduce((a, r) => a + r.net, 0);
    H.totGross = 0;
    H.totAmount = tn.length >= 3 ? tn[2] : rows.reduce((a, r) => a + r.amount, 0);
    H.source = "invoice";
    return { header: H, rows };
  }

  // Packing-list layout. Header columns can span 2-3 lines.
  const hl = lines.filter((l) => Math.abs(l.y - lines[hdrIdx].y) < 8);
  H.wUnit = hl.some((l) => l.items.some((i) => hdrLb(i.s))) ? "LB" : "KG";
  const hx = (re: RegExp) => {
    for (const l of hl) for (const i of l.items) if (re.test(i.s)) return i.x;
    return null;
  };
  const bbdX = hx(/best/i), netX = hx(/net/i), prodX = hx(/^product/i);
  const startY = Math.max(...hl.map((l) => l.y));
  const totIdx = lines.findIndex((l) => l.y > startY && /TOTAL/i.test(l.text));
  const body = lines.filter((l) => l.y > startY + 1 && (totIdx < 0 || l.y < lines[totIdx].y - 1));
  const dateRe = /\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/;
  // Product text sits left of the best-before column (or well left of the net column).
  const prodLim = bbdX != null ? bbdX - 8 : (netX || 1e9) - 60;
  const prodTxt = (l: Line) => {
    let it = l.items.filter((i) => i.x < prodLim);
    // Drop a leading line number that sits left of the Product heading.
    if (it.length && /^\d{1,3}$/.test(it[0].s) && (prodX == null || it[0].x < prodX - 30)) it = it.slice(1);
    return norm(it.map((i) => i.s).join(" "));
  };
  // Data lines carry a best-before date or a decimal number under the net column.
  const data = body.filter((l) => dateRe.test(l.text) || l.items.some((i) => netX != null && i.x > netX - 40 && /^[\d,]+\.\d+$/.test(i.s)));
  const rows = data.map((l) => {
    const tail = l.items.filter((i) => i.x >= prodLim).map((i) => i.s).join(" ");
    const bbd = (tail.match(dateRe) || [""])[0];
    const after = tail.replace(bbd, "").trim();
    // [box range "1 - 20"] boxes net gross
    const m = after.match(/^(.*?\d+\s*-\s*\d+)?\s*([\d,]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/);
    return {
      y: l.y,
      parts: [{ y: l.y, t: prodTxt(l) }],
      bbd,
      boxRange: m && m[1] ? norm(m[1]) : "",
      boxes: m ? pn(m[2]) : 0,
      net: m ? pn(m[3]) : 0,
      gross: m ? pn(m[4]) : 0,
    };
  });
  // Wrapped product text on other lines joins the nearest data row (ties go to the row above).
  for (const l of body) {
    if (data.includes(l)) continue;
    const t = prodTxt(l);
    if (!t || /TOTAL/i.test(t)) continue;
    let best: { r: (typeof rows)[number]; d: number } | null = null;
    for (const r of rows) {
      const d = Math.abs(r.y - l.y) + (l.y > r.y ? 0.01 : 0);
      if (!best || d < best.d) best = { r, d };
    }
    if (best) best.r.parts.push({ y: l.y, t });
  }
  const out: ParsedRow[] = rows.map((r) => ({
    desc: norm(r.parts.sort((a, b) => a.y - b.y).map((p) => p.t).join(" ").replace(/\s+-\s*$/, "")),
    boxes: r.boxes,
    net: r.net,
    gross: r.gross,
    bbd: r.bbd,
    boxRange: r.boxRange,
    price: 0,
    amount: 0,
  }));
  // TOTAL line: the last three numbers are boxes, net, gross (fallback: sum of rows).
  const tl = totIdx >= 0 ? lines[totIdx] : null;
  const tn = tl ? tl.items.map((i) => i.s).filter((s) => /^[\d,.]+$/.test(s)).map((s) => +s.replace(/,/g, "")) : [];
  H.totBoxes = tn.length >= 3 ? tn[tn.length - 3] : out.reduce((a, r) => a + r.boxes, 0);
  H.totNet = tn.length >= 2 ? tn[tn.length - 2] : out.reduce((a, r) => a + r.net, 0);
  H.totGross = tn.length ? tn[tn.length - 1] : out.reduce((a, r) => a + r.gross, 0);
  return { header: H, rows: out };
}

/**
 * Parse every page: the header comes from the first page (or the first page that has an invoice
 * number when the first does not); rows from all pages. Pure, for tests.
 */
export function parsePL(pages: PlTextItem[][]): ParsedPL {
  let header: PageHeader | null = null;
  let err: string | undefined;
  let rows: ParsedRow[] = [];
  for (const items of pages) {
    const r = parsePLPage(items);
    if (!header || (!header.invNo && r.header.invNo)) header = r.header;
    rows = rows.concat(r.rows || []);
    if (r.err && !err) err = r.err;
  }
  const h: PageHeader = header || { invNo: "", dateRaw: "", orderNo: "", destination: "", vessel: "", bl: "", container: "", hcRef: "", incoterm: "", consignee: "", deliverTo: "" };
  const out: ParsedPL = {
    header: {
      ...h,
      date: parseAnyDate(h.dateRaw),
      wUnit: h.wUnit || "KG",
      totBoxes: h.totBoxes || 0,
      totNet: h.totNet || 0,
      totGross: h.totGross || 0,
      totAmount: h.totAmount || 0,
      source: h.source || "packing",
    },
    rows,
  };
  if (err && !rows.length) out.err = err;
  return out;
}

/** Read a packing list or commercial invoice PDF. Throws for scans (no text layer) or no product lines. */
export async function readPackingPdf(file: File | ArrayBuffer): Promise<ParsedPL> {
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const { items } = await extractTextLayer(data);
  if (!items.length) throw new Error("This PDF has no text layer (it looks like a scan), so its lines cannot be read. Upload the lines as CSV instead.");
  // pdfText gives bottom-up y; the parser only compares positions, so negating gives top-down order.
  const pages: PlTextItem[][] = [];
  for (const i of items) (pages[i.page - 1] ||= []).push({ str: i.s, x: i.x, y: -i.y, w: i.w });
  const parsed = parsePL(pages.filter(Boolean));
  if (!parsed.rows.length) throw new Error("No product lines found in this PDF. If it is a scan, upload the lines as CSV instead.");
  return parsed;
}

export type KgRow = ParsedRow & { netIn: number; grossIn: number };

/**
 * Convert a parse to kilograms. unit "auto" uses the unit detected from the table headings; "KG"/"LB"
 * force it. Rows keep the source quantities in netIn / grossIn; header.totNetIn keeps the source total net.
 */
export function toKgRows(parsed: ParsedPL, unit: "auto" | "KG" | "LB" = "auto") {
  const unitUsed: "KG" | "LB" = unit === "KG" || unit === "LB" ? unit : parsed.header.wUnit || "KG";
  const K = (v: number) => (unitUsed === "LB" ? +((+v || 0) * LB_KG).toFixed(4) : +v || 0);
  const H = parsed.header;
  return {
    unitUsed,
    header: { ...H, totNetIn: H.totNet || 0, totNet: K(H.totNet), totGross: K(H.totGross) },
    rows: parsed.rows.map((r): KgRow => ({ ...r, netIn: r.net, grossIn: r.gross, net: K(r.net), gross: K(r.gross) })),
  };
}

/** Merge two documents' pl data: non-empty values of b override a; differing docTypes combine. */
export function mergePl<T extends Record<string, unknown>>(a: T | null | undefined, b: Partial<T> | null | undefined): T {
  const o: Record<string, unknown> = Object.assign({}, a || {});
  for (const k in b || {}) {
    const x = (b as Record<string, unknown>)[k];
    if (x !== "" && x != null && x !== 0) o[k] = x;
  }
  if (a && a.docType && b && b.docType && a.docType !== b.docType) o.docType = "Commercial invoice + packing list";
  return o as T;
}
