/**
 * Filed return and IRD acknowledgement documents, one of each per period, kept in the private
 * "vat-claims" storage bucket under <company_id>/<YYYY-MM>/<kind>/<filename> and listed in
 * return_documents. Storage policies mirror the company roles (migration 0005).
 */
import type { Db } from "./supabase/schema";
import type { DocumentKind, ReturnDocument } from "./types";

export const BUCKET = "vat-claims";
/** Kinds handled by the return / acknowledgement screens; the credit voucher lives on the IRD status tab. */
export const DOC_KINDS: DocumentKind[] = ["return", "acknowledgement"];
export const DOC_LABEL: Record<DocumentKind, string> = {
  return: "VAT return",
  acknowledgement: "Return acknowledgement",
  credit_voucher: "Credit voucher",
};
export const DOC_ACCEPT = ".pdf,.jpg,.jpeg,.png";

/** Documents of one period ("YYYY-MM"). */
export async function loadMonthDocuments(sb: Db, companyId: string, month: string): Promise<ReturnDocument[]> {
  const { data, error } = await sb
    .from("return_documents")
    .select("*")
    .eq("company_id", companyId)
    .eq("return_month", month + "-01")
    .order("kind");
  if (error) throw new Error(error.message);
  return (data ?? []) as ReturnDocument[];
}

/** Upload (or replace) a period's document and record it. */
export async function uploadDocument(
  sb: Db,
  companyId: string,
  userId: string,
  month: string,
  kind: DocumentKind,
  file: File,
  existing?: ReturnDocument | null,
): Promise<ReturnDocument> {
  const safe = file.name.replace(/[^\w.\-()\s]+/g, "_").slice(-120);
  const path = `${companyId}/${month}/${kind}/${safe}`;
  if (existing && existing.path !== path) {
    const rm = await sb.storage.from(BUCKET).remove([existing.path]);
    if (rm.error) throw new Error(rm.error.message);
  }
  const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const row: ReturnDocument = {
    company_id: companyId,
    return_month: month + "-01",
    kind,
    path,
    filename: file.name,
    uploaded_at: new Date().toISOString(),
    uploaded_by: userId,
  };
  const { error } = await sb.from("return_documents").upsert(row, { onConflict: "company_id,return_month,kind" });
  if (error) throw new Error(error.message);
  return row;
}

/** Short-lived link to view or download a document. */
export async function documentUrl(sb: Db, doc: ReturnDocument, seconds = 300): Promise<string> {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.path, seconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "No link returned.");
  return data.signedUrl;
}

/** Delete a document from storage and from the register. */
export async function removeDocument(sb: Db, doc: ReturnDocument): Promise<void> {
  const rm = await sb.storage.from(BUCKET).remove([doc.path]);
  if (rm.error) throw new Error(rm.error.message);
  const { error } = await sb
    .from("return_documents")
    .delete()
    .eq("company_id", doc.company_id)
    .eq("return_month", doc.return_month)
    .eq("kind", doc.kind);
  if (error) throw new Error(error.message);
}

/** True for PostgREST's "table not found" errors, i.e. an unapplied migration. */
export const isMissingTable = (e: unknown) =>
  e instanceof Error && /schema cache|does not exist|relation .* not found/i.test(e.message);
