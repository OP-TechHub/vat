/**
 * Documents kept with customs entries, in three slots per declaration: the CusDec itself, the other
 * documents (commercial invoice, packing list, bill of lading...) and the whole bundle. Stored in the
 * private "vat-claims" bucket under <company_id>/customs/<direction>/<cusdec no>/[other/|all/]<filename>
 * and referenced from every item line of the declaration in customs_entries.
 */
import { BUCKET } from "./documents";
import type { Db } from "./supabase/schema";
import type { CustomsEntry, ReconDirection } from "./types";

export type CustomsDocKind = "cusdec" | "other" | "all";

/** The slots in column order, with their headings. */
export const CUSTOMS_DOC_KINDS: { kind: CustomsDocKind; label: string }[] = [
  { kind: "cusdec", label: "CusDec" },
  { kind: "other", label: "Other documents" },
  { kind: "all", label: "All documents" },
];

/** customs_entries columns of each slot. */
const COLS = {
  cusdec: { path: "doc_path", name: "doc_name", at: "doc_uploaded_at", dir: "" },
  other: { path: "other_doc_path", name: "other_doc_name", at: "other_doc_uploaded_at", dir: "other/" },
  all: { path: "all_doc_path", name: "all_doc_name", at: "all_doc_uploaded_at", dir: "all/" },
} as const;

const safe = (s: string) => s.replace(/[^\w.\-()\s]+/g, "_").trim().slice(-120) || "file";

/** Keys that identify one customs entry row. */
export type EntryKey = Pick<CustomsEntry, "company_id" | "direction" | "cusdec_no" | "invoice_no">;

/** The document held in a slot of an entry, if any. */
export function customsDoc(entry: CustomsEntry, kind: CustomsDocKind): { path: string; filename: string } | null {
  const c = COLS[kind];
  const path = entry[c.path];
  return path ? { path, filename: entry[c.name] ?? entry.cusdec_no } : null;
}

/** Upload (or replace) a document of a customs declaration and record it on all its lines. Returns the stored path. */
export async function uploadCustomsDocument(
  sb: Db,
  companyId: string,
  direction: ReconDirection,
  key: Pick<CustomsEntry, "cusdec_no" | "invoice_no">,
  kind: CustomsDocKind,
  file: File,
  previousPath?: string | null,
): Promise<string> {
  const c = COLS[kind];
  const path = `${companyId}/customs/${direction}/${safe(key.cusdec_no)}/${c.dir}${safe(file.name)}`;
  if (previousPath && previousPath !== path) {
    const rm = await sb.storage.from(BUCKET).remove([previousPath]);
    if (rm.error) throw new Error(rm.error.message);
  }
  const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const { error } = await sb
    .from("customs_entries")
    .update({ [c.path]: path, [c.name]: file.name, [c.at]: new Date().toISOString() })
    .match({ company_id: companyId, direction, cusdec_no: key.cusdec_no, invoice_no: key.invoice_no });
  if (error)
    throw new Error(
      error.message +
        (kind !== "cusdec" && /column|schema cache/i.test(error.message)
          ? ". Run supabase/migrations/0012_customs_documents.sql in the Supabase SQL Editor first."
          : ""),
    );
  return path;
}

/** Short-lived link to view a document. */
export async function cusdecDocumentUrl(sb: Db, path: string, seconds = 300): Promise<string> {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "No link returned.");
  return data.signedUrl;
}

/** Remove a document from storage and clear its slot on every item line of that CusDec and invoice. */
export async function removeCustomsDocument(sb: Db, entry: CustomsEntry, kind: CustomsDocKind): Promise<void> {
  const c = COLS[kind];
  const path = entry[c.path];
  if (path) {
    const rm = await sb.storage.from(BUCKET).remove([path]);
    if (rm.error) throw new Error(rm.error.message);
  }
  const { error } = await sb
    .from("customs_entries")
    .update({ [c.path]: null, [c.name]: null, [c.at]: null })
    .match({ company_id: entry.company_id, direction: entry.direction, cusdec_no: entry.cusdec_no, invoice_no: entry.invoice_no });
  if (error) throw new Error(error.message);
}
