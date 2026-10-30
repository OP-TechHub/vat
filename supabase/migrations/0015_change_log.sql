-- Change log: every change to the company's data, members and permissions, who made it and when,
-- with undo for admins.
--   change_sets      one entry per action (an upload, an inline edit, a removed document, an undo...)
--   change_log       the rows the action changed, with the row before and after
--   archived_files   documents no longer referenced by any row; kept 30 days so an undo can bring them
--                    back, then deleted by change_log_housekeeping (run by the app for admins)
-- Rows are recorded by triggers, so nothing can change data without being logged. An action is one
-- database transaction; the customs refresh (apply_customs) the app runs right after an edit is
-- attached to that edit. The log is kept for 5 years.
set search_path = vat_claims, public;

create table if not exists change_sets (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  label text,                 -- set by the server functions (uploads, documents, members, undo)
  kind text,                  -- upload, document, members, undo; null = derived from the rows
  tabs text[] not null default '{}',
  n_insert int not null default 0,
  n_update int not null default 0,
  n_delete int not null default 0,
  undo_of bigint references change_sets(id) on delete set null,
  undone_by bigint references change_sets(id) on delete set null,
  undone_at timestamptz
);
create index if not exists change_sets_company on change_sets (company_id, id desc);

create table if not exists change_log (
  id bigserial primary key,
  set_id bigint not null references change_sets(id) on delete cascade,
  tbl text not null,
  tab text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_key jsonb not null,     -- primary key of the row
  old_row jsonb,
  new_row jsonb
);
create index if not exists change_log_set on change_log (set_id, id);
create index if not exists change_log_row on change_log (tbl, row_key, id);

create table if not exists archived_files (
  path text primary key,
  company_id uuid not null references companies(id) on delete cascade,
  archived_at timestamptz not null default now(),
  purged_at timestamptz
);

alter table change_sets enable row level security;
alter table change_log enable row level security;
alter table archived_files enable row level security;
drop policy if exists change_sets_admin_read on change_sets;
drop policy if exists change_log_admin_read on change_log;
create policy change_sets_admin_read on change_sets for select using (member_role(company_id) = 'admin');
create policy change_log_admin_read on change_log for select
  using (exists (select 1 from change_sets s where s.id = set_id and member_role(s.company_id) = 'admin'));
-- No insert / update / delete policies: only the triggers and functions below (owner rights) write here.

-- Bookkeeping columns that do not count as a change.
create or replace function strip_meta(j jsonb) returns jsonb
language sql immutable as $$ select j - array['updated_at', 'updated_by', 'created_at', 'created_by'] $$;

-- Label and kind of the action about to run, read when its change set is created.
create or replace function change_label(p_label text, p_kind text) returns void
language plpgsql as $$
begin
  perform set_config('vat_claims.label', coalesce(p_label, ''), true);
  perform set_config('vat_claims.kind', coalesce(p_kind, ''), true);
end $$;

-- Row trigger: records the change in the current transaction's change set. Arguments: primary key columns.
create or replace function log_change() returns trigger
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_company uuid := (v_row->>'company_id')::uuid;
  v_key jsonb := '{}'::jsonb;
  v_tab text;
  v_cur text := current_setting('vat_claims.change_set', true);
  v_set bigint;
  k text;
begin
  if tg_op = 'UPDATE' and strip_meta(v_old) = strip_meta(v_new) then
    return null;
  end if;
  foreach k in array tg_argv loop
    v_key := v_key || jsonb_build_object(k, v_row->k);
  end loop;
  v_tab := case tg_table_name
    when 'ledger_invoices' then 'invoices'
    when 'schedule_lines' then 'schedule'
    when 'export_sales' then 'exports'
    when 'import_purchases' then 'imports'
    when 'customs_entries' then coalesce(customs_tab(v_row->>'direction'), 'imports')
    when 'vat_returns' then 'returns'
    when 'return_documents' then case when v_row->>'kind' = 'credit_voucher' then 'ird_status' else 'filing' end
    when 'ird_status' then 'ird_status'
    else 'members'
  end;
  if v_cur like v_company::text || ':%' then
    v_set := split_part(v_cur, ':', 2)::bigint;
  end if;
  -- The customs refresh the app runs straight after an edit belongs to that edit.
  if v_set is null and current_setting('vat_claims.derived', true) = 'on' then
    select id into v_set from change_sets
    where company_id = v_company and changed_by is not distinct from auth.uid()
      and changed_at > now() - interval '2 minutes' and undone_by is null
    order by id desc limit 1;
  end if;
  if v_set is null then
    insert into change_sets (company_id, changed_by, label, kind, undo_of)
    values (v_company, auth.uid(),
            nullif(current_setting('vat_claims.label', true), ''),
            nullif(current_setting('vat_claims.kind', true), ''),
            nullif(current_setting('vat_claims.undo_of', true), '')::bigint)
    returning id into v_set;
  end if;
  perform set_config('vat_claims.change_set', v_company::text || ':' || v_set, true);
  insert into change_log (set_id, tbl, tab, op, row_key, old_row, new_row)
  values (v_set, tg_table_name, v_tab, tg_op, v_key, v_old, v_new);
  update change_sets set
    tabs = case when v_tab = any (tabs) then tabs else tabs || v_tab end,
    n_insert = n_insert + (tg_op = 'INSERT')::int,
    n_update = n_update + (tg_op = 'UPDATE')::int,
    n_delete = n_delete + (tg_op = 'DELETE')::int
  where id = v_set;
  return null;
end $$;

do $$ declare t record; begin
  for t in select * from (values
    ('ledger_invoices', array['id']),
    ('schedule_lines', array['id']),
    ('export_sales', array['id']),
    ('import_purchases', array['id']),
    ('customs_entries', array['id']),
    ('vat_returns', array['company_id', 'return_month']),
    ('return_documents', array['company_id', 'return_month', 'kind']),
    ('ird_status', array['company_id', 'return_month']),
    ('company_members', array['company_id', 'user_id']),
    ('company_member_permissions', array['company_id', 'user_id', 'tab'])
  ) as v(tbl, keys) loop
    execute format('drop trigger if exists log_change on %I', t.tbl);
    execute format('create trigger log_change after insert or update or delete on %I for each row execute function log_change(%s)',
                   t.tbl, (select string_agg(quote_literal(k), ', ') from unnest(t.keys) k));
  end loop;
end $$;

-- Documents that stop being referenced are archived rather than deleted (the app no longer removes files).
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
  else
    v_old := array[old.doc_path, old.other_doc_path, old.all_doc_path];
    if tg_op = 'UPDATE' then v_new := array[new.doc_path, new.other_doc_path, new.all_doc_path]; end if;
  end if;
  foreach p in array v_old loop
    if p is not null and not (p = any (v_new)) then
      insert into archived_files (path, company_id) values (p, old.company_id)
      on conflict (path) do update set archived_at = now() where archived_files.purged_at is null;
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists archive_doc_paths on return_documents;
create trigger archive_doc_paths after update or delete on return_documents
  for each row execute function archive_doc_paths();
drop trigger if exists archive_doc_paths on customs_entries;
create trigger archive_doc_paths after update or delete on customs_entries
  for each row execute function archive_doc_paths();

-- True when some row still points at the file.
create or replace function doc_referenced(p_path text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select exists (select 1 from return_documents where path = p_path)
      or exists (select 1 from customs_entries where p_path in (doc_path, other_doc_path, all_doc_path))
$$;

-- As in 0011, marking its changes as the derived customs refresh.
create or replace function apply_customs(p_company uuid, p_direction text, p_month date default null) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
  perform set_config('vat_claims.derived', 'on', true);
  create temp table _cus on commit drop as
    select h.cusdec_no, h.cusdec_date, h.cusdec_month, h.invoice_no, h.currency_type, h.ex_rate, h.invoice_value,
           t.customs_value, t.vat_base, t.vat_amount
    from (
      select distinct on (norm_doc_no(invoice_no)) *
      from customs_entries where company_id = p_company and direction = p_direction
      order by norm_doc_no(invoice_no), created_at desc, item_no
    ) h
    join (
      select cusdec_no, invoice_no, sum(customs_value) as customs_value, sum(vat_base) as vat_base, sum(vat_amount) as vat_amount
      from customs_entries where company_id = p_company and direction = p_direction
      group by cusdec_no, invoice_no
    ) t on t.cusdec_no = h.cusdec_no and t.invoice_no = h.invoice_no;

  if p_direction = 'export' then
    update export_sales s set
      cusdec_no = c.cusdec_no,
      cusdec_date = c.cusdec_date,
      cusdec_month = coalesce(c.cusdec_month, s.cusdec_month),
      currency_type = case when c.currency_type in ('USD','EUR') then c.currency_type else s.currency_type end,
      custom_ex_rate = c.ex_rate,
      custom_invoice_value = coalesce(c.invoice_value, s.amount_fc),
      custom_value = coalesce(c.customs_value, round(c.ex_rate * coalesce(c.invoice_value, s.amount_fc), 2)),
      updated_at = now(), updated_by = auth.uid()
    from _cus c
    where s.company_id = p_company
      and norm_doc_no(s.invoice_no) = norm_doc_no(c.invoice_no)
      and (p_month is null or s.sales_month = date_trunc('month', p_month)::date);
  else
    update import_purchases s set
      cusdec_no = c.cusdec_no,
      cusdec_date = c.cusdec_date,
      cusdec_month = coalesce(c.cusdec_month, s.cusdec_month),
      currency_type = coalesce(nullif(c.currency_type, ''), s.currency_type),
      custom_ex_rate = c.ex_rate,
      custom_invoice_value = coalesce(c.invoice_value, s.amount_fc),
      custom_value = coalesce(c.customs_value, round(c.ex_rate * coalesce(c.invoice_value, s.amount_fc), 2)),
      custom_vat_base = coalesce(c.vat_base, s.custom_vat_base),
      custom_vat_amount = coalesce(c.vat_amount, s.custom_vat_amount),
      updated_at = now(), updated_by = auth.uid()
    from _cus c
    where s.company_id = p_company
      and norm_doc_no(s.invoice_no) = norm_doc_no(c.invoice_no)
      and (p_month is null or s.sales_month = date_trunc('month', p_month)::date);
  end if;
  get diagnostics n = row_count;
  drop table _cus;
  perform set_config('vat_claims.derived', 'off', true);
  return n;
end $$;

-- The server-side actions from 0014, as there, each naming itself for the log.
create or replace function upload_ledger_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'invoices', exists (
    select 1 from ledger_invoices
    where company_id = p_company and date_trunc('month', posting_date) = date_trunc('month', p_month)));
  perform change_label('Uploaded the ledger invoice list for ' || to_char(p_month, 'Mon YYYY'), 'upload');
  return replace_ledger_month(p_company, p_month, p_rows);
end $$;

create or replace function upload_schedule_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'schedule', exists (
    select 1 from schedule_lines
    where company_id = p_company and return_month = date_trunc('month', p_month)::date));
  perform change_label('Uploaded the IRD input schedule for ' || to_char(p_month, 'Mon YYYY'), 'upload');
  return replace_schedule_month(p_company, p_month, p_rows);
end $$;

create or replace function upload_export_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'exports', exists (
    select 1 from export_sales
    where company_id = p_company and sales_month = date_trunc('month', p_month)::date));
  perform change_label('Uploaded the export sales report for ' || to_char(p_month, 'Mon YYYY'), 'upload');
  return replace_export_month(p_company, p_month, p_rows);
end $$;

create or replace function upload_import_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  perform require_upload(p_company, 'imports', exists (
    select 1 from import_purchases
    where company_id = p_company and sales_month = date_trunc('month', p_month)::date));
  perform change_label('Uploaded the import purchase report for ' || to_char(p_month, 'Mon YYYY'), 'upload');
  return replace_import_month(p_company, p_month, p_rows);
end $$;

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
  perform change_label(
    'Uploaded ' || (select count(distinct (r.cusdec_no, r.invoice_no))
                    from jsonb_to_recordset(p_rows) as r(cusdec_no text, invoice_no text))
      || ' ' || p_direction || ' CusDec(s)', 'upload');
  return replace_customs_entries(p_company, p_direction, p_rows);
end $$;

create or replace function upload_vat_returns(p_company uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare r jsonb; m date; v vat_returns; n int := 0;
begin
  perform require_upload(p_company, 'returns', exists (
    select 1 from vat_returns t
    join jsonb_array_elements(p_rows) as x(j) on t.return_month = (x.j->>'return_month')::date
    where t.company_id = p_company));
  perform change_label('Uploaded VAT return data for ' || jsonb_array_length(p_rows) || ' period(s)', 'upload');
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
  perform change_label(
    case when p_path is null then 'Removed' when held is null then 'Attached' else 'Replaced' end || ' the '
      || case p_kind when 'cusdec' then 'CusDec' when 'other' then 'other documents' else 'all documents' end
      || ' file of CusDec ' || p_cusdec_no || ' (invoice ' || p_invoice_no || ')', 'document');
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
  perform change_label(
    case when exists (select 1 from company_members where company_id = p_company and user_id = p_user)
         then 'Changed the access of ' else 'Added member ' end
      || coalesce((select email from auth.users where id = p_user), p_user::text), 'members');
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

-- Log entries for the Log tab, newest first. Admins only.
create or replace function change_log_list(p_company uuid, p_before bigint default null, p_limit int default 100,
                                           p_tab text default null, p_user uuid default null,
                                           p_from date default null, p_to date default null, p_kind text default null)
returns table (id bigint, changed_at timestamptz, changed_by uuid, email text, label text, kind text,
               undo_of bigint, undone_by bigint, undone_at timestamptz, tabs text[],
               n_insert int, n_update int, n_delete int)
language sql stable security definer set search_path = vat_claims, public as $$
  select * from (
    select s.id, s.changed_at, s.changed_by, u.email::text, s.label,
           coalesce(s.kind, case when s.n_delete > 0 and s.n_insert = 0 and s.n_update = 0 then 'delete'
                                 when s.n_insert > 0 and s.n_delete = 0 and s.n_update = 0 then 'add'
                                 else 'edit' end) as kind,
           s.undo_of, s.undone_by, s.undone_at, s.tabs, s.n_insert, s.n_update, s.n_delete
    from change_sets s
    left join auth.users u on u.id = s.changed_by
    where s.company_id = p_company
      and member_role(p_company) = 'admin'
      and (p_before is null or s.id < p_before)
      and (p_user is null or s.changed_by = p_user)
      and (p_from is null or s.changed_at >= p_from)
      and (p_to is null or s.changed_at < p_to + 1)
      and (p_tab is null or p_tab = any (s.tabs))
  ) x
  where p_kind is null or x.kind = p_kind
  order by x.id desc
  limit least(coalesce(p_limit, 100), 500)
$$;

-- People who appear in a company's log, for the filter.
create or replace function change_log_people(p_company uuid)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = vat_claims, public as $$
  select distinct s.changed_by, u.email::text
  from change_sets s join auth.users u on u.id = s.changed_by
  where s.company_id = p_company and member_role(p_company) = 'admin'
  order by 2
$$;

-- The rows one log entry changed (first 1,000), with the member's email for member and permission rows.
create or replace function change_log_rows(p_set bigint)
returns table (id bigint, tbl text, tab text, op text, row_key jsonb, old_row jsonb, new_row jsonb, subject_email text)
language sql stable security definer set search_path = vat_claims, public as $$
  select l.id, l.tbl, l.tab, l.op, l.row_key, l.old_row, l.new_row,
         case when l.tbl in ('company_members', 'company_member_permissions')
              then (select email::text from auth.users where id = (l.row_key->>'user_id')::uuid) end
  from change_log l
  join change_sets s on s.id = l.set_id
  where l.set_id = p_set and member_role(s.company_id) = 'admin'
  order by l.id
  limit 1000
$$;

-- Undo one log entry: put every row it changed back as it was, in reverse order. Refused when a row has
-- changed since (later changes must be undone first) or a document it would restore has been deleted.
-- The undo is itself a log entry and can be undone.
create or replace function undo_change_set(p_set bigint) returns bigint
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  s change_sets;
  r record;
  v_cols text;
  v_keys text;
  v_cur jsonb;
  v_blockers bigint[] := '{}';
  v_last bigint;
  v_new bigint;
begin
  select * into s from change_sets where id = p_set for update;
  if not found then
    raise exception 'Log entry % not found', p_set using errcode = 'P0002';
  end if;
  if member_role(s.company_id) is distinct from 'admin' then
    raise exception 'Only company admins can undo changes' using errcode = '42501';
  end if;
  if s.undone_by is not null then
    raise exception 'This change was already undone (log entry #%).', s.undone_by using errcode = '22023';
  end if;
  select max(id) into v_last from change_log where set_id = p_set;
  if v_last is null then
    raise exception 'This log entry has no row changes to undo.' using errcode = '22023';
  end if;

  -- Every row must still be as this change left it.
  for r in
    select distinct on (tbl, row_key) tbl, row_key, op, new_row
    from change_log where set_id = p_set order by tbl, row_key, id desc
  loop
    select string_agg(quote_ident(k), ', ') into v_keys from jsonb_object_keys(r.row_key) k;
    execute format('select to_jsonb(t) from vat_claims.%I t where (%s) = (select %s from jsonb_populate_record(null::vat_claims.%I, $1))',
                   r.tbl, v_keys, v_keys, r.tbl)
      into v_cur using r.row_key;
    if strip_meta(v_cur) is distinct from strip_meta(case when r.op = 'DELETE' then null else r.new_row end) then
      v_blockers := v_blockers || array(
        select distinct l.set_id from change_log l join change_sets x on x.id = l.set_id
        where l.tbl = r.tbl and l.row_key = r.row_key and l.id > v_last and l.set_id <> p_set and x.undone_by is null);
      if cardinality(v_blockers) = 0 then
        v_blockers := array[0::bigint];   -- changed outside the log (e.g. before it started)
      end if;
    end if;
  end loop;
  if cardinality(v_blockers) > 0 then
    if exists (select 1 from unnest(v_blockers) b where b > 0) then
      raise exception 'Later changes touched these rows: %. Undo those first.',
        (select string_agg('#' || b, ', ' order by b desc) from (select distinct unnest(v_blockers) b) d where b > 0)
        using errcode = '40001';
    end if;
    raise exception 'These rows have changed since, so this change cannot be undone.' using errcode = '40001';
  end if;

  -- Documents the undo would point at again must still exist.
  if exists (
    select 1 from change_log l
    cross join lateral (values (l.old_row->>'path'), (l.old_row->>'doc_path'), (l.old_row->>'other_doc_path'), (l.old_row->>'all_doc_path')) p(path)
    join archived_files a on a.path = p.path and a.purged_at is not null
    where l.set_id = p_set and l.op in ('UPDATE', 'DELETE')
  ) then
    raise exception 'A document this change removed or replaced was permanently deleted 30 days later, so it cannot be undone.'
      using errcode = '22023';
  end if;

  perform change_label('Undid #' || p_set || coalesce(': ' || s.label, ''), 'undo');
  perform set_config('vat_claims.undo_of', p_set::text, true);
  perform set_config('vat_claims.change_set', '', true);

  for r in select * from change_log where set_id = p_set order by id desc loop
    select string_agg(quote_ident(k), ', ') into v_keys from jsonb_object_keys(r.row_key) k;
    select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
    from pg_attribute
    where attrelid = format('vat_claims.%I', r.tbl)::regclass and attnum > 0 and not attisdropped and attgenerated = '';
    if r.op = 'INSERT' then
      execute format('delete from vat_claims.%I where (%s) = (select %s from jsonb_populate_record(null::vat_claims.%I, $1))',
                     r.tbl, v_keys, v_keys, r.tbl) using r.row_key;
    elsif r.op = 'DELETE' then
      execute format('insert into vat_claims.%I (%s) select %s from jsonb_populate_record(null::vat_claims.%I, $1)',
                     r.tbl, v_cols, v_cols, r.tbl) using r.old_row;
    else
      execute format('update vat_claims.%I set (%s) = (select %s from jsonb_populate_record(null::vat_claims.%I, $1)) '
                     || 'where (%s) = (select %s from jsonb_populate_record(null::vat_claims.%I, $2))',
                     r.tbl, v_cols, v_cols, r.tbl, v_keys, v_keys, r.tbl) using r.old_row, r.row_key;
    end if;
  end loop;

  if not exists (select 1 from company_members where company_id = s.company_id and role = 'admin') then
    raise exception 'Undoing this would leave the company without an admin.' using errcode = '42501';
  end if;

  v_new := nullif(split_part(current_setting('vat_claims.change_set', true), ':', 2), '')::bigint;
  if v_new is null then
    raise exception 'Nothing was changed.' using errcode = '22023';
  end if;
  update change_sets set undone_by = v_new, undone_at = now() where id = p_set;
  -- Undoing an undo brings the original change back.
  if s.undo_of is not null then
    update change_sets set undone_by = null, undone_at = null where id = s.undo_of;
  end if;
  perform set_config('vat_claims.undo_of', '', true);
  perform change_label(null, null);
  return v_new;
end $$;

-- Housekeeping, run by the app when an admin opens it: drops log entries older than 5 years and returns the
-- archived documents that have been unreferenced for 30 days, for the app to delete from storage.
create or replace function change_log_housekeeping(p_company uuid) returns setof text
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if member_role(p_company) is distinct from 'admin' then
    raise exception 'Only company admins can run housekeeping' using errcode = '42501';
  end if;
  delete from change_sets where company_id = p_company and changed_at < now() - interval '5 years';
  delete from archived_files where company_id = p_company and archived_at < now() - interval '5 years';
  return query
    select a.path from archived_files a
    where a.company_id = p_company and a.purged_at is null and a.archived_at < now() - interval '30 days'
      and not doc_referenced(a.path)
    order by a.archived_at
    limit 500;
end $$;

-- Record that the app deleted these archived files from storage.
create or replace function mark_files_purged(p_company uuid, p_paths text[]) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if member_role(p_company) is distinct from 'admin' then
    raise exception 'Only company admins can run housekeeping' using errcode = '42501';
  end if;
  update archived_files set purged_at = now()
  where company_id = p_company and path = any (p_paths) and purged_at is null and not doc_referenced(path);
end $$;

revoke execute on function log_change() from public, anon, authenticated;
revoke execute on function archive_doc_paths() from public, anon, authenticated;
revoke execute on function change_label(text, text) from public, anon, authenticated;
revoke execute on function change_log_list(uuid, bigint, int, text, uuid, date, date, text) from public, anon;
revoke execute on function change_log_people(uuid) from public, anon;
revoke execute on function change_log_rows(bigint) from public, anon;
revoke execute on function undo_change_set(bigint) from public, anon;
revoke execute on function change_log_housekeeping(uuid) from public, anon;
revoke execute on function mark_files_purged(uuid, text[]) from public, anon;
grant execute on function change_log_list(uuid, bigint, int, text, uuid, date, date, text) to authenticated;
grant execute on function change_log_people(uuid) to authenticated;
grant execute on function change_log_rows(bigint) to authenticated;
grant execute on function undo_change_set(bigint) to authenticated;
grant execute on function change_log_housekeeping(uuid) to authenticated;
grant execute on function mark_files_purged(uuid, text[]) to authenticated;
grant select on change_sets, change_log to authenticated;
revoke insert, update, delete on change_sets, change_log, archived_files from anon, authenticated;
revoke all on archived_files from anon, authenticated;

notify pgrst, 'reload schema';
