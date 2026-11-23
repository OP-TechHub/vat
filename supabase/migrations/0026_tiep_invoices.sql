-- TIEP invoices and MUDs. The Exports and Local Sales registers inside TIEP work on the Registers' sales
-- invoices (sales_invoices): TIEP adds its own fields per invoice (tiep_invoice_ext: packing-list details,
-- documents, export E no., yield overrides, group) and a Material Utilization Declaration per invoice or per
-- group of invoices (tiep_muds). Saving a MUD reserves the import quantities (Planned postings); recording the
-- customs write-off posts them Completed. Also: local-sales batch saving, documents, MUD lines on file and the
-- TIEP logbook (for the logbook check), and files under <company>/tiep/ in the vat-claims bucket.
set search_path = vat_claims, public;

-- TIEP readers see the sales invoices and lines.
drop policy if exists sales_invoices_read on sales_invoices;
create policy sales_invoices_read on sales_invoices for select
  using (has_perm(company_id, sales_tab(type), 'view') or tiep_view(company_id));
drop policy if exists sales_invoice_lines_read on sales_invoice_lines;
create policy sales_invoice_lines_read on sales_invoice_lines for select
  using (has_perm(company_id, sales_tab(type), 'view') or tiep_view(company_id));

-- Edit rights on TIEP invoices: the TIEP register tab of the invoice type.
create or replace function tiep_inv_tab(p_type text) returns text
language sql immutable as $$ select case p_type when 'Local' then 'tiep_local' else 'tiep_exports' end $$;
create or replace function tiep_inv_can(c uuid, p_action text) returns boolean
language sql stable security definer set search_path = vat_claims, public as $$
  select tiep_can(c, 'tiep_exports', p_action) or tiep_can(c, 'tiep_local', p_action)
$$;
grant execute on function tiep_inv_tab(text) to authenticated;
grant execute on function tiep_inv_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
create table if not exists tiep_muds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'group')),
  type text not null default 'Export' check (type in ('Export', 'Local')),
  sales_invoice_id uuid unique references sales_invoices (id) on delete cascade,  -- kind invoice
  group_name text,                                 -- kind group
  member_ids uuid[] not null default '{}',         -- kind group: its sales invoices
  group_date date,
  status text not null default 'draft' check (status in ('draft', 'saved', 'cancelled')),
  prop_alloc jsonb,                                -- allocation kept while not saved: [{label, alloc: [{key, qty, liab, liabSet}]}]
  prop_at timestamptz,
  mud jsonb,                                       -- saved MUD: ref, office, product, hs, qty, whole, fcr, rows1, claims, std, savedAt, savedBy
  mudx jsonb,                                      -- printed overrides: ref, office, product, hs, desc{}, item{}
  writeoff jsonb,                                  -- date, total, lines, recordedAt, by
  docs jsonb not null default '{}'::jsonb,         -- mudSigned, writeoff: {path, name, size, at}
  withdrawn_at timestamptz,
  legacy_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id),
  check ((kind = 'invoice') = (sales_invoice_id is not null))
);

create table if not exists tiep_invoice_ext (
  sales_invoice_id uuid primary key references sales_invoices (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  export_e text,                                   -- export entry (E) no. of the invoice
  export_e_src text,
  yov jsonb,                                       -- {TIEP item: yield used instead of the standard's}
  pl jsonb,                                        -- packing list / commercial invoice header: consignee, vessel, bl, container …
  pl_rows jsonb,                                   -- packing list rows: [{desc, boxes, net, gross, bbd, boxRange, price, amount}]
  docs jsonb not null default '{}'::jsonb,         -- invoice, packing, cusdec, other: {path, name, size, at}
  group_id uuid references tiep_muds (id) on delete set null,
  rec_links jsonb,                                 -- TIEP logbook records this invoice matches
  cancelled_via text,                              -- logbook: already cancelled in the TIEP logbook
  legacy_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id)
);

alter table tiep_cancellations add column if not exists mud_id uuid references tiep_muds (id) on delete set null;
create index if not exists tiep_cancellations_mud on tiep_cancellations (mud_id);

create table if not exists tiep_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  title text not null,
  kind text not null default 'Other' check (kind in ('TIEP approval', 'Customs letter', 'Bank guarantee', 'Other')),
  doc_date date,
  valid_from date,
  valid_to date,
  ref text,
  std_id uuid references tiep_standards (id) on delete set null,
  notes text,
  path text,
  file_name text,
  size bigint,
  legacy_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id)
);

-- MUD lines on file (previous MUD forms), to compare item mappings and yields with.
create table if not exists tiep_mudhist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  mud text not null,
  inv_no text,
  export_e text,
  mud_date date,
  code text,
  qty numeric(18,3),
  mud_desc text,
  yield_printed numeric(10,4),
  yield_used numeric(10,4),
  notes text,
  src text,
  legacy_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id)
);

-- TIEP logbook (customs' record), loaded from the TIEP app, for the logbook check.
create table if not exists tiep_logbook_summary (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  cd text not null,                                -- import CusDec
  cd_date date,
  reg text,
  qty numeric(18,3),
  used numeric(18,3),
  bal numeric(18,3),
  liab numeric(18,2),
  bal_liab numeric(18,2),
  import_keys jsonb not null default '[]'::jsonb,  -- [{cusdec_no, invoice_no, item_no}] lines of the register it covers
  note text,
  created_at timestamptz not null default now()
);
create table if not exists tiep_logbook_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  area text not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table tiep_settings add column if not exists logbook_totals jsonb;     -- balLiab, guarantee, excess, totalLiab, source, loadedAt

-- ---------------------------------------------------------------------------------------------------------
alter table tiep_muds enable row level security;
alter table tiep_invoice_ext enable row level security;
alter table tiep_documents enable row level security;
alter table tiep_mudhist enable row level security;
alter table tiep_logbook_summary enable row level security;
alter table tiep_logbook_findings enable row level security;

do $$ declare t record; begin
  for t in select * from (values
    ('tiep_muds', 'inv'), ('tiep_invoice_ext', 'inv'),
    ('tiep_documents', 'tiep_settings'), ('tiep_mudhist', 'tiep_settings'),
    ('tiep_logbook_summary', 'tiep_status'), ('tiep_logbook_findings', 'tiep_status')
  ) as v(tbl, tab) loop
    execute format('drop policy if exists %I on %I', t.tbl || '_read', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_insert', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_update', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_delete', t.tbl);
    execute format('create policy %I on %I for select using (tiep_view(company_id))', t.tbl || '_read', t.tbl);
    if t.tab = 'inv' then
      execute format('create policy %I on %I for insert with check (tiep_inv_can(company_id, ''edit''))', t.tbl || '_insert', t.tbl);
      execute format('create policy %I on %I for update using (tiep_inv_can(company_id, ''edit'')) with check (tiep_inv_can(company_id, ''edit''))', t.tbl || '_update', t.tbl);
      execute format('create policy %I on %I for delete using (tiep_inv_can(company_id, ''delete''))', t.tbl || '_delete', t.tbl);
    else
      execute format('create policy %I on %I for insert with check (tiep_can(company_id, %L, ''edit''))', t.tbl || '_insert', t.tbl, t.tab);
      execute format('create policy %I on %I for update using (tiep_can(company_id, %L, ''edit'')) with check (tiep_can(company_id, %L, ''edit''))', t.tbl || '_update', t.tbl, t.tab, t.tab);
      execute format('create policy %I on %I for delete using (tiep_can(company_id, %L, ''delete''))', t.tbl || '_delete', t.tbl, t.tab);
    end if;
    execute format('grant select, insert, update, delete on %I to authenticated', t.tbl);
    execute format('grant all on %I to service_role', t.tbl);
  end loop;
end $$;

-- Files: <company>/tiep/invoices/… and <company>/tiep/muds/… belong to the TIEP invoice tabs,
-- <company>/tiep/documents/… to TIEP Settings. As in 0024 otherwise.
create or replace function storage_perm(p_name text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select case
    when doc_company(p_name) is null then false
    when (storage.foldername(p_name))[2] = 'tiep' then
      case when p_action = 'view' then tiep_view(doc_company(p_name))
           when (storage.foldername(p_name))[3] = 'documents' then tiep_can(doc_company(p_name), 'tiep_settings', p_action)
           else tiep_inv_can(doc_company(p_name), p_action) end
    when (storage.foldername(p_name))[2] = 'customs'
      then customs_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
    when (storage.foldername(p_name))[2] = 'invoices'
      then has_perm(doc_company(p_name), 'invoices', p_action)
    else doc_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
  end
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Change log: the new tables. As in 0025, plus these.
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
    when 'tiep_import_ext' then 'tiep_register'
    when 'tiep_cancellations' then 'tiep_ledger'
    when 'tiep_batches' then 'tiep_status'
    when 'tiep_standards' then 'tiep_settings'
    when 'tiep_skumap' then 'tiep_settings'
    when 'tiep_settings' then 'tiep_settings'
    when 'tiep_muds' then tiep_inv_tab(v_row->>'type')
    when 'tiep_invoice_ext' then 'tiep_exports'
    when 'tiep_documents' then 'tiep_settings'
    when 'tiep_mudhist' then 'tiep_settings'
    else 'members'
  end;
  if v_cur like v_company::text || ':%' then
    v_set := split_part(v_cur, ':', 2)::bigint;
  end if;
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
    ('tiep_muds', 'id'), ('tiep_invoice_ext', 'sales_invoice_id'), ('tiep_documents', 'id'), ('tiep_mudhist', 'id')
  ) as v(tbl, key) loop
    execute format('drop trigger if exists log_change on %I', t.tbl);
    execute format('create trigger log_change after insert or update or delete on %I for each row execute function log_change(%L)', t.tbl, t.key);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Write the postings of a MUD: its earlier rows go, then p_allocs are checked against the free balance and
-- inserted with p_status. p_allocs: [{cusdec_no, invoice_no, item_no, qty, liab, label, hs, ratio, ratio_text}].
-- p_head: {ref, type, posting_date, exp_inv, exp_cusdec, product, exp_qty, cancel_cusdec, cancel_date, remarks}.
create or replace function tiep_write_mud_rows(p_company uuid, p_mud uuid, p_status text, p_head jsonb, p_allocs jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare a record; ce customs_entries; x tiep_import_ext; v_free numeric; v_n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('tiep_post:' || p_company::text));
  delete from tiep_cancellations where company_id = p_company and mud_id = p_mud;
  for a in select * from jsonb_to_recordset(coalesce(p_allocs, '[]'::jsonb)) as r(cusdec_no text, invoice_no text, item_no int,
             qty numeric, liab numeric, label text, hs text, ratio numeric, ratio_text text) loop
    if coalesce(a.qty, 0) <= 0 then continue; end if;
    select * into ce from customs_entries
    where company_id = p_company and direction = 'import' and cusdec_no = a.cusdec_no
      and invoice_no = coalesce(a.invoice_no, '') and item_no = coalesce(a.item_no, 1);
    if not found then
      raise exception 'Import line % item % is not in the Import Register', a.cusdec_no, a.item_no using errcode = 'P0002';
    end if;
    select * into x from tiep_import_ext
    where company_id = p_company and cusdec_no = ce.cusdec_no and invoice_no = ce.invoice_no and item_no = ce.item_no;
    v_free := tiep_line_free(p_company, ce.cusdec_no, ce.invoice_no, ce.item_no);
    if a.qty > v_free + 0.00005 then
      raise exception 'More than the balance on import line % item % (free %, asked %).', ce.cusdec_no, ce.item_no,
        round(v_free, 4), a.qty using errcode = '22023';
    end if;
    v_n := v_n + 1;
    insert into tiep_cancellations (company_id, ref, seq, type, status, posting_date, exp_inv, exp_cusdec, product, exp_qty,
                                    ratio, ratio_text, remarks, mode, cusdec_no, invoice_no, item_no, grp, uom, qty, item,
                                    cancel_cusdec, cancel_date, hs, duty, source, sales_invoice_id, mud_id, posted_by, created_by)
    values (p_company, p_head->>'ref', v_n, case when p_head->>'type' = 'Local' then 'local' else 'export' end, p_status,
            nullif(p_head->>'posting_date', '')::date, nullif(p_head->>'exp_inv', ''), nullif(p_head->>'exp_cusdec', ''),
            nullif(p_head->>'product', ''), nullif(p_head->>'exp_qty', '')::numeric, a.ratio, a.ratio_text,
            nullif(p_head->>'remarks', ''), 'mud', ce.cusdec_no, ce.invoice_no, ce.item_no, x.grp, ce.uom, round(a.qty, 4),
            coalesce(a.label, ce.description), nullif(p_head->>'cancel_cusdec', ''), nullif(p_head->>'cancel_date', '')::date,
            coalesce(a.hs, ce.hs_code), round(coalesce(a.liab, 0), 2), 'mud', nullif(p_head->>'sales_invoice_id', '')::uuid,
            p_mud, auth.uid(), auth.uid());
  end loop;
  return v_n;
end $$;
revoke execute on function tiep_write_mud_rows(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- Save a MUD: reserve its quantities (Planned postings) and keep the MUD as saved.
create or replace function tiep_save_mud(p_company uuid, p_mud uuid, p_doc jsonb, p_head jsonb, p_allocs jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare m tiep_muds; n int;
begin
  select * into m from tiep_muds where id = p_mud and company_id = p_company for update;
  if not found then raise exception 'MUD not found' using errcode = 'P0002'; end if;
  if not tiep_can(p_company, tiep_inv_tab(m.type), 'edit') then
    raise exception 'You do not have edit permission on this TIEP register.' using errcode = '42501';
  end if;
  if m.status = 'cancelled' then raise exception 'This MUD is already cancelled with customs.' using errcode = '22023'; end if;
  perform change_label('Saved MUD ' || coalesce(p_doc->>'ref', p_head->>'ref'), 'edit');
  n := tiep_write_mud_rows(p_company, p_mud, 'Planned', p_head, p_allocs);
  update tiep_muds set status = 'saved', mud = p_doc, prop_alloc = null, updated_at = now(), updated_by = auth.uid() where id = p_mud;
  return n;
end $$;

-- Withdraw a saved MUD: its reservations go and it is back in the FIFO queue.
create or replace function tiep_withdraw_mud(p_company uuid, p_mud uuid) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare m tiep_muds; n int;
begin
  select * into m from tiep_muds where id = p_mud and company_id = p_company for update;
  if not found then raise exception 'MUD not found' using errcode = 'P0002'; end if;
  if not tiep_can(p_company, tiep_inv_tab(m.type), 'edit') then
    raise exception 'You do not have edit permission on this TIEP register.' using errcode = '42501';
  end if;
  if m.status <> 'saved' then raise exception 'Only a saved MUD can be withdrawn.' using errcode = '22023'; end if;
  perform change_label('Withdrew MUD ' || coalesce(m.mud->>'ref', ''), 'edit');
  delete from tiep_cancellations where company_id = p_company and mud_id = p_mud and status = 'Planned';
  get diagnostics n = row_count;
  update tiep_muds set status = 'draft', mud = null, withdrawn_at = now(), updated_at = now(), updated_by = auth.uid() where id = p_mud;
  return n;
end $$;

-- Record the customs write-off of a MUD: its postings become the written-off lines, Completed.
create or replace function tiep_record_writeoff(p_company uuid, p_mud uuid, p_writeoff jsonb, p_head jsonb, p_allocs jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare m tiep_muds; n int;
begin
  select * into m from tiep_muds where id = p_mud and company_id = p_company for update;
  if not found then raise exception 'MUD not found' using errcode = 'P0002'; end if;
  if not tiep_can(p_company, tiep_inv_tab(m.type), 'edit') then
    raise exception 'You do not have edit permission on this TIEP register.' using errcode = '42501';
  end if;
  if m.status = 'draft' then raise exception 'Save the MUD before recording its cancellation.' using errcode = '22023'; end if;
  perform change_label('Recorded customs cancellation of MUD ' || coalesce(m.mud->>'ref', ''), 'edit');
  n := tiep_write_mud_rows(p_company, p_mud, 'Completed', p_head, p_allocs);
  update tiep_muds set status = 'cancelled', writeoff = p_writeoff,
    docs = case when p_writeoff ? 'doc' and p_writeoff->'doc' <> 'null'::jsonb then docs || jsonb_build_object('writeoff', p_writeoff->'doc') else docs end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_mud;
  return n;
end $$;

-- Save a local-sales batch (p_id null = new) and copy its customs entry, date and status to its postings.
create or replace function tiep_save_batch(p_company uuid, p_id uuid, p_batch jsonb) returns uuid
language plpgsql security definer set search_path = vat_claims, public as $$
declare v_id uuid := p_id; b tiep_batches;
begin
  if not tiep_can(p_company, 'tiep_status', 'edit') then
    raise exception 'You do not have edit permission on TIEP Status.' using errcode = '42501';
  end if;
  if coalesce(trim(p_batch->>'name'), '') = '' then raise exception 'Enter the batch name' using errcode = '22023'; end if;
  perform change_label(case when p_id is null then 'Added local-sales batch ' else 'Updated local-sales batch ' end || (p_batch->>'name'), 'edit');
  if v_id is null then
    insert into tiep_batches (company_id, name, ref, created_by)
    values (p_company, trim(p_batch->>'name'),
            coalesce(nullif(trim(p_batch->>'ref'), ''),
                     'LB-' || lpad((coalesce((select max(substring(ref from '^LB-(\d+)$')::int) from tiep_batches where company_id = p_company), 0) + 1)::text, 4, '0')),
            auth.uid())
    returning id into v_id;
  end if;
  update tiep_batches set
    name = trim(p_batch->>'name'),
    start_date = nullif(p_batch->>'start_date', '')::date,
    end_date = nullif(p_batch->>'end_date', '')::date,
    sold_qty = nullif(p_batch->>'sold_qty', '')::numeric,
    duty_amount = nullif(p_batch->>'duty_amount', '')::numeric,
    status = coalesce(nullif(p_batch->>'status', ''), status),
    cancel_cusdec = nullif(trim(p_batch->>'cancel_cusdec'), ''),
    cancel_date = nullif(p_batch->>'cancel_date', '')::date,
    notes = nullif(trim(p_batch->>'notes'), ''),
    updated_at = now(), updated_by = auth.uid()
  where id = v_id and company_id = p_company
  returning * into b;
  update tiep_cancellations set
    cancel_cusdec = b.cancel_cusdec, cancel_date = b.cancel_date,
    status = case when b.status = 'Duty paid' then 'Completed' else 'Planned' end,
    exp_qty = coalesce(b.sold_qty, exp_qty), batch_id = b.id,
    updated_at = now(), updated_by = auth.uid()
  where company_id = p_company and ref = b.ref and source <> 'logbook';
  return v_id;
end $$;

revoke execute on function tiep_save_mud(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function tiep_withdraw_mud(uuid, uuid) from public, anon;
revoke execute on function tiep_record_writeoff(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function tiep_save_batch(uuid, uuid, jsonb) from public, anon;
grant execute on function tiep_save_mud(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function tiep_withdraw_mud(uuid, uuid) to authenticated;
grant execute on function tiep_record_writeoff(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function tiep_save_batch(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
