import type { Db } from "./supabase/schema";
import type {
  Company,
  CustomsEditable,
  CustomsEntry,
  ExportEditable,
  ExportReportEditable,
  ExportSale,
  Invoice,
  IrdStatus,
  ReconDirection,
  ReturnDocument,
  Role,
  ScheduleLine,
  VatReturn,
} from "./types";
import { yearRange } from "./format";
import type { TabPermRow } from "./permissions";

const PAGE = 1000;

/**
 * Read every row of a query in pages of 1,000 (PostgREST's default max-rows) so that
 * tax years with more than 1,000 invoices or schedule lines load completely.
 * `build` must apply a deterministic order so paging is stable.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function loadCompanies(sb: Db): Promise<Company[]> {
  const { data, error } = await sb.from("companies").select("id,name").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The user's role in a company and, for members, their permission rows (one per tab they may open). */
export async function loadAccess(
  sb: Db,
  companyId: string,
  userId: string,
): Promise<{ role: Role | null; perms: TabPermRow[] }> {
  const [member, perms] = await Promise.all([
    sb.from("company_members").select("role").eq("company_id", companyId).eq("user_id", userId).maybeSingle(),
    sb
      .from("company_member_permissions")
      .select("tab,can_upload,can_edit,can_delete")
      .eq("company_id", companyId)
      .eq("user_id", userId),
  ]);
  if (member.error) throw new Error(member.error.message);
  if (perms.error) throw new Error(perms.error.message);
  return { role: (member.data?.role as Role) ?? null, perms: (perms.data ?? []) as TabPermRow[] };
}

/**
 * Invoices posted in the tax year, plus any posted in other years but claimed on one of this
 * year's returns (so "claimed from ledger" per return month is complete). Callers filter by
 * posting month where only the year's own invoices are wanted.
 */
export async function loadInvoices(sb: Db, companyId: string, year: number): Promise<Invoice[]> {
  const { from, to } = yearRange(year);
  const [posted, claimed] = await Promise.all([
    fetchAll<Invoice>((a, b) =>
      sb
        .from("invoice_claim_status")
        .select("*")
        .eq("company_id", companyId)
        .gte("posting_date", from)
        .lte("posting_date", to)
        .order("posting_date")
        .order("invoice_no")
        .range(a, b),
    ),
    fetchAll<Invoice>((a, b) =>
      sb
        .from("invoice_claim_status")
        .select("*")
        .eq("company_id", companyId)
        .gte("claim_month", from)
        .lte("claim_month", to)
        .or(`posting_date.lt.${from},posting_date.gt.${to}`)
        .order("posting_date")
        .order("invoice_no")
        .range(a, b),
    ),
  ]);
  return posted.concat(claimed);
}

export function loadScheduleLines(sb: Db, companyId: string, year: number): Promise<ScheduleLine[]> {
  const { from, to } = yearRange(year);
  return fetchAll<ScheduleLine>((a, b) =>
    sb
      .from("schedule_line_match")
      .select("*")
      .eq("company_id", companyId)
      .gte("return_month", from)
      .lte("return_month", to)
      .order("return_month")
      .order("created_at")
      .order("id")
      .range(a, b),
  );
}

/** Table behind each reconciliation direction. */
export const RECON_TABLE: Record<ReconDirection, string> = { export: "export_sales", import: "import_purchases" };

export function loadExportSales(sb: Db, companyId: string, year: number): Promise<ExportSale[]> {
  return loadRecon(sb, "export", companyId, year);
}

export function loadRecon(sb: Db, direction: ReconDirection, companyId: string, year: number): Promise<ExportSale[]> {
  const { from, to } = yearRange(year);
  return fetchAll<ExportSale>((a, b) =>
    sb
      .from(RECON_TABLE[direction])
      .select("*")
      .eq("company_id", companyId)
      .gte("sales_month", from)
      .lte("sales_month", to)
      .order("sales_month")
      .order("invoice_no")
      .order("id")
      .range(a, b),
  );
}

/** All customs entries of one direction for the company (a few hundred rows a year at most). */
export function loadCustomsEntries(sb: Db, direction: ReconDirection, companyId: string): Promise<CustomsEntry[]> {
  return fetchAll<CustomsEntry>((a, b) =>
    sb
      .from("customs_entries")
      .select("*")
      .eq("company_id", companyId)
      .eq("direction", direction)
      .order("cusdec_no")
      .order("invoice_no")
      .range(a, b),
  );
}

/** Customs entry fields that belong to the declaration, so they are the same on every item line of it. */
export const CUSTOMS_HEADER_FIELDS: readonly (keyof CustomsEditable)[] = [
  "cusdec_no",
  "cusdec_date",
  "cusdec_month",
  "invoice_no",
  "currency_type",
  "ex_rate",
  "invoice_value",
  "party",
  "file_name",
];

/** Message for a failed save, worded for the unique keys of the uploaded tables. */
function saveError(message: string): Error {
  return new Error(
    /duplicate key|unique constraint/i.test(message)
      ? "another row already has that CusDec / invoice / item number."
      : message,
  );
}

/**
 * Correct one field of a stored customs entry. Declaration fields (CUSTOMS_HEADER_FIELDS) are written to
 * every item line of the same CusDec and invoice; item fields to the one line. The export sales / import
 * purchases carrying the invoice number are then re-filled from the customs entries.
 */
export async function updateCustomsEntry(sb: Db, entry: CustomsEntry, patch: Partial<CustomsEditable>): Promise<void> {
  const header = Object.keys(patch).some((k) => CUSTOMS_HEADER_FIELDS.includes(k as keyof CustomsEditable));
  let q = sb.from("customs_entries").update(patch);
  q = header
    ? q
        .eq("company_id", entry.company_id)
        .eq("direction", entry.direction)
        .eq("cusdec_no", entry.cusdec_no)
        .eq("invoice_no", entry.invoice_no)
    : q.eq("id", entry.id);
  const { error } = await q;
  if (error) throw saveError(error.message);
  const { error: e2 } = await sb.rpc("apply_customs", { p_company: entry.company_id, p_direction: entry.direction });
  if (e2) throw new Error("Saved, but the reconciliation could not be refreshed: " + e2.message);
}

/**
 * Correct a field of an export sale / import purchase that came from the uploaded report. A changed invoice
 * number is matched to the customs entries again.
 */
export async function updateReconReport(
  sb: Db,
  direction: ReconDirection,
  row: ExportSale,
  patch: Partial<ExportReportEditable>,
  userId: string,
): Promise<void> {
  const { error } = await sb
    .from(RECON_TABLE[direction])
    .update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw saveError(error.message);
  if ("invoice_no" in patch || "sales_month" in patch) {
    const { error: e2 } = await sb.rpc("apply_customs", {
      p_company: row.company_id,
      p_direction: direction,
      p_month: patch.sales_month ?? row.sales_month,
    });
    if (e2) throw new Error("Saved, but the customs details could not be matched: " + e2.message);
  }
}

/**
 * Add an export sale / import purchase by hand, without uploading the month's report. Customs entries
 * already held for the invoice number are matched to it.
 */
export async function addReconRow(
  sb: Db,
  direction: ReconDirection,
  companyId: string,
  month: string,
  row: Omit<ExportReportEditable, "sales_month"> & { currency_type: string } & Partial<Omit<ExportEditable, "currency_type">>,
  userId: string,
): Promise<void> {
  const { error } = await sb
    .from(RECON_TABLE[direction])
    .insert({ ...row, company_id: companyId, sales_month: month, created_by: userId });
  if (error)
    throw new Error(
      /duplicate key|unique constraint/i.test(error.message)
        ? `invoice ${row.invoice_no} is already in that month.`
        : error.message,
    );
  const { error: e2 } = await sb.rpc("apply_customs", { p_company: companyId, p_direction: direction, p_month: month });
  if (e2) throw new Error("Added, but the customs details could not be matched: " + e2.message);
}

/** Delete one export sale / import purchase. */
export async function deleteReconRow(sb: Db, direction: ReconDirection, id: string): Promise<void> {
  const { error } = await sb.from(RECON_TABLE[direction]).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Re-read one export sale / import purchase after an inline edit. */
export async function reloadRecon(sb: Db, direction: ReconDirection, id: string): Promise<ExportSale> {
  const { data, error } = await sb.from(RECON_TABLE[direction]).select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as ExportSale;
}

export async function loadReturns(sb: Db, companyId: string, year: number): Promise<VatReturn[]> {
  const { from, to } = yearRange(year);
  const { data, error } = await sb
    .from("vat_returns")
    .select("*")
    .eq("company_id", companyId)
    .gte("return_month", from)
    .lte("return_month", to)
    .order("return_month");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface FilingData {
  /** Every return held for the company, any year: month and submission date only. */
  returns: Pick<VatReturn, "return_month" | "submitted_on">[];
  documents: ReturnDocument[];
}

/** Filing register inputs for every period, not limited to the selected tax year. */
export async function loadFiling(sb: Db, companyId: string): Promise<FilingData> {
  const [returns, documents] = await Promise.all([
    fetchAll<Pick<VatReturn, "return_month" | "submitted_on">>((a, b) =>
      sb.from("vat_returns").select("return_month,submitted_on").eq("company_id", companyId).order("return_month").range(a, b),
    ),
    fetchAll<ReturnDocument>((a, b) =>
      sb.from("return_documents").select("*").eq("company_id", companyId).order("return_month").order("kind").range(a, b),
    ),
  ]);
  return { returns, documents };
}

/** Cages of a return shown on the IRD status tab: 4, 5, 6, 8, 8A, 15, Q and 18. */
export type IrdStatusReturn = Pick<
  VatReturn,
  | "return_month"
  | "imports_deferred"
  | "imports_upfront"
  | "local_tax"
  | "disallowed"
  | "disallowed_suspended"
  | "gross_refund"
  | "monthly_payments"
  | "net_refund_payable"
>;

export interface IrdStatusData {
  /** Every return held for the company, limited to the cages the IRD status tab shows. */
  returns: IrdStatusReturn[];
  statuses: IrdStatus[];
  vouchers: ReturnDocument[];
}

/** IRD status inputs for every period, not limited to the selected tax year. */
export async function loadIrdStatus(sb: Db, companyId: string): Promise<IrdStatusData> {
  const [returns, statuses, vouchers] = await Promise.all([
    fetchAll<IrdStatusReturn>((a, b) =>
      sb
        .from("vat_returns")
        .select("return_month,imports_deferred,imports_upfront,local_tax,disallowed,disallowed_suspended,gross_refund,monthly_payments,net_refund_payable")
        .eq("company_id", companyId)
        .order("return_month")
        .range(a, b),
    ),
    fetchAll<IrdStatus>((a, b) => sb.from("ird_status").select("*").eq("company_id", companyId).order("return_month").range(a, b)),
    fetchAll<ReturnDocument>((a, b) =>
      sb
        .from("return_documents")
        .select("*")
        .eq("company_id", companyId)
        .eq("kind", "credit_voucher")
        .order("return_month")
        .range(a, b),
    ),
  ]);
  return { returns, statuses, vouchers };
}

/** Re-read one schedule line from the view after an inline edit so derived fields are fresh. */
export async function reloadScheduleLine(sb: Db, id: string): Promise<ScheduleLine> {
  const { data, error } = await sb.from("schedule_line_match").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as ScheduleLine;
}

/** Re-read one invoice from the view after an inline edit so derived fields are fresh. */
export async function reloadInvoice(sb: Db, id: string): Promise<Invoice> {
  const { data, error } = await sb.from("invoice_claim_status").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as Invoice;
}
