/**
 * Filed return and IRD acknowledgement documents, one of each per period, kept in the private
 * "vat-claims" storage bucket under <company_id>/<YYYY-MM>/<kind>/<filename> and listed in
 * return_documents. Storage policies follow the tab permissions (migration 0014): a new document needs
 * upload, replacing or removing one needs delete. Files are never overwritten or deleted by the app.
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

/**
 * Storage name for an uploaded file: unique per upload, so a replaced or removed file is never overwritten
 * and stays available to the change log's undo until housekeeping deletes it 30 days later.
 */
export function storedName(file: File): string {
  const safe = file.name.replace(/[^\w.\-()\s]+/g, "_").trim().slice(-120) || "file";
  return `${Date.now()}_${safe}`;
}

/**
 * Upload (or replace) a period's document and record it. The file previously held stays in storage
 * (migration 0015 archives it); replacing the register row needs delete permission.
 */
export async function uploadDocument(
  sb: Db,
  companyId: string,
  userId: string,
  month: string,
  kind: DocumentKind,
  file: File,
): Promise<ReturnDocument> {
  const path = `${companyId}/${month}/${kind}/${storedName(file)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
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

/**
 * Remove a document from the register. The file stays in storage for 30 days so the removal can be
 * undone from the change log; housekeeping deletes it after that.
 */
export async function removeDocument(sb: Db, doc: ReturnDocument): Promise<void> {
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
