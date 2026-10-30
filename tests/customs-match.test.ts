import { describe, expect, it } from "vitest";
import { heldDeclarations, matchReading, type FileReading } from "@/lib/customsMatch";
import type { CustomsEntry } from "@/lib/types";

const entry = (p: Partial<CustomsEntry>): CustomsEntry =>
  ({
    id: Math.random().toString(36),
    company_id: "c",
    direction: "import",
    cusdec_no: "S 11719",
    cusdec_date: "10/07/2026",
    cusdec_month: "Jul 2026",
    invoice_no: "31/EXP/26-27",
    item_no: 1,
    vat_base: null,
    vat_amount: null,
    created_at: "",
    created_by: null,
    ...p,
  }) as CustomsEntry;

const reading = (p: Partial<FileReading>): FileReading => ({
  cusdec_no: null,
  invoice_no: null,
  cusdec_date: null,
  vat_base: null,
  vat_amount: null,
  ...p,
});

const held = heldDeclarations([
  entry({ item_no: 1, vat_base: 2000000, vat_amount: 360000 }),
  entry({ item_no: 2, vat_base: 1208860, vat_amount: 217595 }),
  entry({ cusdec_no: "S 12001", invoice_no: "INV-9", vat_base: 500000, vat_amount: 90000 }),
]);

describe("matching a document file to a held CusDec", () => {
  it("sums a declaration's item lines", () => {
    expect(held).toHaveLength(2);
    expect(held[0].vat_base).toBe(3208860);
    expect(held[0].vat_amount).toBe(577595);
  });

  it("matches on the CusDec number, with or without the office code or spaces", () => {
    expect(matchReading(reading({ cusdec_no: "S11719" }), held)).toMatchObject({ how: "CusDec no", decl: { cusdec_no: "S 11719" } });
    expect(matchReading(reading({ cusdec_no: "CBBD1 S 11719" }), held)?.decl.cusdec_no).toBe("S 11719");
  });

  it("falls back to the invoice number, then the VAT figures read off the tax table", () => {
    expect(matchReading(reading({ invoice_no: "inv-9" }), held)).toMatchObject({ how: "invoice no", decl: { cusdec_no: "S 12001" } });
    expect(matchReading(reading({ vat_amount: 577595.4 }), held)).toMatchObject({ how: "VAT amount", decl: { cusdec_no: "S 11719" } });
    expect(matchReading(reading({ vat_base: 500000 }), held)).toMatchObject({ how: "value for VAT", decl: { cusdec_no: "S 12001" } });
  });

  it("does not guess when nothing or several declarations fit", () => {
    expect(matchReading(reading({ cusdec_no: "S 99999", vat_amount: 1 }), held)).toBeNull();
    const twice = heldDeclarations([entry({ cusdec_no: "A 1", invoice_no: "X" }), entry({ cusdec_no: "B 2", invoice_no: "X" })]);
    expect(matchReading(reading({ invoice_no: "X" }), twice)).toBeNull();
  });
});
