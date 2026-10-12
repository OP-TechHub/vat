export type Role = "viewer" | "editor" | "admin";

export interface Company {
  id: string;
  name: string;
}

/** Row of the invoice_claim_status view. */
export interface Invoice {
  id: string;
  company_id: string;
  invoice_no: string;
  posting_date: string; // YYYY-MM-DD
  vendor_name: string | null;
  external_doc_no: string | null;
  description: string | null;
  amount_lcy: number;
  source_amount: number | null;
  original_invoice: "Yes" | "No" | null;
  manual_claim_month: string | null; // YYYY-MM-DD (first of month)
  manual_not_claimed: boolean;
  updated_at: string;
  updated_by: string | null;
  auto_claim_month: string | null; // YYYY-MM-DD
  claim_month: string | null; // YYYY-MM-DD
  claim_status: "Claimed" | "Not Claimed";
}

/** Manual review of a schedule line against the ledger. "none" = not yet reviewed (default). */
export type LedgerAvailability = "none" | "available" | "not_available";

export const LEDGER_AVAILABILITY_LABEL: Record<LedgerAvailability, string> = {
  none: "None",
  available: "Available in ledger",
  not_available: "Not available in ledger",
};

/** Row of the schedule_line_match view. */
export interface ScheduleLine {
  id: string;
  company_id: string;
  return_month: string; // YYYY-MM-DD
  serial_no: string | null;
  invoice_date: string | null;
  tax_invoice_no: string;
  supplier_tin: string | null;
  supplier_name: string | null;
  description: string | null;
  purchase_value: number;
  vat_amount: number;
  created_at: string;
  created_by: string | null;
  ledger_availability: LedgerAvailability;
  ledger_reference: string | null;
  updated_at: string | null;
  updated_by: string | null;
  ledger_invoice_no: string | null;
}

/**
 * Entered cages of the return held on vat_returns, in return order, with the IRD cage code.
 * Cages 7, 9, 13, 14 and the checks are derived (see reports.ts).
 */
export const CAGES = [
  ["taxable_value", "A"],
  ["taxable_tax", "0"],
  ["wholesale_retail", "B/2"],
  ["suspended_supplies", "C/2A"],
  ["output_tax", "3"],
  ["zero_rated", "D"],
  ["zero_rated_services", "D1"],
  ["exempt", "E"],
  ["excluded_supplies", "E1"],
  ["imports_value", "H"],
  ["imports_deferred", "4"],
  ["imports_upfront", "5"],
  ["local_value", "I"],
  ["local_tax", "6"],
  ["suspended_purchases_value", "J"],
  ["suspended_purchases_tax", "K"],
  ["imports_no_vat", "J2"],
  ["disallowed", "8"],
  ["disallowed_suspended", "8A"],
  ["brought_forward", "10"],
  ["allowable_zero_rated", "11"],
  ["not_group_a", "12"],
  ["gross_refund", "15"],
  ["tax_payable", "16"],
  ["monthly_payments", "Q"],
  ["svat_credit", "R2"],
  ["total_credits", "17"],
  ["net_refund_payable", "18"],
] as const;
export type CageField = (typeof CAGES)[number][0];

export interface VatReturn {
  company_id: string;
  return_month: string; // YYYY-MM-DD
  zero_rated: number;
  exempt: number;
  imports_value: number;
  imports_deferred: number;
  imports_upfront: number;
  local_value: number;
  local_tax: number;
  disallowed: number;
  brought_forward: number;
  // Cages added by migration 0006; absent on rows read before it was run.
  taxable_value?: number;
  taxable_tax?: number;
  wholesale_retail?: number;
  suspended_supplies?: number;
  output_tax?: number;
  zero_rated_services?: number;
  excluded_supplies?: number;
  suspended_purchases_value?: number;
  suspended_purchases_tax?: number;
  imports_no_vat?: number;
  disallowed_suspended?: number;
  allowable_zero_rated?: number;
  not_group_a?: number;
  gross_refund?: number;
  tax_payable?: number;
  monthly_payments?: number;
  svat_credit?: number;
  total_credits?: number;
  net_refund_payable?: number;
  ledger_exports: number;
  ledger_local_sales: number;
  ledger_imports: number;
  /** Date of submission per the IRD acknowledgement, YYYY-MM-DD. */
  submitted_on?: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

export type DocumentKind = "return" | "acknowledgement";

/** Row of return_documents: a filed return or IRD acknowledgement held in storage for a period. */
export interface ReturnDocument {
  company_id: string;
  return_month: string; // YYYY-MM-DD
  kind: DocumentKind;
  path: string;
  filename: string;
  uploaded_at: string;
  uploaded_by: string | null;
}

/** Cage figures of one taxable period parsed from the "VAT Return_Upload" workbook, ready to upsert. */
export type ReturnPeriodRow = {
  return_month: string; // YYYY-MM-DD
  submitted_on: string | null;
} & Record<CageField, number>;

export type ReturnField = Exclude<
  keyof VatReturn,
  "company_id" | "return_month" | "submitted_on" | "updated_at" | "updated_by"
>;

export type CurrencyType = "USD" | "EUR";

/** Row of the export_sales table: one export invoice per sales-report month. */
export interface ExportSale {
  id: string;
  company_id: string;
  sales_month: string; // YYYY-MM-DD (first of month)
  invoice_no: string;
  amount_fc: number;
  ex_rate: number | null;
  net_sales: number;
  cusdec_no: string | null;
  cusdec_date: string | null;
  cusdec_month: string | null;
  currency_type: CurrencyType;
  custom_ex_rate: number | null;
  custom_invoice_value: number | null;
  custom_value: number | null;
  short_shipment: number | null;
  sales_reversed: number | null;
  updated_in_custom_report: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** Fields of an export sale that editors may change inline. */
export type ExportEditable = Pick<
  ExportSale,
  | "cusdec_no"
  | "cusdec_date"
  | "cusdec_month"
  | "currency_type"
  | "custom_ex_rate"
  | "custom_invoice_value"
  | "custom_value"
  | "short_shipment"
  | "sales_reversed"
  | "updated_in_custom_report"
>;

/** Parsed export-reconciliation row ready for replace_export_month. Null = not given in the file. */
export interface ExportUploadRow {
  invoice_no: string;
  amount_fc: number;
  ex_rate: number | null;
  net_sales: number;
  cusdec_no: string;
  cusdec_date: string;
  cusdec_month: string;
  currency_type: string;
  custom_ex_rate: number | null;
  custom_invoice_value: number | null;
  custom_value: number | null;
  short_shipment: number | null;
  sales_reversed: number | null;
  updated_in_custom_report: string;
}

/** Parsed ledger row ready for replace_ledger_month. */
export interface LedgerUploadRow {
  invoice_no: string;
  posting_date: string;
  vendor_name: string;
  external_doc_no: string;
  description: string;
  amount_lcy: number;
  source_amount: number;
}

/** Parsed schedule row ready for replace_schedule_month. */
export interface ScheduleUploadRow {
  serial_no: string;
  invoice_date: string;
  tax_invoice_no: string;
  supplier_tin: string;
  supplier_name: string;
  description: string;
  purchase_value: number;
  vat_amount: number;
}
