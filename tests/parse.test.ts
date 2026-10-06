import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseLedger, parseSchedule, templateWorkbook, UploadError } from "@/lib/parse";

const root = path.resolve(__dirname, "..");
const read = (p: string) => new Uint8Array(readFileSync(path.join(root, p)));
const headersOf = (wb: XLSX.WorkBook) =>
  XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0];

describe("templates/", () => {
  it("ledger template headings are recognised (no data rows, so the parser reports none)", () => {
    expect(() => parseLedger(read("templates/Ledger invoice list template.xlsx"), "2026-04")).toThrow(
      /No rows for Apr 2026 were found in sheet “Invoice Listing”\./,
    );
  });
  it("schedule template headings are recognised", () => {
    expect(() => parseSchedule(read("templates/IRD input schedule template.xlsx"), "2026-04")).toThrow(
      /No rows for Apr 2026 were found in sheet “IRD Input Schedule”\./,
    );
  });
  it("the downloadable templates match the files in templates/ exactly", () => {
    const led = XLSX.read(read("templates/Ledger invoice list template.xlsx"), { type: "array" });
    const sch = XLSX.read(read("templates/IRD input schedule template.xlsx"), { type: "array" });
    expect(templateWorkbook("ledger").SheetNames).toEqual(led.SheetNames);
    expect(headersOf(templateWorkbook("ledger"))).toEqual(headersOf(led));
    expect(templateWorkbook("schedule").SheetNames).toEqual(sch.SheetNames);
    expect(headersOf(templateWorkbook("schedule"))).toEqual(headersOf(sch));
  });
  it("a file with wrong headings is rejected with a clear message", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Foo", "Bar"], [1, 2]]), "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    expect(() => parseLedger(buf, "2026-04")).toThrow(UploadError);
    expect(() => parseLedger(buf, "2026-04")).toThrow(/Posting Date column heading/);
    expect(() => parseSchedule(buf, "2026-04")).toThrow(/Tax Invoice No column heading/);
  });
});

describe("parseLedger", () => {
  const buf = read("tests/fixtures/ledger-mixed.xlsx");

  it("picks the Invoice Listing sheet, finds the header row and matches columns by heading", () => {
    const p = parseLedger(buf, "2026-04", 3);
    expect(p.sheet).toBe("Invoice Listing");
    expect(p.rows.map((r) => r.invoice_no)).toEqual(["PPINV-0005748", "PPINV-0005326", "PPINV-0005024", "PPINV-0005999"]);
  });

  it("accepts serial, dd.mm.yyyy, dd/mm/yyyy and yyyy-mm-dd dates", () => {
    const p = parseLedger(buf, "2026-04");
    const by = Object.fromEntries(p.rows.map((r) => [r.invoice_no, r]));
    expect(by["PPINV-0005748"].posting_date).toBe("2026-04-01");
    expect(by["PPINV-0005326"].posting_date).toBe("2026-04-02");
    expect(by["PPINV-0005024"].posting_date).toBe("2026-04-03");
    expect(by["PPINV-0005999"].posting_date).toBe("2026-04-08");
  });

  it("sums duplicate invoice numbers and keeps the first row's details", () => {
    const p = parseLedger(buf, "2026-04");
    const dup = p.rows.find((r) => r.invoice_no === "PPINV-0005024")!;
    expect(dup.amount_lcy).toBe(10516.44);
    expect(dup.posting_date).toBe("2026-04-03");
    expect(dup.description).toBe("SLPA - RENT");
  });

  it("keeps only the chosen month, counts the rest as skipped, and ignores blank rows", () => {
    const p = parseLedger(buf, "2026-04", 3);
    expect(p.skipped).toBe(2);
    expect(p.total).toBe(23959.44); // 4518 + 8923.5 + 10516.44 + 1.5, rounded to cents
    expect(p.text).toBe(
      "Sheet “Invoice Listing”: 4 rows for Apr 2026, input VAT 23,959.44. 2 rows outside this month were left out. Saving replaces the 3 rows already held for this month.",
    );
  });

  it("trims text, strips thousands separators and fills optional columns", () => {
    const p = parseLedger(buf, "2026-04");
    const r = p.rows.find((x) => x.invoice_no === "PPINV-0005326")!;
    expect(r.external_doc_no).toBe("41804");
    expect(r.amount_lcy).toBe(8923.5);
    expect(r.source_amount).toBe(8923.5);
    const blank = p.rows.find((x) => x.invoice_no === "PPINV-0005999")!;
    expect(blank.vendor_name).toBe("");
    expect(blank.external_doc_no).toBe("");
    expect(blank.source_amount).toBe(0);
  });

  it("takes May from the same file", () => {
    const p = parseLedger(buf, "2026-05");
    expect(p.rows.map((r) => r.invoice_no)).toEqual(["PPINV-0006000"]);
    expect(p.skipped).toBe(6); // 4 April rows (incl. the duplicate), 1 March row, 1 April row without vendor
  });

  it("reports when nothing matches the month", () => {
    expect(() => parseLedger(buf, "2026-07")).toThrow(/No rows for Jul 2026 .* \(7 rows belong to other months\)\./);
  });

  it("accepts CSV with the Document No. and plain Amount headings", () => {
    const p = parseLedger(read("tests/fixtures/ledger-docno.csv"), "2026-05");
    expect(p.rows).toEqual([
      { invoice_no: "PINV-1", posting_date: "2026-05-01", vendor_name: "", external_doc_no: "", description: "", amount_lcy: 1000, source_amount: 0 },
      { invoice_no: "PINV-2", posting_date: "2026-05-31", vendor_name: "", external_doc_no: "", description: "", amount_lcy: 2000.56, source_amount: 0 },
    ]);
    expect(p.skipped).toBe(1);
  });
});

describe("parseSchedule", () => {
  const buf = read("tests/fixtures/schedule-multi.xlsx");

  it("keeps only the chosen month when the Month column has several months", () => {
    const p = parseSchedule(buf, "2026-04", 0);
    expect(p.sheet).toBe("IRD Input Schedule");
    expect(p.rows.map((r) => r.tax_invoice_no)).toEqual(["INV-A1", "INV-A2"]);
    expect(p.skipped).toBe(2); // the May row and the row with a value but no invoice number
    const m = parseSchedule(buf, "2026-05");
    expect(m.rows.map((r) => r.tax_invoice_no)).toEqual(["INV-M1"]);
  });

  it("uses 18% of the value when VAT Amount is blank", () => {
    const p = parseSchedule(buf, "2026-04");
    expect(p.rows[0].vat_amount).toBe(180);
    expect(p.rows[1].vat_amount).toBe(360);
    expect(p.total).toBe(540);
  });

  it("renders Excel-serial invoice dates as dd.mm.yyyy and keeps text dates as written", () => {
    const p = parseSchedule(buf, "2026-04");
    expect(p.rows[0].invoice_date).toBe("01.04.2026");
    expect(p.rows[1].invoice_date).toBe("05-Apr-2026");
    expect(p.rows[0].serial_no).toBe("1");
    expect(p.rows[0].supplier_tin).toBe("100000000-7000");
    expect(p.rows[0].supplier_name).toBe("Supplier A");
  });

  it("builds the preview text", () => {
    const p = parseSchedule(buf, "2026-04", 40);
    expect(p.text).toBe(
      "Sheet “IRD Input Schedule”: 2 rows for Apr 2026, VAT 540.00. 2 rows outside this month were left out. Saving replaces the 40 rows already held for this month.",
    );
  });

  it("takes every row when there is no Month column, numbering serials when missing", () => {
    const p = parseSchedule(read("tests/fixtures/schedule-plain.csv"), "2026-09");
    expect(p.rows.map((r) => r.serial_no)).toEqual(["1", "2"]);
    expect(p.rows[0].tax_invoice_no).toBe("ABC 123"); // kept as written; matching normalises whitespace in SQL
    expect(p.rows[0].purchase_value).toBe(1000);
    expect(p.rows[0].vat_amount).toBe(180);
    expect(p.rows[1].vat_amount).toBe(360);
    expect(p.skipped).toBe(0);
  });

  it("rejects a month with no rows", () => {
    expect(() => parseSchedule(buf, "2026-06")).toThrow(/No rows for Jun 2026/);
  });
});
