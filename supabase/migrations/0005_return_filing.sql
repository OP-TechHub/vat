-- Return filing register: every taxable period from Jan 2020 with
--   Data uploaded            = a vat_returns row exists for the period (loaded from the "VAT Return_Upload" workbook
--                              or entered on the VAT reconciliation tab)
--   Return uploaded          = the filed return document is held for the period
--   Acknowledgement uploaded = the IRD acknowledgement document is held for the period
-- Documents live in the private storage bucket "vat-claims" under <company_id>/<YYYY-MM>/<kind>/<filename>.
set search_path = vat_claims, public;

-- Date of submission per the IRD acknowledgement (row 3 of the workbook).
alter table vat_returns add column if not exists submitted_on date;

create table return_documents (
  company_id uuid not null references companies(id) on delete cascade,
  return_month date not null,                      -- first day of the taxable period
  kind text not null check (kind in ('return','acknowledgement')),
  path text not null,                              -- object path in the vat-claims bucket
  filename text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id),
  primary key (company_id, return_month, kind)
);

alter table return_documents enable row level security;
create policy return_documents_read on return_documents for select using (member_role(company_id) is not null);
create policy return_documents_write on return_documents for all
  using (member_role(company_id) in ('editor','admin')) with check (member_role(company_id) in ('editor','admin'));
grant all on return_documents to anon, authenticated, service_role;

-- Company that owns a storage object, from the first folder of its path. Null when the path is not ours,
-- so the storage policies below never raise on objects in other buckets.
create or replace function doc_company(p_name text) returns uuid
language sql stable as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (storage.foldername(p_name))[1]::uuid
  end
$$;
grant execute on function doc_company(text) to anon, authenticated, service_role;

-- Private bucket: 25 MB per file, PDF or image.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vat-claims', 'vat-claims', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Members may read their company's documents; editors and admins may add, replace and remove them.
create policy vat_claims_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'vat-claims' and vat_claims.member_role(vat_claims.doc_company(name)) is not null);
create policy vat_claims_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vat-claims' and vat_claims.member_role(vat_claims.doc_company(name)) in ('editor', 'admin'));
create policy vat_claims_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'vat-claims' and vat_claims.member_role(vat_claims.doc_company(name)) in ('editor', 'admin'))
  with check (bucket_id = 'vat-claims' and vat_claims.member_role(vat_claims.doc_company(name)) in ('editor', 'admin'));
create policy vat_claims_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vat-claims' and vat_claims.member_role(vat_claims.doc_company(name)) in ('editor', 'admin'));
