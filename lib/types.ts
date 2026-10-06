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
  ledger_invoice_no: string | null;
}

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
  ledger_exports: number;
  ledger_local_sales: number;
  ledger_imports: number;
  updated_at?: string;
  updated_by?: string | null;
}

export type ReturnField = Exclude<keyof VatReturn, "company_id" | "return_month" | "updated_at" | "updated_by">;

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
