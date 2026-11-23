-- Registers. The Registers module is the one place the source registers are uploaded:
--   Import Register        customs import entries (CusDec lines), the existing customs_entries (direction import)
--   Export Register        Business Central export sales invoices and their item lines (new), plus the export
--                          CusDecs (customs_entries, direction export)
--   Local Sales Register   Business Central local sales invoices and their item lines (new)
--
-- VAT reads them: an uploaded export sales invoice adds or updates its row in export_sales (Export
-- reconciliation) with the invoice's FOB amount (product lines only, charge lines such as freight left out),
-- and the customs columns are filled from the export CusDecs as before (apply_customs). Rows that came from
-- the old monthly sales-report upload keep their figures; they are only linked to the register invoice.
--
-- Customs entries may be uploaded, edited and given documents from either Registers or the VAT tab of their
-- direction (customs_perm), so members keep the access they had.
set search_path = vat_claims, public;

-- ---------------------------------------------------------------------------------------------------------
-- 0023 replaced set_member_access from the 0014 text and so dropped the change-log label added in 0015.
-- Put it back, keeping 0023's per-tab actions.
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
           coalesce(r.can_upload, false) and tab_allows(r.tab, 'upload'),
           coalesce(r.can_edit, false) and tab_allows(r.tab, 'edit'),
           coalesce(r.can_delete, false) and tab_allows(r.tab, 'delete')
    from jsonb_to_recordset(coalesce(p_perms, '[]'::jsonb)) as r(tab text, can_upload boolean, can_edit boolean, can_delete boolean);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Customs entries: Registers tab or VAT tab of the direction.
create or replace function customs_reg_tab(p_direction text) returns text
language sql immutable as $$
  select case p_direction when 'export' then 'reg_exports' when 'import' then 'reg_imports' end
$$;

create or replace function customs_perm(c uuid, p_direction text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select coalesce(has_perm(c, customs_tab(p_direction), p_action), false)
      or coalesce(has_perm(c, customs_reg_tab(p_direction), p_action), false)
$$;
grant execute on function customs_reg_tab(text) to authenticated;
grant execute on function customs_perm(uuid, text, text) to authenticated;

drop policy if exists customs_entries_read on customs_entries;
drop policy if exists customs_entries_insert on customs_entries;
drop policy if exists customs_entries_update on customs_entries;
drop policy if exists customs_entries_delete on customs_entries;
create policy customs_entries_read on customs_entries for select using (customs_perm(company_id, direction, 'view'));
create policy customs_entries_insert on customs_entries for insert with check (customs_perm(company_id, direction, 'edit'));
create policy customs_entries_update on customs_entries for update
  using (customs_perm(company_id, direction, 'edit')) with check (customs_perm(company_id, direction, 'edit'));
create policy customs_entries_delete on customs_entries for delete using (customs_perm(company_id, direction, 'delete'));

-- As in 0017, with customs files under either tab.
create or replace function storage_perm(p_name text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select case
    when doc_company(p_name) is null then false
    when (storage.foldername(p_name))[2] = 'customs'
      then customs_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
    when (storage.foldername(p_name))[2] = 'invoices'
      then has_perm(doc_company(p_name), 'invoices', p_action)
    else doc_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
  end
$$;

-- As in 0019, checking upload (and delete when replacing) on either tab.
create or replace function upload_customs_entries(p_company uuid, p_direction text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = vat_claims, public as $$
declare v_replacing boolean;
begin
  if customs_tab(p_direction) is null then
    raise exception 'direction must be export or import' using errcode = '22023';
  end if;
  v_replacing := exists (
    select 1 from customs_entries e
    join jsonb_to_recordset(p_rows) as r(cusdec_no text, invoice_no text, cusdec_month text, to_complete boolean)
      on r.cusdec_no = e.cusdec_no
     and (e.invoice_no = coalesce(r.invoice_no, '')
          or (e.to_complete and not coalesce(r.to_complete, false) and e.cusdec_month is not distinct from r.cusdec_month))
    where e.company_id = p_company and e.direction = p_direction);
  if not customs_perm(p_company, p_direction, 'upload') then
    raise exception 'You do not have upload permission on this tab.' using errcode = '42501';
  end if;
  if v_replacing and not customs_perm(p_company, p_direction, 'delete') then
    raise exception 'Data is already held for this upload. Replacing it needs delete permission on this tab.'
      using errcode = '42501';
  end if;
  perform change_label(
    'Uploaded ' || (select count(distinct (r.cusdec_no, r.invoice_no))
                    from jsonb_to_recordset(p_rows) as r(cusdec_no text, invoice_no text))
      || ' ' || p_direction || ' CusDec(s)', 'upload');
  return replace_customs_entries(p_company, p_direction, p_rows);
end $$;
revoke execute on function upload_customs_entries(uuid, text, jsonb) from public, anon;
grant execute on function upload_customs_entries(uuid, text, jsonb) to authenticated;

-- As in 0016, checking either tab.
create or replace function set_customs_document(p_company uuid, p_direction text, p_cusdec_no text, p_invoice_no text,
                                                p_kind text, p_path text, p_name text) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
declare held text;
begin
  if customs_tab(p_direction) is null or p_kind not in ('cusdec', 'invoice', 'other', 'all') then
    raise exception 'Unknown customs document slot' using errcode = '22023';
  end if;
  if p_path is not null and p_path not like p_company::text || '/customs/' || p_direction || '/%' then
    raise exception 'Document path does not belong to this company and direction' using errcode = '22023';
  end if;
  select case p_kind when 'cusdec' then doc_path when 'invoice' then invoice_doc_path when 'other' then other_doc_path else all_doc_path end into held
  from customs_entries
  where company_id = p_company and direction = p_direction and cusdec_no = p_cusdec_no and invoice_no = p_invoice_no
  order by item_no limit 1;
  if not found then
    raise exception 'No customs entry for CusDec % and invoice %', p_cusdec_no, p_invoice_no using errcode = 'P0002';
  end if;
  if p_path is not null and not customs_perm(p_company, p_direction, 'upload') then
    raise exception 'You do not have upload permission on this tab.' using errcode = '42501';
  end if;
  if (p_path is null or held is not null) and not customs_perm(p_company, p_direction, 'delete') then
    raise exception 'Replacing or removing a document needs delete permission on this tab.' using errcode = '42501';
  end if;
  perform change_label(
    case when p_path is null then 'Removed' when held is null then 'Attached' else 'Replaced' end || ' the '
      || case p_kind when 'cusdec' then 'CusDec' when 'invoice' then 'commercial invoice' when 'other' then 'other documents' else 'all documents' end
      || ' file of CusDec ' || p_cusdec_no || ' (invoice ' || p_invoice_no || ')', 'document');
  update customs_entries set
    doc_path              = case when p_kind = 'cusdec' then p_path else doc_path end,
    doc_name              = case when p_kind = 'cusdec' then p_name else doc_name end,
    doc_uploaded_at       = case when p_kind = 'cusdec' then case when p_path is null then null else now() end else doc_uploaded_at end,
    invoice_doc_path        = case when p_kind = 'invoice' then p_path else invoice_doc_path end,
    invoice_doc_name        = case when p_kind = 'invoice' then p_name else invoice_doc_name end,
    invoice_doc_uploaded_at = case when p_kind = 'invoice' then case when p_path is null then null else now() end else invoice_doc_uploaded_at end,
    other_doc_path        = case when p_kind = 'other' then p_path else other_doc_path end,
    other_doc_name        = case when p_kind = 'other' then p_name else other_doc_name end,
    other_doc_uploaded_at = case when p_kind = 'other' then case when p_path is null then null else now() end else other_doc_uploaded_at end,
    all_doc_path          = case when p_kind = 'all' then p_path else all_doc_path end,
    all_doc_name          = case when p_kind = 'all' then p_name else all_doc_name end,
    all_doc_uploaded_at   = case when p_kind = 'all' then case when p_path is null then null else now() end else all_doc_uploaded_at end
  where company_id = p_company and direction = p_direction and cusdec_no = p_cusdec_no and invoice_no = p_invoice_no;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Sales invoices from Business Central: Export or Local, one row per invoice, with its item lines.
create or replace function sales_tab(p_type text) returns text
language sql immutable as $$
  select case p_type when 'Export' then 'reg_exports' when 'Local' then 'reg_local' end
$$;
grant execute on function sales_tab(text) to authenticated;

create table if not exists sales_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  type text not null check (type in ('Export', 'Local')),
  invoice_no text not null,
  invoice_date date,
  customer text,
  currency text,                                   -- as in the file (USD, EUR, ...); blank = not given
  ex_rate numeric(18,6),                           -- from the file, else LKR / FC of the lines
  order_no text,
  export_cusdec text,                              -- export entry (E) no. when the file carries it
  -- Totals, kept by the upload from the lines. FOB = product lines only (charge lines left out).
  amount_fc numeric(18,2) not null default 0,
  amount_lkr numeric(18,2) not null default 0,
  fob_fc numeric(18,2) not null default 0,
  fob_lkr numeric(18,2) not null default 0,
  line_count int not null default 0,
  source text,                                     -- Business Central, Accsoft, ...
  file_name text,
  void_ref text,                                   -- credit memo that cancelled the invoice
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id),
  unique (company_id, type, invoice_no)
);
create index if not exists sales_invoices_company_date on sales_invoices (company_id, type, invoice_date);

create table if not exists sales_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references sales_invoices (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  type text not null check (type in ('Export', 'Local')),
  line_no int not null,
  line_date date,
  item_code text,
  description text,
  qty numeric(18,3),                               -- in uom (lb converted to kg)
  uom text,
  qty_in numeric(18,3),                            -- as written in the file
  uom_in text,
  boxes numeric(18,2),
  gross numeric(18,3),
  unit_price numeric(18,4),
  amount_fc numeric(18,2) not null default 0,
  amount_lkr numeric(18,2) not null default 0,
  is_charge boolean not null default false,        -- freight, insurance and other charges: not in FOB
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id),
  unique (invoice_id, line_no)
);
create index if not exists sales_invoice_lines_company on sales_invoice_lines (company_id, type);

alter table sales_invoices enable row level security;
alter table sales_invoice_lines enable row level security;
do $$ declare t text; begin
  foreach t in array array['sales_invoices', 'sales_invoice_lines'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for select using (has_perm(company_id, sales_tab(type), ''view''))', t || '_read', t);
    execute format('create policy %I on %I for insert with check (has_perm(company_id, sales_tab(type), ''edit''))', t || '_insert', t);
    execute format('create policy %I on %I for update using (has_perm(company_id, sales_tab(type), ''edit'')) with check (has_perm(company_id, sales_tab(type), ''edit''))', t || '_update', t);
    execute format('create policy %I on %I for delete using (has_perm(company_id, sales_tab(type), ''delete''))', t || '_delete', t);
  end loop;
end $$;
grant select, insert, update, delete on sales_invoices, sales_invoice_lines to authenticated;
grant all on sales_invoices, sales_invoice_lines to service_role;

-- Export reconciliation rows know the register invoice they came from. from_register: the row was added by
-- the register and follows it; otherwise it came from the old monthly upload and keeps its own figures.
alter table export_sales add column if not exists sales_invoice_id uuid references sales_invoices (id) on delete set null;
alter table export_sales add column if not exists from_register boolean not null default false;

-- ---------------------------------------------------------------------------------------------------------
-- Change log: the new tables under their Registers tab. As in 0020, plus the two sales tables.
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
    when 'schedule_submissions' then 'submissions'
    when 'sales_invoices' then coalesce(sales_tab(v_row->>'type'), 'reg_exports')
    when 'sales_invoice_lines' then coalesce(sales_tab(v_row->>'type'), 'reg_exports')
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

drop trigger if exists log_change on sales_invoices;
create trigger log_change after insert or update or delete on sales_invoices
  for each row execute function log_change('id');
drop trigger if exists log_change on sales_invoice_lines;
create trigger log_change after insert or update or delete on sales_invoice_lines
  for each row execute function log_change('id');

-- ---------------------------------------------------------------------------------------------------------
-- Totals of an invoice from its lines. Exchange rate: the file's, else LKR / FC of the lines.
create or replace function sales_invoice_totals(p_ids uuid[]) returns void
language sql security definer set search_path = vat_claims, public as $$
  update sales_invoices i set
    amount_fc = t.amount_fc, amount_lkr = t.amount_lkr, fob_fc = t.fob_fc, fob_lkr = t.fob_lkr, line_count = t.n,
    ex_rate = coalesce(i.ex_rate, case when t.amount_fc <> 0 then round(t.amount_lkr / t.amount_fc, 6) end)
  from (
    select i2.id,
           coalesce(sum(l.amount_fc), 0) as amount_fc,
           coalesce(sum(l.amount_lkr), 0) as amount_lkr,
           coalesce(sum(l.amount_fc) filter (where not l.is_charge), 0) as fob_fc,
           coalesce(sum(l.amount_lkr) filter (where not l.is_charge), 0) as fob_lkr,
           count(l.id)::int as n
    from sales_invoices i2 left join sales_invoice_lines l on l.invoice_id = i2.id
    where i2.id = any (p_ids)
    group by i2.id
  ) t
  where i.id = t.id
    and (i.amount_fc, i.amount_lkr, i.fob_fc, i.fob_lkr, i.line_count) is distinct from (t.amount_fc, t.amount_lkr, t.fob_fc, t.fob_lkr, t.n)
$$;

-- Export reconciliation from export sales invoices. A reconciliation row is found by invoice number in any
-- month (the user may have moved it). Rows the register added follow the invoice; rows from the old monthly
-- upload are only linked. Invoices without a reconciliation row get one in their invoice month.
-- Returns the number of rows added or updated.
create or replace function sync_export_sales(p_company uuid, p_ids uuid[]) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare n int := 0; m int;
begin
  -- Link existing rows to their register invoice.
  update export_sales s set sales_invoice_id = i.id
  from sales_invoices i
  where i.id = any (p_ids) and i.type = 'Export' and i.company_id = p_company and s.company_id = p_company
    and norm_doc_no(s.invoice_no) = norm_doc_no(i.invoice_no)
    and s.sales_invoice_id is distinct from i.id;
  -- Rows the register added follow its figures.
  update export_sales s set
    amount_fc = i.fob_fc,
    net_sales = i.fob_lkr,
    ex_rate = case when i.fob_fc <> 0 then round(i.fob_lkr / i.fob_fc, 6) else i.ex_rate end,
    updated_at = now(), updated_by = auth.uid()
  from sales_invoices i
  where s.sales_invoice_id = i.id and s.from_register and i.id = any (p_ids) and i.void_ref is null
    and (s.amount_fc, s.net_sales, s.ex_rate) is distinct from
        (i.fob_fc, i.fob_lkr, case when i.fob_fc <> 0 then round(i.fob_lkr / i.fob_fc, 6) else i.ex_rate end);
  get diagnostics m = row_count;
  n := n + m;
  -- New rows for invoices not yet in the reconciliation.
  insert into export_sales (company_id, sales_month, invoice_no, amount_fc, ex_rate, net_sales, currency_type,
                            sales_invoice_id, from_register, created_by)
  select p_company, date_trunc('month', i.invoice_date)::date, i.invoice_no, i.fob_fc,
         case when i.fob_fc <> 0 then round(i.fob_lkr / i.fob_fc, 6) else i.ex_rate end,
         i.fob_lkr,
         case when upper(i.currency) in ('USD', 'EUR') then upper(i.currency) else 'USD' end,
         i.id, true, auth.uid()
  from sales_invoices i
  where i.id = any (p_ids) and i.type = 'Export' and i.company_id = p_company and i.void_ref is null
    and i.invoice_date is not null
    and not exists (select 1 from export_sales s
                    where s.company_id = p_company and norm_doc_no(s.invoice_no) = norm_doc_no(i.invoice_no))
  on conflict (company_id, sales_month, invoice_no) do nothing;
  get diagnostics m = row_count;
  n := n + m;
  if n > 0 then
    perform apply_customs(p_company, 'export');
  end if;
  return n;
end $$;

-- Upload sales invoices. p_rows: [{invoice_no, invoice_date, customer, currency, ex_rate, order_no,
-- export_cusdec, source, lines: [{line_no, line_date, item_code, description, qty, uom, qty_in, uom_in, boxes,
-- gross, unit_price, amount_fc, amount_lkr, is_charge}]}]. An invoice already held is updated, not duplicated:
-- its header fields the file leaves blank are kept and its lines are replaced, which needs delete permission
-- as well as upload. Returns {"invoices", "added", "updated", "lines", "reconciliation"}.
create or replace function upload_sales_invoices(p_company uuid, p_type text, p_file_name text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  r jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_added int := 0;
  v_lines int := 0;
  v_existed boolean;
  v_max int;
  v_sync int := 0;
begin
  if sales_tab(p_type) is null then
    raise exception 'type must be Export or Local' using errcode = '22023';
  end if;
  perform require_upload(p_company, sales_tab(p_type), exists (
    select 1 from sales_invoices i
    join jsonb_array_elements(p_rows) as x(j) on i.invoice_no = trim(x.j->>'invoice_no')
    where i.company_id = p_company and i.type = p_type));
  perform change_label('Uploaded ' || jsonb_array_length(p_rows) || ' ' || lower(p_type) || ' sales invoice(s)', 'upload');

  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(r->>'invoice_no'), '') = '' then
      continue;
    end if;
    v_existed := exists (select 1 from sales_invoices
                         where company_id = p_company and type = p_type and invoice_no = trim(r->>'invoice_no'));
    insert into sales_invoices as i (company_id, type, invoice_no, invoice_date, customer, currency, ex_rate, order_no,
                                     export_cusdec, source, file_name, created_by)
    values (p_company, p_type, trim(r->>'invoice_no'), nullif(r->>'invoice_date', '')::date, nullif(trim(r->>'customer'), ''),
            nullif(upper(trim(r->>'currency')), ''), nullif(r->>'ex_rate', '')::numeric, nullif(trim(r->>'order_no'), ''),
            nullif(trim(r->>'export_cusdec'), ''), nullif(trim(r->>'source'), ''), p_file_name, auth.uid())
    on conflict (company_id, type, invoice_no) do update set
      invoice_date = coalesce(excluded.invoice_date, i.invoice_date),
      customer = coalesce(excluded.customer, i.customer),
      currency = coalesce(excluded.currency, i.currency),
      ex_rate = coalesce(excluded.ex_rate, i.ex_rate),
      order_no = coalesce(excluded.order_no, i.order_no),
      export_cusdec = coalesce(excluded.export_cusdec, i.export_cusdec),
      source = coalesce(excluded.source, i.source),
      file_name = excluded.file_name,
      updated_at = now(), updated_by = auth.uid()
    returning id into v_id;
    if not v_existed then
      v_added := v_added + 1;
    end if;
    v_ids := v_ids || v_id;

    -- Lines by line number: unchanged lines stay as they are (and out of the log), extra old lines go.
    insert into sales_invoice_lines as l (invoice_id, company_id, type, line_no, line_date, item_code, description, qty, uom,
                                          qty_in, uom_in, boxes, gross, unit_price, amount_fc, amount_lkr, is_charge, created_by)
    select v_id, p_company, p_type, x.line_no, x.line_date, nullif(trim(x.item_code), ''), nullif(trim(x.description), ''),
           x.qty, nullif(trim(x.uom), ''), x.qty_in, nullif(trim(x.uom_in), ''), x.boxes, x.gross, x.unit_price,
           coalesce(x.amount_fc, 0), coalesce(x.amount_lkr, 0), coalesce(x.is_charge, false), auth.uid()
    from jsonb_to_recordset(coalesce(r->'lines', '[]'::jsonb)) as x(
      line_no int, line_date date, item_code text, description text, qty numeric, uom text, qty_in numeric, uom_in text,
      boxes numeric, gross numeric, unit_price numeric, amount_fc numeric, amount_lkr numeric, is_charge boolean)
    on conflict (invoice_id, line_no) do update set
      line_date = excluded.line_date, item_code = excluded.item_code, description = excluded.description,
      qty = excluded.qty, uom = excluded.uom, qty_in = excluded.qty_in, uom_in = excluded.uom_in,
      boxes = excluded.boxes, gross = excluded.gross, unit_price = excluded.unit_price,
      amount_fc = excluded.amount_fc, amount_lkr = excluded.amount_lkr,
      -- A charge flag set by hand is kept when the file says nothing new about the line.
      is_charge = excluded.is_charge or l.is_charge,
      updated_at = now(), updated_by = auth.uid();
    v_max := jsonb_array_length(coalesce(r->'lines', '[]'::jsonb));
    v_lines := v_lines + v_max;
    delete from sales_invoice_lines where invoice_id = v_id and line_no > v_max;
  end loop;

  perform sales_invoice_totals(v_ids);
  if p_type = 'Export' then
    v_sync := sync_export_sales(p_company, v_ids);
  end if;
  return jsonb_build_object('invoices', cardinality(v_ids), 'added', v_added, 'updated', cardinality(v_ids) - v_added,
                            'lines', v_lines, 'reconciliation', v_sync);
end $$;

-- Mark a line as a charge (left out of FOB) or not, then refresh the totals and Export reconciliation.
create or replace function set_sales_line_charge(p_line uuid, p_charge boolean) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
declare l sales_invoice_lines;
begin
  select * into l from sales_invoice_lines where id = p_line;
  if not found then
    raise exception 'Line not found' using errcode = 'P0002';
  end if;
  if not has_perm(l.company_id, sales_tab(l.type), 'edit') then
    raise exception 'You do not have edit permission on this tab.' using errcode = '42501';
  end if;
  perform change_label(
    (case when p_charge then 'Marked a charge line on ' else 'Marked a product line on ' end)
      || (select invoice_no from sales_invoices where id = l.invoice_id), 'edit');
  update sales_invoice_lines set is_charge = p_charge, updated_at = now(), updated_by = auth.uid() where id = p_line;
  perform sales_invoice_totals(array[l.invoice_id]);
  if l.type = 'Export' then
    perform sync_export_sales(l.company_id, array[l.invoice_id]);
  end if;
end $$;

revoke execute on function sales_invoice_totals(uuid[]) from public, anon, authenticated;
revoke execute on function sync_export_sales(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function upload_sales_invoices(uuid, text, text, jsonb) from public, anon;
revoke execute on function set_sales_line_charge(uuid, boolean) from public, anon;
grant execute on function upload_sales_invoices(uuid, text, text, jsonb) to authenticated;
grant execute on function set_sales_line_charge(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
