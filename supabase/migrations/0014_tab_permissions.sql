-- Per-tab permissions. A company member is either an admin (everything, and manages members) or a member
-- whose access is set tab by tab in company_member_permissions:
--   no row      no access: the tab is hidden and its data cannot be read
--   a row       view, plus any of
--     upload    first upload of a month's file or of a document into an empty slot
--     edit      inline edits, rows added by hand, return figures, IRD status
--     delete    deleting rows, replacing or removing a document, re-uploading (replacing) a month's data
-- Existing viewers get view on every tab and existing editors everything, so nobody's access changes.
-- Uploads go through the upload_* functions below, which check the permission and then call the
-- replace_* functions (no longer callable from the app directly).
set search_path = vat_claims, public;

-- Tabs, in the order the app shows them. Members is admin-only and has no row here.
--   summary  invoices  schedule  exports  imports  returns  filing  ird_status

create table if not exists company_member_permissions (
  company_id uuid not null,
  user_id uuid not null,
  tab text not null check (tab in ('summary','invoices','schedule','exports','imports','returns','filing','ird_status')),
  can_upload boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  primary key (company_id, user_id, tab),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade,
  -- Summary is read-only; Return filing has nothing to edit, only documents to upload and remove.
  check (tab <> 'summary' or not (can_upload or can_edit or can_delete)),
  check (tab <> 'filing' or not can_edit)
);

-- Existing members keep what they had.
insert into company_member_permissions (company_id, user_id, tab, can_upload, can_edit, can_delete)
select m.company_id, m.user_id, t.tab,
       m.role = 'editor' and t.tab <> 'summary',
       m.role = 'editor' and t.tab not in ('summary', 'filing'),
       m.role = 'editor' and t.tab <> 'summary'
from company_members m
cross join unnest(array['summary','invoices','schedule','exports','imports','returns','filing','ird_status']) as t(tab)
where m.role in ('viewer', 'editor')
on conflict do nothing;

alter table company_members drop constraint if exists company_members_role_check;
update company_members set role = 'member' where role in ('viewer', 'editor');
alter table company_members add constraint company_members_role_check check (role in ('member', 'admin'));
alter table company_members alter column role set default 'member';

-- True when the signed-in user may do p_action (view, upload, edit, delete) on p_tab of company c.
create or replace function has_perm(c uuid, p_tab text, p_action text) returns boolean
language sql stable security definer set search_path = vat_claims, public as $$
  select coalesce(
    (select true from company_members m where m.company_id = c and m.user_id = auth.uid() and m.role = 'admin'),
    (select case p_action
              when 'view' then true
              when 'upload' then p.can_upload
              when 'edit' then p.can_edit
              when 'delete' then p.can_delete
              else false
            end
       from company_member_permissions p
      where p.company_id = c and p.user_id = auth.uid() and p.tab = p_tab),
    false)
$$;

-- Tab that owns the customs entries of a direction.
create or replace function customs_tab(p_direction text) returns text
language sql immutable as $$
  select case p_direction when 'export' then 'exports' when 'import' then 'imports' end
$$;

-- Returns and acknowledgements are handled on both the VAT reconciliation and Return filing tabs;
-- credit vouchers on IRD status.
create or replace function doc_perm(c uuid, p_kind text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select case
    when p_kind = 'credit_voucher' then has_perm(c, 'ird_status', p_action)
    when p_kind in ('return', 'acknowledgement') then has_perm(c, 'returns', p_action) or has_perm(c, 'filing', p_action)
    else false
  end
$$;

-- Permission on a file in the vat-claims bucket, from its path:
--   <company>/customs/<export|import>/...   the customs tab of that direction
--   <company>/<YYYY-MM>/<kind>/<file>       the tab of that document kind
create or replace function storage_perm(p_name text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select case
    when doc_company(p_name) is null then false
    when (storage.foldername(p_name))[2] = 'customs'
      then coalesce(has_perm(doc_company(p_name), customs_tab((storage.foldername(p_name))[3]), p_action), false)
    else doc_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
  end
$$;

grant execute on function has_perm(uuid, text, text) to authenticated;
grant execute on function customs_tab(text) to authenticated;
grant execute on function doc_perm(uuid, text, text) to authenticated;
grant execute on function storage_perm(text, text) to authenticated;

-- Permissions table: members read their own rows, admins read and change everyone's.
alter table company_member_permissions enable row level security;
drop policy if exists member_permissions_read on company_member_permissions;
drop policy if exists member_permissions_admin on company_member_permissions;
create policy member_permissions_read on company_member_permissions for select
  using (user_id = auth.uid() or member_role(company_id) = 'admin');
create policy member_permissions_admin on company_member_permissions for all
  using (member_role(company_id) = 'admin') with check (member_role(company_id) = 'admin');
grant all on company_member_permissions to authenticated, service_role;

-- Table policies: read with view, insert and update with edit, delete with delete, on the owning tab.
do $$ declare t record; begin
  for t in select * from (values
    ('ledger_invoices', 'invoices'),
    ('schedule_lines', 'schedule'),
    ('export_sales', 'exports'),
    ('import_purchases', 'imports'),
    ('ird_status', 'ird_status')
  ) as v(tbl, tab) loop
    execute format('drop policy if exists %I on %I', t.tbl || '_read', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_write', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_insert', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_update', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_delete', t.tbl);
    execute format('create policy %I on %I for select using (has_perm(company_id, %L, ''view''))', t.tbl || '_read', t.tbl, t.tab);
    execute format('create policy %I on %I for insert with check (has_perm(company_id, %L, ''edit''))', t.tbl || '_insert', t.tbl, t.tab);
    execute format('create policy %I on %I for update using (has_perm(company_id, %L, ''edit'')) with check (has_perm(company_id, %L, ''edit''))', t.tbl || '_update', t.tbl, t.tab, t.tab);
    execute format('create policy %I on %I for delete using (has_perm(company_id, %L, ''delete''))', t.tbl || '_delete', t.tbl, t.tab);
  end loop;
end $$;

-- Customs entries belong to Export reconciliation or Import Register by direction.
drop policy if exists customs_entries_read on customs_entries;
drop policy if exists customs_entries_write on customs_entries;
drop policy if exists customs_entries_insert on customs_entries;
drop policy if exists customs_entries_update on customs_entries;
drop policy if exists customs_entries_delete on customs_entries;
create policy customs_entries_read on customs_entries for select using (has_perm(company_id, customs_tab(direction), 'view'));
create policy customs_entries_insert on customs_entries for insert with check (has_perm(company_id, customs_tab(direction), 'edit'));
create policy customs_entries_update on customs_entries for update
  using (has_perm(company_id, customs_tab(direction), 'edit')) with check (has_perm(company_id, customs_tab(direction), 'edit'));
create policy customs_entries_delete on customs_entries for delete using (has_perm(company_id, customs_tab(direction), 'delete'));

-- Return figures are entered on VAT reconciliation; Return filing and IRD status show them too.
drop policy if exists vat_returns_read on vat_returns;
drop policy if exists vat_returns_write on vat_returns;
drop policy if exists vat_returns_insert on vat_returns;
drop policy if exists vat_returns_update on vat_returns;
drop policy if exists vat_returns_delete on vat_returns;
create policy vat_returns_read on vat_returns for select
  using (has_perm(company_id, 'returns', 'view') or has_perm(company_id, 'filing', 'view') or has_perm(company_id, 'ird_status', 'view'));
create policy vat_returns_insert on vat_returns for insert with check (has_perm(company_id, 'returns', 'edit'));
create policy vat_returns_update on vat_returns for update
  using (has_perm(company_id, 'returns', 'edit')) with check (has_perm(company_id, 'returns', 'edit'));
create policy vat_returns_delete on vat_returns for delete using (has_perm(company_id, 'returns', 'delete'));

-- Document register: a new document needs upload; replacing (update) or removing one needs delete.
drop policy if exists return_documents_read on return_documents;
drop policy if exists return_documents_write on return_documents;
drop policy if exists return_documents_insert on return_documents;
drop policy if exists return_documents_update on return_documents;
drop policy if exists return_documents_delete on return_documents;
create policy return_documents_read on return_documents for select using (doc_perm(company_id, kind, 'view'));
create policy return_documents_insert on return_documents for insert with check (doc_perm(company_id, kind, 'upload'));
create policy return_documents_update on return_documents for update
  using (doc_perm(company_id, kind, 'delete')) with check (doc_perm(company_id, kind, 'delete'));
create policy return_documents_delete on return_documents for delete using (doc_perm(company_id, kind, 'delete'));

-- Files: the same rules, by path. Overwriting a file (update) is a replacement, so it needs delete.
drop policy if exists vat_claims_docs_read on storage.objects;
drop policy if exists vat_claims_docs_insert on storage.objects;
drop policy if exists vat_claims_docs_update on storage.objects;
drop policy if exists vat_claims_docs_delete on storage.objects;
create policy vat_claims_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'vat-claims' and vat_claims.storage_perm(name, 'view'));
create policy vat_claims_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vat-claims' and vat_claims.storage_perm(name, 'upload'));
create policy vat_claims_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'vat-claims' and vat_claims.storage_perm(name, 'delete'))
  with check (bucket_id = 'vat-claims' and vat_claims.storage_perm(name, 'delete'));
create policy vat_claims_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vat-claims' and vat_claims.storage_perm(name, 'delete'));

-- The derived views read across tabs (claim status needs the schedule, the schedule's match needs the
-- ledger), so they run with the owner's rights and filter on the tab they belong to instead.
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

drop view if exists schedule_line_match;
create view schedule_line_match with (security_invoker = false) as
select s.*, m.invoice_no as ledger_invoice_no
from schedule_lines s
left join lateral (
  select i.invoice_no from ledger_invoices i
  where i.company_id = s.company_id
    and norm_doc_no(i.external_doc_no) = norm_doc_no(s.tax_invoice_no)
  order by i.posting_date limit 1
) m on true
where has_perm(s.company_id, 'schedule', 'view');

revoke all on invoice_claim_status, schedule_line_match from anon;
grant select on invoice_claim_status, schedule_line_match to authenticated, service_role;

-- Uploads. Raises unless the user may upload on the tab, and also delete when the upload replaces data.
create or replace function require_upload(c uuid, p_tab text, p_replacing boolean) returns void
language plpgsql stable set search_path = vat_claims, public as $$
begin
  if not has_perm(c, p_tab, 'upload') then
    raise exception 'You do not have upload permission on this tab.' using errcode = '42501';
  end if;
  if p_replacing and not has_perm(c, p_tab, 'delete') then
    raise exception 'Data is already held for this upload. Replacing it needs delete permission on this tab.'
      using errcode = '42501';
  end if;
end $$;

create or replace function upload_ledger_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'invoices', exists (
    select 1 from ledger_invoices
    where company_id = p_company and date_trunc('month', posting_date) = date_trunc('month', p_month)));
  return replace_ledger_month(p_company, p_month, p_rows);
end $$;

create or replace function upload_schedule_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'schedule', exists (
    select 1 from schedule_lines
    where company_id = p_company and return_month = date_trunc('month', p_month)::date));
  return replace_schedule_month(p_company, p_month, p_rows);
end $$;

create or replace function upload_export_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'exports', exists (
    select 1 from export_sales
    where company_id = p_company and sales_month = date_trunc('month', p_month)::date));
  return replace_export_month(p_company, p_month, p_rows);
end $$;

create or replace function upload_import_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'imports', exists (
    select 1 from import_purchases
    where company_id = p_company and sales_month = date_trunc('month', p_month)::date));
  return replace_import_month(p_company, p_month, p_rows);
end $$;

-- Re-uploading a CusDec (same CusDec and invoice number) replaces its lines, so that needs delete too.
create or replace function upload_customs_entries(p_company uuid, p_direction text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if customs_tab(p_direction) is null then
    raise exception 'direction must be export or import' using errcode = '22023';
  end if;
  perform require_upload(p_company, customs_tab(p_direction), exists (
    select 1 from customs_entries e
    join jsonb_to_recordset(p_rows) as r(cusdec_no text, invoice_no text)
      on r.cusdec_no = e.cusdec_no and r.invoice_no = e.invoice_no
    where e.company_id = p_company and e.direction = p_direction));
  return replace_customs_entries(p_company, p_direction, p_rows);
end $$;

-- The VAT Return_Upload workbook: each period's cages in p_rows, merged into vat_returns so columns the
-- file does not carry (the ledger figures) are kept. Periods already held are replaced, so need delete.
create or replace function upload_vat_returns(p_company uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare r jsonb; m date; v vat_returns; n int := 0;
begin
  perform require_upload(p_company, 'returns', exists (
    select 1 from vat_returns t
    join jsonb_array_elements(p_rows) as x(j) on t.return_month = (x.j->>'return_month')::date
    where t.company_id = p_company));
  for r in select * from jsonb_array_elements(p_rows) loop
    m := (r->>'return_month')::date;
    insert into vat_returns (company_id, return_month) values (p_company, m) on conflict do nothing;
    select * into v from vat_returns where company_id = p_company and return_month = m;
    v := jsonb_populate_record(v, r - 'company_id' - 'return_month' - 'updated_by' - 'updated_at');
    v.updated_by := auth.uid();
    v.updated_at := now();
    delete from vat_returns where company_id = p_company and return_month = m;
    insert into vat_returns select (v).*;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Record (p_path set) or clear (p_path null) a document slot on every line of a customs declaration.
-- Filling an empty slot needs upload; replacing or clearing a held one needs delete.
create or replace function set_customs_document(p_company uuid, p_direction text, p_cusdec_no text, p_invoice_no text,
                                                p_kind text, p_path text, p_name text) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
declare v_tab text := customs_tab(p_direction); held text;
begin
  if v_tab is null or p_kind not in ('cusdec', 'other', 'all') then
    raise exception 'Unknown customs document slot' using errcode = '22023';
  end if;
  if p_path is not null and p_path not like p_company::text || '/customs/' || p_direction || '/%' then
    raise exception 'Document path does not belong to this company and direction' using errcode = '22023';
  end if;
  select case p_kind when 'cusdec' then doc_path when 'other' then other_doc_path else all_doc_path end into held
  from customs_entries
  where company_id = p_company and direction = p_direction and cusdec_no = p_cusdec_no and invoice_no = p_invoice_no
  order by item_no limit 1;
  if not found then
    raise exception 'No customs entry for CusDec % and invoice %', p_cusdec_no, p_invoice_no using errcode = 'P0002';
  end if;
  if p_path is not null and not has_perm(p_company, v_tab, 'upload') then
    raise exception 'You do not have upload permission on this tab.' using errcode = '42501';
  end if;
  if (p_path is null or held is not null) and not has_perm(p_company, v_tab, 'delete') then
    raise exception 'Replacing or removing a document needs delete permission on this tab.' using errcode = '42501';
  end if;
  update customs_entries set
    doc_path              = case when p_kind = 'cusdec' then p_path else doc_path end,
    doc_name              = case when p_kind = 'cusdec' then p_name else doc_name end,
    doc_uploaded_at       = case when p_kind = 'cusdec' then case when p_path is null then null else now() end else doc_uploaded_at end,
    other_doc_path        = case when p_kind = 'other' then p_path else other_doc_path end,
    other_doc_name        = case when p_kind = 'other' then p_name else other_doc_name end,
    other_doc_uploaded_at = case when p_kind = 'other' then case when p_path is null then null else now() end else other_doc_uploaded_at end,
    all_doc_path          = case when p_kind = 'all' then p_path else all_doc_path end,
    all_doc_name          = case when p_kind = 'all' then p_name else all_doc_name end,
    all_doc_uploaded_at   = case when p_kind = 'all' then case when p_path is null then null else now() end else all_doc_uploaded_at end
  where company_id = p_company and direction = p_direction and cusdec_no = p_cusdec_no and invoice_no = p_invoice_no;
end $$;

revoke execute on function replace_ledger_month(uuid, date, jsonb) from public, anon, authenticated;
revoke execute on function replace_schedule_month(uuid, date, jsonb) from public, anon, authenticated;
revoke execute on function replace_export_month(uuid, date, jsonb) from public, anon, authenticated;
revoke execute on function replace_import_month(uuid, date, jsonb) from public, anon, authenticated;
revoke execute on function replace_customs_entries(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function require_upload(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function upload_ledger_month(uuid, date, jsonb) from public, anon;
revoke execute on function upload_schedule_month(uuid, date, jsonb) from public, anon;
revoke execute on function upload_export_month(uuid, date, jsonb) from public, anon;
revoke execute on function upload_import_month(uuid, date, jsonb) from public, anon;
revoke execute on function upload_customs_entries(uuid, text, jsonb) from public, anon;
revoke execute on function upload_vat_returns(uuid, jsonb) from public, anon;
revoke execute on function set_customs_document(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function upload_ledger_month(uuid, date, jsonb) to authenticated;
grant execute on function upload_schedule_month(uuid, date, jsonb) to authenticated;
grant execute on function upload_export_month(uuid, date, jsonb) to authenticated;
grant execute on function upload_import_month(uuid, date, jsonb) to authenticated;
grant execute on function upload_customs_entries(uuid, text, jsonb) to authenticated;
grant execute on function upload_vat_returns(uuid, jsonb) to authenticated;
grant execute on function set_customs_document(uuid, text, text, text, text, text, text) to authenticated;

-- Members screen. member_list also returns each member's permissions.
drop function if exists member_list(uuid);
create function member_list(p_company uuid)
returns table (user_id uuid, email text, role text, permissions jsonb)
language sql stable security definer set search_path = vat_claims, public as $$
  select m.user_id, u.email::text, m.role,
         coalesce((select jsonb_agg(jsonb_build_object('tab', p.tab, 'can_upload', p.can_upload,
                                                       'can_edit', p.can_edit, 'can_delete', p.can_delete))
                   from company_member_permissions p
                   where p.company_id = m.company_id and p.user_id = m.user_id), '[]'::jsonb)
  from company_members m
  join auth.users u on u.id = m.user_id
  where m.company_id = p_company
    and member_role(p_company) is not null
  order by u.email
$$;

-- Set a member's role and tab permissions in one go. Admins only; the last admin cannot be demoted.
-- p_perms: [{tab, can_upload, can_edit, can_delete}, ...], one entry per tab the member may open.
create or replace function set_member_access(p_company uuid, p_user uuid, p_role text, p_perms jsonb) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if member_role(p_company) is distinct from 'admin' then
    raise exception 'Only company admins can change members' using errcode = '42501';
  end if;
  if p_role not in ('member', 'admin') then
    raise exception 'Role must be member or admin' using errcode = '22023';
  end if;
  if p_role <> 'admin'
     and exists (select 1 from company_members where company_id = p_company and user_id = p_user and role = 'admin')
     and (select count(*) from company_members where company_id = p_company and role = 'admin') <= 1 then
    raise exception 'This is the only admin. Make someone else an admin first.' using errcode = '42501';
  end if;
  insert into company_members (company_id, user_id, role) values (p_company, p_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role;
  delete from company_member_permissions where company_id = p_company and user_id = p_user;
  if p_role = 'member' then
    insert into company_member_permissions (company_id, user_id, tab, can_upload, can_edit, can_delete)
    select p_company, p_user, r.tab,
           coalesce(r.can_upload, false) and r.tab <> 'summary',
           coalesce(r.can_edit, false) and r.tab not in ('summary', 'filing'),
           coalesce(r.can_delete, false) and r.tab <> 'summary'
    from jsonb_to_recordset(coalesce(p_perms, '[]'::jsonb)) as r(tab text, can_upload boolean, can_edit boolean, can_delete boolean);
  end if;
end $$;

-- Add (or update) a member by email. The person must already have a login in this Supabase project.
drop function if exists add_member_by_email(uuid, text, text);
create or replace function add_member_by_email(p_company uuid, p_email text, p_role text, p_perms jsonb)
returns void
language plpgsql security definer set search_path = vat_claims, public as $$
declare v_user uuid;
begin
  if member_role(p_company) is distinct from 'admin' then
    raise exception 'Only company admins can add members' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(auth.users.email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'No login found for %. Create the user under Authentication first, then add them here.', trim(p_email)
      using errcode = 'P0002';
  end if;
  perform set_member_access(p_company, v_user, p_role, p_perms);
end $$;

revoke all on function member_list(uuid) from public, anon;
revoke all on function set_member_access(uuid, uuid, text, jsonb) from public, anon;
revoke all on function add_member_by_email(uuid, text, text, jsonb) from public, anon;
grant execute on function member_list(uuid) to authenticated;
grant execute on function set_member_access(uuid, uuid, text, jsonb) to authenticated;
grant execute on function add_member_by_email(uuid, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
