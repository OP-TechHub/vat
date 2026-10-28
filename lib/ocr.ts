/**
 * OCR for scanned PDFs. A scan is a PDF page carrying one big image, so the image is pulled straight
 * out of the page (no rendering) and read with Tesseract. The recognised words become positioned
 * text runs in PDF points, the same shape extractTextItems() returns for text PDFs, so the CusDec
 * parser works on both. Runs in the browser and under Node.
 */
import type { ImageLike } from "tesseract.js";
import type { TextItem } from "./pdfText";

export interface OcrProgress {
  page: number;
  pages: number;
  /** 0..1 within the page. */
  progress: number;
}

export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  line: number;
}

/** Pixel-to-point mapping of one page image. */
export interface PageScale {
  sx: number; // points per pixel, horizontally
  sy: number;
  pageHeight: number; // points
}

/** Strip box borders that OCR glues onto a word, like "|E" or "AU_|". */
const clean = (s: string) => s.replace(/^[|\[\]_]+|[|\[\]_]+$/g, "").trim();

/** Group OCR words on one page into runs: words on the same line separated by less than ~a space. */
export function wordsToItems(words: Word[], page: number, scale: PageScale): TextItem[] {
  const out: TextItem[] = [];
  const byLine = new Map<number, Word[]>();
  for (const w of words) {
    if (!clean(w.text)) continue;
    const a = byLine.get(w.line);
    if (a) a.push(w);
    else byLine.set(w.line, [w]);
  }
  for (const ws of byLine.values()) {
    ws.sort((a, b) => a.x0 - b.x0);
    let run: Word[] = [];
    const flush = () => {
      if (!run.length) return;
      const x0 = run[0].x0;
      const x1 = run[run.length - 1].x1;
      const y1 = Math.max(...run.map((w) => w.y1));
      out.push({
        page,
        x: x0 * scale.sx,
        y: scale.pageHeight - y1 * scale.sy,
        w: (x1 - x0) * scale.sx,
        s: run.map((w) => clean(w.text)).join(" "),
      });
      run = [];
    };
    for (const w of ws) {
      if (run.length) {
        const prev = run[run.length - 1];
        const h = Math.max(prev.y1 - prev.y0, w.y1 - w.y0, 1);
        if (w.x0 - prev.x1 > 0.9 * h) flush();
      }
      run.push(w);
    }
    flush();
  }
  return out;
}

/**
 * pdf.js's decoded page image. In the browser a JPEG scan usually arrives as a ready-made bitmap with
 * `data` left null; under Node (and for other encodings) it is a pixel array of 1, 3 or 4 bytes per pixel.
 */
interface PdfImage {
  width: number;
  height: number;
  data?: Uint8ClampedArray | Uint8Array | null;
  bitmap?: ImageBitmap | null;
}

/** RGBA pixels from a pdf.js pixel array (1, 3 or 4 bytes per pixel). */
function toRgba(img: PdfImage & { data: Uint8ClampedArray | Uint8Array }): Uint8ClampedArray<ArrayBuffer> {
  const n = img.width * img.height;
  const ch = img.data.length / n;
  const out = new Uint8ClampedArray(new ArrayBuffer(n * 4));
  for (let i = 0, j = 0; i < n; i++, j += ch) {
    if (ch === 1) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = img.data[j];
    else {
      out[i * 4] = img.data[j];
      out[i * 4 + 1] = img.data[j + 1];
      out[i * 4 + 2] = img.data[j + 2];
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Something Tesseract can read: a canvas or ImageData in the browser, a PNG buffer under Node. */
async function toImage(img: PdfImage): Promise<ImageLike> {
  if (img.bitmap && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Could not create a canvas to read the scan.");
    ctx.drawImage(img.bitmap, 0, 0);
    return c;
  }
  if (!img.data) throw new Error("The page image could not be decoded.");
  const rgba = toRgba({ ...img, data: img.data });
  if (typeof document !== "undefined" && typeof ImageData !== "undefined") return new ImageData(rgba, img.width, img.height);
  const { PNG } = await import("pngjs");
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return PNG.sync.write(png);
}

export async function ocrPdfToTextItems(
  data: ArrayBuffer | Uint8Array,
  onProgress?: (p: OcrProgress) => void,
): Promise<TextItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const { createWorker } = await import("tesseract.js");
  const bytes = (data instanceof Uint8Array ? data : new Uint8Array(data)).slice(); // see pdfText.ts
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise;
  const out: TextItem[] = [];
  let current = 1;
  const worker = await createWorker("eng", 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === "recognizing text" && onProgress) onProgress({ page: current, pages: doc.numPages, progress: m.progress ?? 0 });
    },
  });
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      current = p;
      onProgress?.({ page: p, pages: doc.numPages, progress: 0 });
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const names: string[] = [];
      for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) names.push(ops.argsArray[i][0] as string);
      if (!names.length) continue; // nothing scanned on this page
      const images = await Promise.all(names.map((n) => new Promise<PdfImage>((resolve) => page.objs.get(n, resolve))));
      const img = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
      const { data: res } = await worker.recognize(await toImage(img), {}, { blocks: true });
      const words: Word[] = [];
      let line = 0;
      for (const b of res.blocks ?? [])
        for (const para of b.paragraphs)
          for (const ln of para.lines) {
            line++;
            for (const w of ln.words) words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line });
          }
      out.push(...wordsToItems(words, p, { sx: vp.width / img.width, sy: vp.height / img.height, pageHeight: vp.height }));
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }
  return out;
}
