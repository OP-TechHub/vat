/** Excel export: Invoice Listing, IRD Submitted Input, VAT Returns. Ported from the prototype. */
import * as XLSX from "xlsx";
import { mLabel, monthsOf, yearLabel } from "./format";
import { RETURN_FIELDS, cm, isClaimed, pm, rm } from "./reports";
import { LEDGER_AVAILABILITY_LABEL, type Invoice, type ReturnField, type ScheduleLine, type VatReturn } from "./types";

export function exportWorkbook(
  year: number,
  invoices: Invoice[],
  schedule: ScheduleLine[],
  returns: VatReturn[],
): { wb: XLSX.WorkBook; filename: string } {
  const months = monthsOf(year);
  const wb = XLSX.utils.book_new();

  const inv = invoices
    .filter((r) => months.includes(pm(r)))
    .map((r) => ({
      "Invoice No.": r.invoice_no,
      "Posting Date": r.posting_date,
      "Vendor Name": r.vendor_name ?? "",
      "External Document No.": r.external_doc_no ?? "",
      Description: r.description ?? "",
      "Amount (LCY)": r.amount_lcy,
      "Original VAT Invoice": r.original_invoice ?? "",
      "Claimed Status": isClaimed(r) ? "Claimed" : "Not Claimed",
      "Claim Month": mLabel(cm(r)),
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inv), "Invoice Listing");

  const sr: Record<string, string | number>[] = [];
  for (const k of months)
    for (const r of schedule.filter((x) => rm(x) === k))
      sr.push({
        Month: mLabel(k),
        "Serial No": r.serial_no ?? "",
        "Invoice Date": r.invoice_date ?? "",
        "Tax Invoice No": r.tax_invoice_no,
        "Supplier's TIN": r.supplier_tin ?? "",
        "Name of the Supplier": r.supplier_name ?? "",
        Description: r.description ?? "",
        "Value of purchase": r.purchase_value,
        "VAT Amount": r.vat_amount,
        "Ledger Invoice": r.ledger_invoice_no ?? "",
        "Ledger Availability": LEDGER_AVAILABILITY_LABEL[r.ledger_availability ?? "none"],
        "Ledger Reference": r.ledger_reference ?? "",
      });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sr), "IRD Submitted Input");

  const rr = months
    .map((k) => returns.find((r) => rm(r) === k))
    .filter((r): r is VatReturn => !!r)
    .map((r) => {
      const o: Record<string, string | number> = { Month: mLabel(rm(r)) };
      for (const [id, label] of RETURN_FIELDS) if (id !== "sec") o[label] = +r[id as ReturnField] || 0;
      return o;
    });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rr), "VAT Returns");

  return { wb, filename: `VAT input claims ${yearLabel(year).replace("/", "-")}.xlsx` };
}
