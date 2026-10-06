/* Regenerates the small upload fixtures used by the parser tests. Run: node tests/fixtures/make-fixtures.cjs */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const dir = __dirname;

function write(name, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  if (name.endsWith(".csv")) fs.writeFileSync(path.join(dir, name), XLSX.utils.sheet_to_csv(wb.Sheets[sheets[0][0]]));
  else XLSX.writeFile(wb, path.join(dir, name));
}

// Excel serial 46113 = 2026-04-01, 46143 = 2026-05-01
// Ledger: title rows before the header, columns out of order, mixed date formats, duplicate invoice, other-month rows.
write("ledger-mixed.xlsx", [
  ["Notes", [["Scratch sheet that must be ignored"]]],
  [
    "Invoice Listing",
    [
      ["Oceanpick (Pvt) Ltd"],
      ["Purchase invoices, VAT control account"],
      [],
      ["Posting Date", "Vendor Name", "Invoice No.", "Amount (LCY)", "External Document No.", "Description", "Source Currency Amount"],
      [46113, "Lusako Holdings (Pvt) Ltd", "PPINV-0005748", 4518, "276783", "Water filter", 4518],
      ["02.04.2026", "Bamber & Bruce (Pvt) Ltd", "PPINV-0005326", "8,923.50", " 41804 ", "Testing", 8923.5],
      ["03/04/2026", "Rent -SLPA", "PPINV-0005024", 10516.43, "26-RNT-000054", "SLPA - RENT", 10516.43],
      ["2026-04-30", "Rent -SLPA", "PPINV-0005024", 0.01, "26-RNT-000054", "SLPA - RENT duplicate", 0.01],
      [46143, "May vendor", "PPINV-0006000", 100, "M1", "Posted in May", 100],
      ["15.03.2026", "March vendor", "PPINV-0004000", 50, "X1", "Posted in March", 50],
      ["", "", "", "", "", "", ""],
      [46120, "", "PPINV-0005999", 1.5, "", "", ""],
    ],
  ],
]);

// Ledger with the "Document No." heading variant and no optional columns, as CSV.
write("ledger-docno.csv", [
  [
    "Sheet1",
    [
      ["Document No.", "Posting Date", "Amount"],
      ["PINV-1", "01/05/2026", "1,000.00"],
      ["PINV-2", "31/05/2026", "2000.555"],
      ["PINV-3", "01/06/2026", "3"],
    ],
  ],
]);

// Schedule with a Month column covering two months, a blank VAT amount, and an Excel-serial invoice date.
write("schedule-multi.xlsx", [
  [
    "IRD Input Schedule",
    [
      ["Local purchases input schedule"],
      ["Month", "Serial No", "Invoice Date", "Tax Invoice No", "Supplier's TIN", "Name of the Supplier", "Description", "Value of purchase", "VAT Amount"],
      ["April 2026", 1, 46113, "INV-A1", "100000000-7000", "Supplier A", "Goods", 1000, 180],
      ["Apr", 2, "05-Apr-2026", "INV-A2", "100000001-7000", "Supplier B", "Services", 2000, ""],
      ["May 2026", 3, "01-May-2026", "INV-M1", "100000002-7000", "Supplier C", "Goods", 500, 90],
      ["April 2026", 4, "06-Apr-2026", "", "", "", "Value but no invoice no", 10, 1.8],
      ["", "", "", "", "", "", "", "", ""],
    ],
  ],
]);

// Schedule without a Month or Serial column, as CSV: all rows belong to the chosen month.
write("schedule-plain.csv", [
  [
    "Sheet1",
    [
      ["Invoice Date", "Tax Invoice No", "Supplier's TIN", "Name of the Supplier", "Description", "Value of purchase", "VAT Amount"],
      ["01.04.2026", "ABC 123", "1-7000", "S1", "D1", "1,000", "180"],
      ["02.04.2026", "ABC124", "2-7000", "S2", "D2", "2000", ""],
    ],
  ],
]);

console.log("fixtures written to", dir);
