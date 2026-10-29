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

/** Shrink RGBA pixels by an integer factor (box average), for a quick low-resolution pass. */
function shrink(rgba: Uint8ClampedArray, w: number, h: number, f: number): { data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } {
  const W = Math.floor(w / f);
  const H = Math.floor(h / f);
  const out = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * w + (x * f + dx)) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
        }
      const o = (y * W + x) * 4;
      const n = f * f;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  return { data: out, w: W, h: H };
}

/** Rotate RGBA pixels by 90 (clockwise) or 270 degrees; the result is h wide and w high. */
function rotate(rgba: Uint8ClampedArray, w: number, h: number, deg: 90 | 270): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // New image is h wide: clockwise puts the top row down the right edge.
      const nx = deg === 90 ? h - 1 - y : y;
      const ny = deg === 90 ? x : w - 1 - x;
      const o = (ny * h + nx) * 4;
      out[o] = rgba[i];
      out[o + 1] = rgba[i + 1];
      out[o + 2] = rgba[i + 2];
      out[o + 3] = 255;
    }
  return out;
}

/**
 * Something Tesseract can read: a canvas or ImageData in the browser, a PNG buffer under Node.
 * `f` shrinks the image by that factor; `deg` turns it (90 clockwise or 270) for a sideways scan.
 */
async function toImage(img: PdfImage, f = 1, deg: 0 | 90 | 270 = 0): Promise<ImageLike> {
  if (img.bitmap && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    const w = Math.floor(img.width / f);
    const h = Math.floor(img.height / f);
    c.width = deg ? h : w;
    c.height = deg ? w : h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Could not create a canvas to read the scan.");
    if (deg) {
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img.bitmap, -w / 2, -h / 2, w, h);
    } else ctx.drawImage(img.bitmap, 0, 0, w, h);
    return c;
  }
  if (!img.data) throw new Error("The page image could not be decoded.");
  let rgba = toRgba({ ...img, data: img.data });
  let w = img.width;
  let h = img.height;
  if (f > 1) ({ data: rgba, w, h } = shrink(rgba, w, h, f));
  if (deg) {
    rgba = rotate(rgba, w, h, deg);
    [w, h] = [h, w];
  }
  if (typeof document !== "undefined" && typeof ImageData !== "undefined") return new ImageData(rgba, w, h);
  const { PNG } = await import("pngjs");
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return PNG.sync.write(png);
}

/** Words that look like words: how much sense an OCR pass made of a page, for choosing its orientation. */
const wordScore = (res: { text?: string }) => (res.text ?? "").split(/\s+/).filter((w) => /^[A-Za-z]{3,}$/.test(w)).length;

export async function ocrPdfToTextItems(
  data: ArrayBuffer | Uint8Array,
  onProgress?: (p: OcrProgress) => void,
  opts: {
    pages?: number[];
    /**
     * Tesseract page segmentation mode. Left unset, tesseract.js reads the page as one block (mode 6),
     * which suits the form's labels; 11, sparse text, keeps figures and the tax table's rows intact.
     * The CusDec reader runs both and merges the fields.
     */
    psm?: number;
    /** Shrink the page image by this factor first: a quick, rough pass for telling pages apart. */
    shrink?: number;
  } = {},
): Promise<TextItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const { createWorker } = await import("tesseract.js");
  const bytes = (data instanceof Uint8Array ? data : new Uint8Array(data)).slice(); // see pdfText.ts
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise;
  const wanted = (opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= doc.numPages);
  const f = Math.max(1, Math.floor(opts.shrink ?? 1));
  const out: TextItem[] = [];
  let current = 1;
  const worker = await createWorker("eng", 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === "recognizing text" && onProgress) onProgress({ page: current, pages: wanted.length, progress: m.progress ?? 0 });
    },
  });
  try {
    if (opts.psm != null) await worker.setParameters({ tessedit_pageseg_mode: String(opts.psm) as never });
    for (let n = 0; n < wanted.length; n++) {
      const p = wanted[n];
      current = n + 1;
      onProgress?.({ page: n + 1, pages: wanted.length, progress: 0 });
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const names: string[] = [];
      for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) names.push(ops.argsArray[i][0] as string);
      if (!names.length) continue; // nothing scanned on this page
      const images = await Promise.all(names.map((n) => new Promise<PdfImage>((resolve) => page.objs.get(n, resolve))));
      const img = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
      // A landscape scan of a portrait form was fed in sideways: find which way is up on a rough
      // quarter-size read of both turns, then read the page turned that way.
      let deg: 0 | 90 | 270 = 0;
      if (img.width > img.height * 1.15) {
        const probe = async (d: 90 | 270) => wordScore((await worker.recognize(await toImage(img, Math.max(f, 4), d), {}, { text: true })).data);
        const [s90, s270] = [await probe(90), await probe(270)];
        deg = s90 >= s270 ? 90 : 270;
      }
      const image = await toImage(img, f, deg);
      // Positions in PDF points of the page as it is read: a turned page is taken as portrait.
      const iw = deg ? img.height : img.width;
      const ih = deg ? img.width : img.height;
      const pw = deg ? vp.height : vp.width;
      const ph = deg ? vp.width : vp.height;
      const scale = { sx: (pw / iw) * f, sy: (ph / ih) * f, pageHeight: ph };
      const { data: res } = await worker.recognize(image, {}, { blocks: true });
      const words: Word[] = [];
      let line = 0;
      for (const b of res.blocks ?? [])
        for (const para of b.paragraphs)
          for (const ln of para.lines) {
            line++;
            for (const w of ln.words) words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line });
          }
      out.push(...wordsToItems(words, p, scale));
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }
  return out;
}
