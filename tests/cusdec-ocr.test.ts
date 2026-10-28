import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractTextItems } from "@/lib/pdfText";
import { ocrPdfToTextItems, wordsToItems } from "@/lib/ocr";
import { parseCusdec } from "@/lib/cusdec";

const root = path.resolve(__dirname, "..");
const scanned = path.join(root, "custom", "export", "7690 CUSDEC.pdf");
const read = (p: string) => new Uint8Array(readFileSync(p));

describe("scanned CusDec via OCR", () => {
  it("groups OCR words into runs split at box borders", () => {
    const w = (text: string, x0: number, x1: number, line = 1) => ({ text, x0, y0: 100, x1, y1: 120, line });
    const items = wordsToItems(
      [w("|22", 10, 30), w("Currency", 36, 110), w("&", 116, 126), w("23", 300, 320), w("Exchange|", 326, 400)],
      1,
      { sx: 0.5, sy: 0.5, pageHeight: 600 },
    );
    expect(items.map((i) => i.s)).toEqual(["22 Currency &", "23 Exchange"]);
    expect(items[0].x).toBe(5);
    expect(items[0].y).toBe(600 - 60);
  });

  it.skipIf(!existsSync(scanned))(
    "reads the scanned export CusDec E 43210 (page 2 is the commercial invoice and is ignored)",
    async () => {
      expect((await extractTextItems(read(scanned))).length).toBeLessThan(5); // no text layer
      const items = await ocrPdfToTextItems(read(scanned));
      const r = parseCusdec(items, "export", { loose: true });
      expect(r.warnings).toEqual([]);
      expect(r.declaration).toBe("EX");
      expect(r.row.cusdec_no).toBe("E 43210");
      expect(r.row.cusdec_date).toBe("29/09/2026");
      expect(r.row.cusdec_month).toBe("Sep 2026");
      expect(r.row.currency_type).toBe("USD");
      expect(r.row.invoice_value).toBe(5.58);
      expect(r.row.ex_rate).toBe(334.8094);
      expect(r.row.customs_value).toBe(1868);
      expect(r.row.invoice_no).toBe("EXP-1883");
      expect(r.row.party).toMatch(/^Pacific West Foods Australia/i);
      expect(r.row.description).toMatch(/BARRAMUNDI/i);
    },
    180_000,
  );
});
