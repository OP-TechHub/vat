/**
 * Text extraction from PDFs with positions, via pdf.js. Used in the browser for CusDec uploads and in
 * tests under Node. Each item is one run of text with its page and bottom-left position in PDF points.
 */
export interface TextItem {
  page: number;
  x: number;
  y: number;
  w: number;
  s: string;
}

export interface TextLayer {
  items: TextItem[];
  /**
   * True when the PDF's text came word by word (a scanner's OCR layer) and adjacent words were joined
   * into runs; positions are then approximate, as with OCR.
   */
  wordLevel: boolean;
}

/** A text layer is word-level when almost no run contains a space (a scanner's OCR layer, not a printout). */
export const isWordLevel = (items: TextItem[]): boolean =>
  items.length >= 20 && items.filter((i) => /\s/.test(i.s)).length < items.length * 0.05;

/**
 * Join words that sit on one line within about a space of each other into runs, so labels such as
 * "Customs Reference Number:" are matched the same way as on a printout. Runs separated by a wider
 * gap (another box or column) stay apart.
 */
export function mergeWordRuns(items: TextItem[]): TextItem[] {
  // Reading order: words whose baselines are within 3 points form one line, left to right.
  const byY = [...items].sort((a, b) => a.page - b.page || b.y - a.y);
  const line = new Map<TextItem, number>();
  let n = 0;
  let prev: TextItem | null = null;
  for (const i of byY) {
    if (!prev || prev.page !== i.page || prev.y - i.y > 3) n++;
    prev = i;
    line.set(i, n);
  }
  const sorted = byY.sort((a, b) => line.get(a)! - line.get(b)! || a.x - b.x);
  const out: TextItem[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && line.get(last) === line.get(i)) {
      const cw = last.w / Math.max(1, last.s.length); // average character width of the run so far
      const gap = i.x - (last.x + last.w);
      if (gap >= -1 && gap <= Math.max(3, 1.6 * cw)) {
        last.s = last.s + " " + i.s;
        last.w = i.x + i.w - last.x;
        line.set(last, line.get(i)!);
        continue;
      }
    }
    const copy = { ...i };
    line.set(copy, line.get(i)!);
    out.push(copy);
  }
  return out;
}

export async function extractTextLayer(data: ArrayBuffer | Uint8Array): Promise<TextLayer> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    // Copied from node_modules/pdfjs-dist/build/pdf.worker.min.mjs into public/.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  // pdf.js transfers the buffer to its worker, which detaches it: hand it a copy so the caller's
  // bytes stay usable (the OCR step reads the same file again when there is no text layer).
  const bytes = (data instanceof Uint8Array ? data : new Uint8Array(data)).slice();
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise;
  const out: TextItem[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        out.push({ page: p, x: it.transform[4], y: it.transform[5], w: it.width, s: it.str.trim() });
      }
    }
  } finally {
    await doc.destroy();
  }
  const wordLevel = isWordLevel(out);
  return { items: wordLevel ? mergeWordRuns(out) : out, wordLevel };
}

/** The text runs of every page, words joined into runs when the layer is word-level. */
export async function extractTextItems(data: ArrayBuffer | Uint8Array): Promise<TextItem[]> {
  return (await extractTextLayer(data)).items;
}
