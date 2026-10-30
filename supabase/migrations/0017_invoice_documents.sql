-- The invoice document (PDF or scan) of each ledger invoice on the Invoice listing tab. Files live in the
-- vat-claims bucket under <company_id>/invoices/<invoice no>/<timestamp>_<filename>. Attaching needs upload
-- on the Invoice listing tab; replacing or removing needs delete. Like the other documents, a removed or
-- replaced file is archived for 30 days (migration 0015) so the change log can undo it.
set search_path = vat_claims, public;

alter table ledger_invoices
  add column if not exists doc_path text,
  add column if not exists doc_name text,
  add column if not exists doc_uploaded_at timestamptz;

-- As in 0001, keeping the invoice document of every invoice that is uploaded again.
create or replace function replace_ledger_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
  create temp table _keep on commit drop as
    select invoice_no, original_invoice, manual_claim_month, manual_not_claimed, doc_path, doc_name, doc_uploaded_at
    from ledger_invoices
    where company_id = p_company and date_trunc('month', posting_date) = date_trunc('month', p_month);
  delete from ledger_invoices
    where company_id = p_company and date_trunc('month', posting_date) = date_trunc('month', p_month);
  insert into ledger_invoices (company_id, invoice_no, posting_date, vendor_name, external_doc_no, description,
                               amount_lcy, source_amount, original_invoice, manual_claim_month, manual_not_claimed,
                               doc_path, doc_name, doc_uploaded_at, updated_by)
  select p_company, r.invoice_no, r.posting_date, r.vendor_name, r.external_doc_no, r.description,
         r.amount_lcy, r.source_amount, k.original_invoice, k.manual_claim_month, coalesce(k.manual_not_claimed, false),
         k.doc_path, k.doc_name, k.doc_uploaded_at, auth.uid()
  from jsonb_to_recordset(p_rows) as r(invoice_no text, posting_date date, vendor_name text, external_doc_no text,
                                       description text, amount_lcy numeric, source_amount numeric)
  left join _keep k using (invoice_no);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function replace_ledger_month(uuid, date, jsonb) from public, anon, authenticated;

-- The view's column list was fixed when it was made, so it is rebuilt to show the new columns (as in 0014).
drop view if exists invoice_claim_status;
create view invoice_claim_status with (security_invoker = false) as
select i.*,
       a.auto_claim_month,
       case when i.manual_not_claimed then null
            else coalesce(i.manual_claim_month, a.auto_claim_month) end as claim_month,
       case when i.manual_not_claimed then 'Not Claimed'
            when coalesce(i.manual_claim_month, a.auto_claim_month) is not null then 'Claimed'
            else 'Not Claimed' end as claim_status
from ledger_invoices i
left join lateral (
  select min(s.return_month) as auto_claim_month
  from schedule_lines s
  where s.company_id = i.company_id
    and norm_doc_no(s.tax_invoice_no) = norm_doc_no(i.external_doc_no)
) a on true
where has_perm(i.company_id, 'invoices', 'view');
revoke all on invoice_claim_status from anon;
grant select on invoice_claim_status to authenticated, service_role;

-- As in 0014, with invoice documents under <company>/invoices/ belonging to the Invoice listing tab.
create or replace function storage_perm(p_name text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select case
    when doc_company(p_name) is null then false
    when (storage.foldername(p_name))[2] = 'customs'
      then coalesce(has_perm(doc_company(p_name), customs_tab((storage.foldername(p_name))[3]), p_action), false)
    when (storage.foldername(p_name))[2] = 'invoices'
      then has_perm(doc_company(p_name), 'invoices', p_action)
    else doc_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
  end
$$;

-- Record (p_path set) or clear (p_path null) the document of one ledger invoice.
create or replace function set_invoice_document(p_invoice uuid, p_path text, p_name text) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
declare v ledger_invoices;
begin
  select * into v from ledger_invoices where id = p_invoice;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if p_path is not null and p_path not like v.company_id::text || '/invoices/%' then
    raise exception 'Document path does not belong to this company' using errcode = '22023';
  end if;
  if p_path is not null and not has_perm(v.company_id, 'invoices', 'upload') then
    raise exception 'You do not have upload permission on this tab.' using errcode = '42501';
  end if;
  if (p_path is null or v.doc_path is not null) and not has_perm(v.company_id, 'invoices', 'delete') then
    raise exception 'Replacing or removing a document needs delete permission on this tab.' using errcode = '42501';
  end if;
  perform change_label(
    case when p_path is null then 'Removed' when v.doc_path is null then 'Attached' else 'Replaced' end
      || ' the invoice document of ' || v.invoice_no, 'document');
  update ledger_invoices set
    doc_path = p_path,
    doc_name = case when p_path is null then null else p_name end,
    doc_uploaded_at = case when p_path is null then null else now() end
  where id = p_invoice;
end $$;
revoke execute on function set_invoice_document(uuid, text, text) from public, anon;
grant execute on function set_invoice_document(uuid, text, text) to authenticated;

-- As in 0016, also archiving invoice documents that stop being referenced.
create or replace function archive_doc_paths() returns trigger
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  v_old text[];
  v_new text[] := '{}';
  p text;
begin
  if tg_table_name = 'return_documents' then
    v_old := array[old.path];
    if tg_op = 'UPDATE' then v_new := array[new.path]; end if;
  elsif tg_table_name = 'ledger_invoices' then
    v_old := array[old.doc_path];
    if tg_op = 'UPDATE' then v_new := array[new.doc_path]; end if;
  else
    v_old := array[old.doc_path, old.invoice_doc_path, old.other_doc_path, old.all_doc_path];
    if tg_op = 'UPDATE' then v_new := array[new.doc_path, new.invoice_doc_path, new.other_doc_path, new.all_doc_path]; end if;
  end if;
  foreach p in array v_old loop
    if p is not null and not (p = any (v_new)) then
      insert into archived_files (path, company_id) values (p, old.company_id)
      on conflict (path) do update set archived_at = now() where archived_files.purged_at is null;
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists archive_doc_paths on ledger_invoices;
create trigger archive_doc_paths after update or delete on ledger_invoices
  for each row execute function archive_doc_paths();

-- As in 0016, with invoice documents.
create or replace function doc_referenced(p_path text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select exists (select 1 from return_documents where path = p_path)
      or exists (select 1 from customs_entries where p_path in (doc_path, invoice_doc_path, other_doc_path, all_doc_path))
      or exists (select 1 from ledger_invoices where doc_path = p_path)
$$;

notify pgrst, 'reload schema';
