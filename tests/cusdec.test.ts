import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractTextItems } from "@/lib/pdfText";
import { parseCusdec } from "@/lib/cusdec";

const root = path.resolve(__dirname, "..");
const exportPdf = path.join(root, "custom", "export", "EXP 1844 CUSDEC.pdf");
const importPdf = path.join(root, "custom", "import", "PDF_26642512247877634441.pdf");
const read = (p: string) => new Uint8Array(readFileSync(p));

describe("CusDec PDF extraction", () => {
  it.skipIf(!existsSync(exportPdf))("reads the export CusDec EXP 1844", async () => {
    const items = await extractTextItems(read(exportPdf));
    const r = parseCusdec(items, "export");
    expect(r.declaration).toBe("EX");
    expect(r.row).toMatchObject({
      cusdec_no: "E 60883",
      cusdec_date: "25/09/2026",
      cusdec_month: "Sep 2026",
      invoice_no: "EXP-1844",
      currency_type: "USD",
      ex_rate: 336.1284,
      invoice_value: 125299,
      customs_value: 42116552,
      vat_amount: null,
      party: "PACIFIC WEST FOODS AUSTRALIA PTY LTD",
    });
    expect(r.row.description).toMatch(/^BARRAMUNDI PORTIONS/);
    expect(r.warnings).toEqual([]);
  });

  it.skipIf(!existsSync(importPdf))("reads the two-page import CusDec S 15820, summing the items", async () => {
    const items = await extractTextItems(read(importPdf));
    const r = parseCusdec(items, "import");
    expect(r.declaration).toBe("IM");
    expect(r.row).toMatchObject({
      cusdec_no: "S 15820",
      cusdec_date: "24/09/2026",
      cusdec_month: "Sep 2026",
      currency_type: "USD",
      ex_rate: 336.1284,
      invoice_value: 6300,
      customs_value: 1062166 + 1055443,
      vat_amount: 224649 + 218477,
      party: "C.R.I PUMPS PRIVATE LIMITED",
    });
    expect(r.row.description).toMatch(/^C\.R\.I SUBMERSIBLE PUMPS/);
    // No "INV NO" on this form: the box 44 reference is offered with a warning to check it.
    expect(r.row.invoice_no).toBe("3RA9001013");
    expect(r.warnings.some((w) => /box 44/.test(w))).toBe(true);
  });

  it.skipIf(!existsSync(exportPdf))("warns when a declaration is uploaded under the wrong direction", async () => {
    const r = parseCusdec(await extractTextItems(read(exportPdf)), "import");
    expect(r.warnings.some((w) => /export declaration/.test(w))).toBe(true);
    expect(r.row.vat_amount).toBeNull();
  });

  it("reports what is missing on a form it cannot read", () => {
    const r = parseCusdec([{ page: 1, x: 0, y: 0, w: 10, s: "Hello" }], "export");
    expect(r.row.cusdec_no).toBe("");
    expect(r.warnings.join(" ")).toMatch(/reference number not found/);
    expect(r.warnings.join(" ")).toMatch(/Invoice number not found/);
  });
});
