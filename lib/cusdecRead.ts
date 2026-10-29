/**
 * Read every customs declaration in one PDF, whatever form the file takes:
 * - an ASYCUDA printout with a text layer (one CusDec, possibly with continuation sheets);
 * - a scanned bundle (invoice, packing list, bill of lading, CusDec...) with a scanner's OCR layer,
 *   whose words and positions are too rough to parse: the CusDec pages are found from that layer and
 *   read again with our own OCR;
 * - a plain scan with no text at all: a quick low-resolution OCR pass over every page finds the
 *   CusDec pages, which are then read properly.
 * OCR runs twice over the CusDec pages, with Tesseract's single-block mode 6 (good at the labels)
 * and its sparse-text mode 11 (good at figures and the tax table), and the fields of both readings
 * are merged. Runs in the browser (upload) and under Node (tests).
 */
import { cusdecPageGroups, parseCusdec, splitCusdecs, type CusdecResult } from "./cusdec";
import type { OcrProgress } from "./ocr";
import { extractTextLayer, type TextItem } from "./pdfText";
import type { CustomsUploadRow, ReconDirection } from "./types";

export interface ReadProgress {
  /** What is happening, for the busy text. */
  text: string;
}

export interface CusdecRead {
  /** One result per declaration found, in page order. */
  results: CusdecResult[];
  /** Pages of the document each result came from. */
  pages: number[][];
  /** True when the declarations were read by OCR (figures need checking). */
  scanned: boolean;
  /** Pages in the document. */
  pageCount: number;
}

/** A parse that found the reference, the invoice amount and the rate is trusted. */
const readable = (r: CusdecResult) => !!r.row.cusdec_no && r.row.invoice_value != null && r.row.ex_rate != null;

const pageCountOf = (items: TextItem[]) => new Set(items.map((i) => i.page)).size;

/** Fields a second reading may fill in when the first left them blank. */
const FIELDS = [
  "cusdec_no", "cusdec_date", "cusdec_month", "invoice_no", "currency_type", "ex_rate", "invoice_value", "party",
  "hs_code", "description", "uom", "quantity", "customs_value",
  "cid_amount", "cid_code", "pal_amount", "pal_code", "sscl_amount", "sscl_code", "vat_base", "vat_amount", "vat_type", "vat_code",
] as const;
const blank = (v: unknown) => v == null || v === "";

/** The warning each field clears when it is filled. */
const WARNING_FOR: Partial<Record<(typeof FIELDS)[number], RegExp>> = {
  cusdec_no: /reference number not found/i,
  invoice_value: /box 22/i,
  ex_rate: /box 23/i,
  customs_value: /box 46/i,
  invoice_no: /Invoice number not found/i,
};

function fillRow(a: CustomsUploadRow, b: CustomsUploadRow | undefined): CustomsUploadRow {
  if (!b) return a;
  const out = { ...a };
  for (const f of FIELDS) if (blank(out[f]) && !blank(b[f])) (out as unknown as Record<string, unknown>)[f] = b[f];
  return out;
}

/** The first reading with every blank field taken from the second, items matched by item number. */
export function mergeReadings(a: CusdecResult, b: CusdecResult): CusdecResult {
  const items = a.items.map((it, i) => fillRow(it, b.items.find((x) => x.item_no === it.item_no) ?? b.items[i]));
  for (const it of b.items) if (!items.some((x) => x.item_no === it.item_no)) items.push(it);
  items.sort((x, y) => x.item_no - y.item_no);
  // Header fields found by either reading apply to every line.
  const header = fillRow(a.row, b.row);
  for (const it of items) for (const f of ["cusdec_no", "cusdec_date", "cusdec_month", "invoice_no", "currency_type", "ex_rate", "invoice_value", "party"] as const)
    if (blank(it[f]) && !blank(header[f])) (it as unknown as Record<string, unknown>)[f] = header[f];
  const row = fillRow(a.row, b.row);
  const sum = (f: "customs_value" | "vat_base" | "vat_amount" | "cid_amount" | "pal_amount" | "sscl_amount" | "quantity") =>
    items.some((i) => i[f] != null) ? Math.round(items.reduce((t, i) => t + (i[f] ?? 0), 0) * 100) / 100 : row[f];
  const merged: CustomsUploadRow = {
    ...row,
    customs_value: sum("customs_value"),
    vat_base: sum("vat_base"),
    vat_amount: sum("vat_amount"),
    cid_amount: sum("cid_amount"),
    pal_amount: sum("pal_amount"),
    sscl_amount: sum("sscl_amount"),
    quantity: sum("quantity"),
  };
  const warnings = a.warnings.filter((w) => !Object.entries(WARNING_FOR).some(([f, re]) => re.test(w) && !blank(merged[f as keyof CustomsUploadRow])));
  for (const w of b.warnings) if (/far from the statistical value|wrong direction|uploaded as an/i.test(w) && !warnings.includes(w)) warnings.push(w);
  return { declaration: a.declaration || b.declaration, warnings, row: merged, items };
}

/** OCR the given pages in both modes and parse each declaration from the merged readings. */
async function ocrAndParse(
  bytes: Uint8Array,
  direction: ReconDirection,
  pages: number[] | undefined,
  onProgress?: (p: ReadProgress) => void,
): Promise<{ results: CusdecResult[]; groups: number[][]; items: TextItem[] }> {
  const { ocrPdfToTextItems } = await import("./ocr");
  const progress = (pass: string) => (p: OcrProgress) =>
    onProgress?.({ text: `Reading with OCR (${pass}), page ${p.page} of ${p.pages}, ${Math.round(p.progress * 100)}%…` });
  const auto = await ocrPdfToTextItems(bytes, progress("labels"), { pages, psm: 6 });
  const sparse = await ocrPdfToTextItems(bytes, progress("figures"), { pages, psm: 11 });
  const all = [...auto, ...sparse];
  const groups = cusdecPageGroups(all);
  const pick = (items: TextItem[]) => (groups.length ? groups.map((g) => items.filter((i) => g.includes(i.page)).map((i) => ({ ...i, page: g.indexOf(i.page) + 1 }))) : [items]);
  const a = pick(auto);
  const b = pick(sparse);
  const results = a.map((d, i) => {
    const ra = parseCusdec(d, direction, { loose: true });
    const rb = b[i]?.length ? parseCusdec(b[i], direction, { loose: true }) : null;
    if (!rb) return ra;
    // Sparse text reads the figures better, so it leads; the layout pass fills what it missed.
    return mergeReadings(rb, ra);
  });
  return { results, groups, items: all };
}

export async function readCusdecs(
  data: ArrayBuffer | Uint8Array,
  direction: ReconDirection,
  onProgress?: (p: ReadProgress) => void,
): Promise<CusdecRead> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  onProgress?.({ text: "Reading the text layer…" });
  const layer = await extractTextLayer(bytes);

  // 1. A text layer: try it as it is (a printout parses straight away).
  if (layer.items.length >= 20) {
    const groups = cusdecPageGroups(layer.items);
    const decls = splitCusdecs(layer.items);
    const results = decls.map((d) => parseCusdec(d, direction, { loose: layer.wordLevel }));
    const pageCount = pageCountOf(layer.items);
    if (results.length && results.every(readable))
      return { results, pages: groups.length ? groups : [[...new Set(layer.items.map((i) => i.page))]], scanned: false, pageCount };

    // 2. The layer is a scanner's: OCR the CusDec pages it points to (or every page when it points nowhere).
    const ocr = await ocrAndParse(bytes, direction, groups.length ? groups.flat() : undefined, onProgress);
    const ocrBetter = ocr.results.filter(readable).length >= results.filter(readable).length;
    return ocrBetter
      ? { results: ocr.results, pages: ocr.groups.length ? ocr.groups : groups.length ? groups : [[...new Set(ocr.items.map((i) => i.page))]], scanned: true, pageCount }
      : { results, pages: groups.length ? groups : [[...new Set(layer.items.map((i) => i.page))]], scanned: false, pageCount };
  }

  // 3. No text at all: a quick low-resolution pass over every page tells the CusDec pages apart, then
  //    those pages are read properly.
  const { ocrPdfToTextItems } = await import("./ocr");
  const quick = await ocrPdfToTextItems(
    bytes,
    (p) => onProgress?.({ text: `Looking for the CusDec pages, page ${p.page} of ${p.pages}…` }),
    { psm: 11, shrink: 2 },
  );
  const quickGroups = cusdecPageGroups(quick);
  const ocr = await ocrAndParse(bytes, direction, quickGroups.length ? quickGroups.flat() : undefined, onProgress);
  return {
    results: ocr.results,
    pages: ocr.groups.length ? ocr.groups : quickGroups.length ? quickGroups : [[...new Set(ocr.items.map((i) => i.page))]],
    scanned: true,
    pageCount: Math.max(pageCountOf(quick), pageCountOf(ocr.items)),
  };
}
