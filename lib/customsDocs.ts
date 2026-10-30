/**
 * Documents kept with customs entries, in four slots per declaration: the CusDec itself, the commercial
 * invoice, the other documents (packing list, bill of lading...) and the whole bundle. Stored in the
 * private "vat-claims" bucket under <company_id>/customs/<direction>/<cusdec no>/[invoice/|other/|all/]<filename>
 * and referenced from every item line of the declaration in customs_entries.
 */
import { BUCKET, storedName } from "./documents";
import type { Db } from "./supabase/schema";
import type { CustomsEntry, ReconDirection } from "./types";

export type CustomsDocKind = "cusdec" | "invoice" | "other" | "all";

/** The slots in column order, with their headings. */
export const CUSTOMS_DOC_KINDS: { kind: CustomsDocKind; label: string }[] = [
  { kind: "cusdec", label: "CusDec" },
  { kind: "invoice", label: "Commercial Invoice" },
  { kind: "other", label: "Other documents" },
  { kind: "all", label: "All documents" },
];

/** customs_entries columns of each slot. */
const COLS = {
  cusdec: { path: "doc_path", name: "doc_name", dir: "" },
  invoice: { path: "invoice_doc_path", name: "invoice_doc_name", dir: "invoice/" },
  other: { path: "other_doc_path", name: "other_doc_name", dir: "other/" },
  all: { path: "all_doc_path", name: "all_doc_name", dir: "all/" },
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

/**
 * Upload (or replace) a document of a customs declaration and record it on all its lines. Returns the stored
 * path. The file held before stays in storage (archived for the change log's undo); the database decides
 * whether the user may fill the slot (upload) or replace what it holds (delete).
 */
export async function uploadCustomsDocument(
  sb: Db,
  companyId: string,
  direction: ReconDirection,
  key: Pick<CustomsEntry, "cusdec_no" | "invoice_no">,
  kind: CustomsDocKind,
  file: File,
): Promise<string> {
  const path = `${companyId}/customs/${direction}/${safe(key.cusdec_no)}/${COLS[kind].dir}${storedName(file)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const { error } = await sb.rpc("set_customs_document", {
    p_company: companyId,
    p_direction: direction,
    p_cusdec_no: key.cusdec_no,
    p_invoice_no: key.invoice_no,
    p_kind: kind,
    p_path: path,
    p_name: file.name,
  });
  if (error)
    throw new Error(
      error.message +
        (/function|schema cache/i.test(error.message)
          ? ". Run supabase/migrations/0016_commercial_invoice_document.sql in the Supabase SQL Editor first."
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

/**
 * Clear a document slot on every item line of that CusDec and invoice. The file stays in storage for 30 days
 * so the removal can be undone from the change log.
 */
export async function removeCustomsDocument(sb: Db, entry: CustomsEntry, kind: CustomsDocKind): Promise<void> {
  const { error } = await sb.rpc("set_customs_document", {
    p_company: entry.company_id,
    p_direction: entry.direction,
    p_cusdec_no: entry.cusdec_no,
    p_invoice_no: entry.invoice_no,
    p_kind: kind,
    p_path: null,
    p_name: null,
  });
  if (error) throw new Error(error.message);
}
