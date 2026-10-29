/**
 * CusDec documents kept with customs entries: stored in the private "vat-claims" bucket under
 * <company_id>/customs/<direction>/<cusdec no>/<filename> and referenced from customs_entries.
 */
import { BUCKET } from "./documents";
import type { Db } from "./supabase/schema";
import type { CustomsEntry, ReconDirection } from "./types";

const safe = (s: string) => s.replace(/[^\w.\-()\s]+/g, "_").trim().slice(-120) || "file";

/** Keys that identify one customs entry row. */
export type EntryKey = Pick<CustomsEntry, "company_id" | "direction" | "cusdec_no" | "invoice_no">;

/** Upload (or replace) the document of a customs entry and record it. Returns the stored path. */
export async function uploadCusdecDocument(
  sb: Db,
  companyId: string,
  direction: ReconDirection,
  key: Pick<CustomsEntry, "cusdec_no" | "invoice_no">,
  file: File,
  previousPath?: string | null,
): Promise<string> {
  const path = `${companyId}/customs/${direction}/${safe(key.cusdec_no)}/${safe(file.name)}`;
  if (previousPath && previousPath !== path) {
    const rm = await sb.storage.from(BUCKET).remove([previousPath]);
    if (rm.error) throw new Error(rm.error.message);
  }
  const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const { error } = await sb
    .from("customs_entries")
    .update({ doc_path: path, doc_name: file.name, doc_uploaded_at: new Date().toISOString() })
    .match({ company_id: companyId, direction, cusdec_no: key.cusdec_no, invoice_no: key.invoice_no });
  if (error) throw new Error(error.message);
  return path;
}

/** Short-lived link to view the document. */
export async function cusdecDocumentUrl(sb: Db, path: string, seconds = 300): Promise<string> {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "No link returned.");
  return data.signedUrl;
}

/** Remove the document from storage and clear it on every item line of that CusDec and invoice. */
export async function removeCusdecDocument(sb: Db, entry: CustomsEntry): Promise<void> {
  if (entry.doc_path) {
    const rm = await sb.storage.from(BUCKET).remove([entry.doc_path]);
    if (rm.error) throw new Error(rm.error.message);
  }
  const { error } = await sb
    .from("customs_entries")
    .update({ doc_path: null, doc_name: null, doc_uploaded_at: null })
    .match({ company_id: entry.company_id, direction: entry.direction, cusdec_no: entry.cusdec_no, invoice_no: entry.invoice_no });
  if (error) throw new Error(error.message);
}
