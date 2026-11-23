import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { invoiceTotals, isChargeLine, parseSalesFile } from "../lib/sales";

const csv = (rows: (string | number)[][]) => new TextEncoder().encode(rows.map((r) => r.join(",")).join("\n"));

describe("parseSalesFile", () => {
  it("groups Business Central export lines into invoices and leaves charges out of FOB", () => {
    const p = parseSalesFile(
      csv([
        ["Sales Invoice Lines"],
        ["Document No.", "Posting Date", "Sell-to Customer Name", "Type", "No.", "Description", "Quantity", "Unit of Measure", "Unit Price", "Currency Code", "Amount", "Amount (LCY)"],
        ["EXP-1717", "02/07/2025", "Velaa", "Item", "EXPORT025", "Fresh Barramundi Whole Gilled & Gutted", 10.1, "KG", 7.6, "USD", 76.76, 22994.23],
        ["EXP-1717", "02/07/2025", "Velaa", "Item", "EXPORT025", "Fresh Barramundi Whole Gilled & Gutted", 50.2, "KG", 7.6, "USD", 381.52, 114288.13],
        ["EXP-1717", "02/07/2025", "Velaa", "G/L Account", "SE0031", "Freight Charges", 1, "NOS", 144.72, "USD", 144.72, 43352.32],
        ["EXP-1720", "05/07/2025", "Other", "Item", "EXPORT040", "Skin-on Fillets", 100, "LBS", 5, "USD", 500, ""],
        ["Total", "", "", "", "", "", "", "", "", "", 1103, ""],
      ]),
      "Export",
    );
    expect(p.invoices).toHaveLength(2);
    expect(p.skipped).toBe(1);
    const a = p.invoices[0];
    expect(a).toMatchObject({ invoice_no: "EXP-1717", invoice_date: "2025-07-02", customer: "Velaa", currency: "USD" });
    expect(a.lines.map((l) => l.is_charge)).toEqual([false, false, true]);
    expect(invoiceTotals(a.lines)).toEqual({ amount_fc: 603, amount_lkr: 180634.68, fob_fc: 458.28, fob_lkr: 137282.36 });
    expect(p.invoices[1].lines[0]).toMatchObject({ qty: 45.4, uom: "KG", qty_in: 100, uom_in: "LBS" });
    expect(p.warnings).toHaveLength(1); // EXP-1720: no LKR amount and no rate
  });

  it("reads a local list: one LKR amount column, other markets skipped", () => {
    const p = parseSalesFile(
      csv([
        ["Invoice No", "Date", "Customer", "Item No", "Description", "Quantity", "Amount", "Market"],
        ["LS-1", "2026-03-01", "Keells", "L001", "Barramundi fillet", 12.5, 25000, "Local"],
        ["EX-9", "2026-03-01", "Abroad", "E001", "Barramundi fillet", 3, 900, "Export"],
      ]),
      "Local",
    );
    expect(p.invoices).toHaveLength(1);
    expect(p.skipped).toBe(1);
    expect(p.invoices[0].currency).toBe("LKR");
    expect(p.invoices[0].lines[0].amount_lkr).toBe(25000);
  });

  it("finds a header below a title, reads Excel dates, pounds and the exchange rate", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["report"],
      [],
      ["Invoice No", "Posting Date", "Item No", "Description", "Net Wt (lbs)", "Line Amount", "Exchange Rate"],
      ["I1", 45840, "C1", "Fillet", 10, 50, 300],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lines");
    const p = parseSalesFile(XLSX.write(wb, { type: "array", bookType: "xlsx" }), "Export");
    expect(p.invoices[0].invoice_date).toBe("2025-07-02");
    expect(p.invoices[0].lines[0]).toMatchObject({ qty: 4.54, amount_lkr: 15000 });
  });
});

describe("isChargeLine", () => {
  it("flags charges by line type, service code or description", () => {
    expect(isChargeLine("EXPORT025", "Fresh Barramundi")).toBe(false);
    expect(isChargeLine("X1", "Insurance")).toBe(true);
    expect(isChargeLine("SE0031", "Anything")).toBe(true);
    expect(isChargeLine("A1", "Barramundi", "G/L Account")).toBe(true);
    expect(isChargeLine("A1", "Barramundi", "Item")).toBe(false);
  });
});
