/**
 * Survey: run every CusDec in custom/export and custom/import through the reader (text layer or
 * OCR) and print what came out, so new samples can be checked at a glance. Skipped when the folder
 * is absent. Asserts only that each form yields a reference, an amount and a rate.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractTextItems } from "@/lib/pdfText";
import { ocrPdfToTextItems } from "@/lib/ocr";
import { parseCusdec } from "@/lib/cusdec";
import type { ReconDirection } from "@/lib/types";

const root = path.resolve(__dirname, "..", "custom");

for (const direction of ["export", "import"] as ReconDirection[]) {
  const dir = path.join(root, direction);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.pdf$/i.test(f)) : [];
  describe.skipIf(!files.length)(`CusDec survey: ${direction} (${files.length} files)`, () => {
    for (const f of files) {
      it(
        f,
        async () => {
          const buf = new Uint8Array(readFileSync(path.join(dir, f)));
          let items = await extractTextItems(buf);
          const scanned = items.length < 20;
          if (scanned) items = await ocrPdfToTextItems(buf);
          const r = parseCusdec(items, direction, { loose: scanned });
          const row = r.row;
          console.log(
            [
              `${direction} | ${f}${scanned ? " [OCR]" : ""}`,
              `  ${r.declaration} ${row.cusdec_no} ${row.cusdec_date} | inv ${row.invoice_no} | ${row.currency_type} ${row.invoice_value} @ ${row.ex_rate} = ${row.customs_value}` +
                (direction === "import" ? ` | VAT ${row.vat_amount}` : ""),
              `  ${row.party} | ${row.description}`,
              ...r.warnings.map((w) => `  ! ${w}`),
            ].join("\n"),
          );
          expect(row.cusdec_no).not.toBe("");
          expect(row.invoice_value).not.toBeNull();
          expect(row.ex_rate).not.toBeNull();
        },
        300_000,
      );
    }
  });
}
