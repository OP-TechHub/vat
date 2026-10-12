import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseExport, parseLedger, parseReturnWorkbook, parseSchedule, templateWorkbook, UploadError } from "@/lib/parse";
import { monthsBetween, periodCode } from "@/lib/format";

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

describe("parseExport", () => {
  // Mirrors the export reconciliation workbook: a group-heading row, then the column headings,
  // invoice rows and a month subtotal row with the month label in the Invoice No column.
  const sheet = (rows: unknown[][], name = "Export Reconciliation") => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["DETAILS IN SALES REPORT", "", "", "", "", "AS PER CUSTOMS", "", "", "", "", "", "", "DIFFERENCES"],
        [
          "Invoice No", "Month", "Amount FC(FOB) USD / EUR", "Ex.rate", "Net Sales (A)",
          "Cusdec No", "Date", "Month", "Currency Type", "Ex. Rate Custom LKR", "Invoice Vale as Per USD / EUR", "Custom Value",
          "Exchange Difference (1)", "Short Shipment (3)", "Sales Reversed in the Month (4)", "Updated in Custom Report",
        ],
        ...rows,
      ]),
      name,
    );
    return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  };
  const buf = sheet([
    ["1715/EXP/OP", "July", 1486.25, 261.56, 388742, 30417, "", "", "USD", 298.7277, 1486.25, 443984, 55241.7, "", "", ""],
    ["1716/EXP/OP", "July", 127.87, 261.56, "", "30588", "12.07.2026", "July", "EUR", 304.1918, "", "", "", 10, "", "Yes"],
    ["1721/EXP/OP", "July", 6916.37, 261.56, 1809040, "", "", "", "", 304.1885, 6916.37, "", "", "", "", ""],
    ["1800/EXP/OP", "August", 100, 300, 30000, "", "", "", "USD", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["July 2026", "", 8530.49, "", 2197782, "", "", "", "", "", "", "############", 55241.7, "", "", ""],
  ]);

  it("picks the export sheet, finds the heading row under the group row and keeps only the chosen month", () => {
    const p = parseExport(buf, "2026-07", 2);
    expect(p.sheet).toBe("Export Reconciliation");
    expect(p.rows.map((r) => r.invoice_no)).toEqual(["1715/EXP/OP", "1716/EXP/OP", "1721/EXP/OP"]);
    expect(p.skipped).toBe(1);
    expect(p.text).toMatch(/3 rows for Jul 2026, net sales 2,231,227\.68/);
    expect(p.text).toMatch(/replaces the 2 rows/);
  });

  it("reads the sales columns and the customs columns, telling the two Month and Ex.rate columns apart", () => {
    const by = Object.fromEntries(parseExport(buf, "2026-07").rows.map((r) => [r.invoice_no, r]));
    expect(by["1715/EXP/OP"]).toMatchObject({
      amount_fc: 1486.25, ex_rate: 261.56, net_sales: 388742, cusdec_no: "30417", currency_type: "USD",
      custom_ex_rate: 298.7277, custom_invoice_value: 1486.25, custom_value: 443984,
    });
    expect(by["1716/EXP/OP"]).toMatchObject({
      cusdec_date: "12.07.2026", cusdec_month: "July", currency_type: "EUR", short_shipment: 10, updated_in_custom_report: "Yes",
    });
  });

  it("fills blank Net Sales from amount x rate and blank Custom Value from invoice value x customs rate", () => {
    const by = Object.fromEntries(parseExport(buf, "2026-07").rows.map((r) => [r.invoice_no, r]));
    expect(by["1716/EXP/OP"].net_sales).toBe(33445.68);
    expect(by["1716/EXP/OP"].custom_value).toBeNull();
    expect(by["1721/EXP/OP"].custom_value).toBe(2103880.22);
    expect(by["1721/EXP/OP"].currency_type).toBe("");
  });

  it("takes the August rows when August is chosen", () => {
    expect(parseExport(buf, "2026-08").rows.map((r) => r.invoice_no)).toEqual(["1800/EXP/OP"]);
  });

  it("accepts a sales report with only the five sales columns", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Invoice No", "Amount FC (FOB)", "Ex.rate", "Net Sales"],
        ["1/EXP", 10, 300, 3000],
        ["2/EXP", 20, 300, ""],
      ]),
      "Sales",
    );
    const p = parseExport(XLSX.write(wb, { type: "array", bookType: "xlsx" }), "2026-07");
    expect(p.rows).toHaveLength(2);
    expect(p.rows[1]).toMatchObject({ net_sales: 6000, cusdec_no: "", custom_ex_rate: null, currency_type: "" });
  });

  it("the export template matches templates/ and is recognised", () => {
    const tpl = XLSX.read(read("templates/Export reconciliation template.xlsx"), { type: "array" });
    expect(templateWorkbook("export").SheetNames).toEqual(tpl.SheetNames);
    expect(headersOf(templateWorkbook("export"))).toEqual(headersOf(tpl));
    expect(() => parseExport(read("templates/Export reconciliation template.xlsx"), "2026-04")).toThrow(
      /No rows for Apr 2026 were found in sheet “Export Reconciliation”\./,
    );
  });
});

describe("parseReturnWorkbook", () => {
  const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Period code", "", "2632", "2631", "2011", "bad"],
      ["Taxable period", "", serial("2026-08-01"), serial("2026-07-01"), serial("2020-01-01"), "n/a"],
      ["Date of submission (per IRD acknowledgement)", "", serial("2026-09-30"), serial("2026-08-31"), "", ""],
      ["Output tax and supplies", "", "", "", "", ""],
      ["Taxable supplies - value", "A", "", "", "", ""],
      ["Zero rated supplies_Goods", "D", 60976633, 146625597, 1295000, 5],
      ["Exempt supplies", "E", 10162699, 9006627, 8894288, ""],
      ["Imports_Value", "H", 72242911, 56954833, 6709438, ""],
      ["Imports_Deferred tax", "4", 12896924, 10196958, "", ""],
      ["Imports_Upfront tax", "5", 106800, 54912, 536755, ""],
      ["Local purchases_Value", "I", 14298989, 12397163, 633558, ""],
      ["Local purchases_Tax", "6", 2573818, 2231489, 50685, ""],
      ["Total (4+5+6)", "7", 15577542, 12483359, 587440, ""],
      ["Disallowable input tax on imports, other purchases and adjustment", "8", 2225349, 722427, 512779, ""],
      ["Brought forward input tax", "10", "", "", "", ""],
    ]),
    "VAT Reconciliation (2)",
  );
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  it("reads one period per column, oldest first, with the submission date and the mapped cages", () => {
    const p = parseReturnWorkbook(buf);
    expect(p.periods.map((r) => r.return_month)).toEqual(["2020-01-01", "2026-07-01", "2026-08-01"]);
    expect(p.periods[2]).toMatchObject({
      submitted_on: "2026-09-30", zero_rated: 60976633, exempt: 10162699, imports_value: 72242911, imports_deferred: 12896924,
      imports_upfront: 106800, local_value: 14298989, local_tax: 2573818, disallowed: 2225349, brought_forward: 0,
    });
    expect(p.periods[0]).toMatchObject({ submitted_on: null, imports_deferred: 0, local_tax: 50685 });
    expect(p.text).toMatch(/3 periods from Jan 2020 to Aug 2026, 2 with a submission date/);
  });

  it("rejects a workbook without the Taxable period row", () => {
    const other = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(other, XLSX.utils.aoa_to_sheet([["Invoice No", "Amount"], [1, 2]]), "Sheet1");
    expect(() => parseReturnWorkbook(XLSX.write(other, { type: "array", bookType: "xlsx" }))).toThrow(/Taxable period/);
  });

  const real = path.join(root, "VAT Return_Upload 1.xlsx");
  it.skipIf(!existsSync(real))("reads the VAT Return_Upload 1.xlsx workbook: 65 periods, Apr 2026 local tax 1,386,009", () => {
    const p = parseReturnWorkbook(read("VAT Return_Upload 1.xlsx"));
    expect(p.periods).toHaveLength(65);
    expect(p.periods[0].return_month).toBe("2020-01-01");
    expect(p.periods[p.periods.length - 1].return_month).toBe("2026-08-01");
    const apr = p.periods.find((r) => r.return_month === "2026-04-01")!;
    expect(apr.local_tax).toBe(1386009);
    expect(apr.submitted_on).toBe("2026-05-31");
  });
});

describe("periodCode / monthsBetween", () => {
  it("YYQM codes match the workbook", () => {
    expect(periodCode("2026-08")).toBe("2632");
    expect(periodCode("2026-07")).toBe("2631");
    expect(periodCode("2020-01")).toBe("2011");
    expect(periodCode("2020-10")).toBe("2041");
    expect(periodCode("2025-12")).toBe("2543");
  });
  it("lists months inclusive across a year end", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
  });
});
