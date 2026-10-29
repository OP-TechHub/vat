-- Keep the CusDec document (PDF or scan) with its customs entry, in the vat-claims bucket under
-- <company_id>/customs/<export|import>/<cusdec no>/<filename>. The bucket and its policies come from 0005.
set search_path = vat_claims, public;

alter table customs_entries
  add column if not exists doc_path text,
  add column if not exists doc_name text,
  add column if not exists doc_uploaded_at timestamptz;

notify pgrst, 'reload schema';
