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
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ item_no: 1, hs_code: "03049900.00", uom: "KGM", quantity: 14395, customs_value: 42116552, cid_amount: null });
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
      vat_base: 1248046 + 1213760,
      vat_amount: 224649 + 218477,
      party: "C.R.I PUMPS PRIVATE LIMITED",
    });
    expect(r.row.description).toMatch(/^C\.R\.I SUBMERSIBLE PUMPS/);
    // One line per item, each with its own box 46 value and tax table; the header fields repeat.
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      item_no: 1, hs_code: "84137099.00", uom: "NIU", quantity: 20, customs_value: 1062166, cusdec_no: "S 15820", invoice_no: "3RA9001013", ex_rate: 336.1284,
      cid_amount: 0, cid_code: "0", pal_amount: 79663, pal_code: "1", sscl_amount: 31202, sscl_code: "0", vat_base: 1248046, vat_amount: 224649, vat_type: "VTD", vat_code: "2",
    });
    expect(r.items[1]).toMatchObject({ item_no: 2, hs_code: "85011090.00", quantity: 20, customs_value: 1055443, pal_amount: 52773, vat_base: 1213760, vat_amount: 218477 });
    expect(r.items[1].description).toMatch(/^C\.R\.I SUBMERSIBLE MOTORS/);
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
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/reference number not found/);
    expect(r.warnings.join(" ")).toMatch(/Invoice number not found/);
  });
});
