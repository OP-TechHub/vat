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

export async function extractTextItems(data: ArrayBuffer | Uint8Array): Promise<TextItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    // Copied from node_modules/pdfjs-dist/build/pdf.worker.min.mjs into public/.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
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
  return out;
}
