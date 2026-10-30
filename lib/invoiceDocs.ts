/**
 * The invoice document of a ledger invoice on the Invoice listing tab (migration 0017), kept in the private
 * "vat-claims" bucket under <company_id>/invoices/<invoice no>/<timestamp>_<filename>. Attaching needs upload
 * permission on the tab; replacing or removing needs delete. A replaced or removed file stays in storage for
 * 30 days so the change log can undo it.
 */
import { BUCKET, storedName } from "./documents";
import type { Db } from "./supabase/schema";
import type { Invoice } from "./types";

const safe = (s: string) => s.replace(/[^\w.\-()\s]+/g, "_").trim().slice(-120) || "invoice";

/** The document attached to an invoice, if any. */
export function invoiceDoc(inv: Invoice): { path: string; filename: string } | null {
  return inv.doc_path ? { path: inv.doc_path, filename: inv.doc_name ?? inv.invoice_no } : null;
}

/** Upload (or replace) an invoice's document and record it on the invoice. */
export async function uploadInvoiceDocument(sb: Db, inv: Invoice, file: File): Promise<void> {
  const path = `${inv.company_id}/invoices/${safe(inv.invoice_no)}/${storedName(file)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const { error } = await sb.rpc("set_invoice_document", { p_invoice: inv.id, p_path: path, p_name: file.name });
  if (error)
    throw new Error(
      error.message +
        (/function|schema cache/i.test(error.message)
          ? ". Run supabase/migrations/0017_invoice_documents.sql in the Supabase SQL Editor first."
          : ""),
    );
}

/** Take the document off an invoice. The file is kept 30 days for the change log's undo. */
export async function removeInvoiceDocument(sb: Db, inv: Invoice): Promise<void> {
  const { error } = await sb.rpc("set_invoice_document", { p_invoice: inv.id, p_path: null, p_name: null });
  if (error) throw new Error(error.message);
}

/** Short-lived link to view the document. */
export async function invoiceDocumentUrl(sb: Db, path: string, seconds = 300): Promise<string> {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "No link returned.");
  return data.signedUrl;
}
