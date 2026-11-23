/** Writes used by the TIEP invoice screens (RLS: TIEP Exports / Local Sales edit). */
import type { Db } from "../supabase/schema";
import { BUCKET } from "../documents";
import type { DocRef, InvoiceExt, Mud } from "./invoices";

/** Update an invoice's TIEP fields, creating the row on first use. */
export async function saveInvoiceExt(sb: Db, companyId: string, userId: string, invoiceId: string, patch: Partial<InvoiceExt>) {
  const { error } = await sb.from("tiep_invoice_ext").upsert(
    { sales_invoice_id: invoiceId, company_id: companyId, ...patch, updated_at: new Date().toISOString(), updated_by: userId },
    { onConflict: "sales_invoice_id" },
  );
  if (error) throw new Error(error.message);
}

/** The MUD row of an invoice, created (as a draft) when it does not exist yet. */
export async function ensureInvoiceMud(sb: Db, companyId: string, userId: string, invoiceId: string, type: "Export" | "Local", existing?: Mud) {
  if (existing) return existing.id;
  const { data, error } = await sb
    .from("tiep_muds")
    .upsert({ company_id: companyId, kind: "invoice", type, sales_invoice_id: invoiceId, created_by: userId }, { onConflict: "sales_invoice_id" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateMud(sb: Db, userId: string, mudId: string, patch: Partial<Mud>) {
  const { error } = await sb
    .from("tiep_muds")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", mudId);
  if (error) throw new Error(error.message);
}

const ACCEPT = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

/** Upload a document (PDF or image) under <company>/tiep/<folder>/<owner>/. */
export async function uploadTiepDoc(sb: Db, companyId: string, folder: "invoices" | "muds" | "documents", owner: string, kind: string, file: File): Promise<DocRef> {
  const type = file.type && ACCEPT.test(file.type) ? file.type : /\.pdf$/i.test(file.name) ? "application/pdf" : /\.png$/i.test(file.name) ? "image/png" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "";
  if (!type) throw new Error("Attach a PDF or an image (PNG / JPG).");
  const safe = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${companyId}/tiep/${folder}/${owner}/${kind}-${Date.now()}-${safe}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  return { path, name: file.name, size: file.size, at: new Date().toISOString() };
}

/** Open a stored document in a new tab (signed link, 5 minutes). */
export async function openTiepDoc(sb: Db, path: string) {
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data) {
    w?.close();
    throw new Error(error?.message ?? "Could not open the document.");
  }
  if (w) w.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
