-- TIEP core. Duty-suspended imports under TIEP and their cancellation against exports and local sales.
--
-- Import lines are the Import Register's customs entries (customs_entries, direction import): one per CusDec
-- item. TIEP adds its own fields in tiep_import_ext. Re-uploading a CusDec deletes and re-inserts its lines,
-- so TIEP rows refer to a line by its key (company, CusDec no., invoice no., item no.), the same key that
-- is unique in customs_entries, not by id. A TIEP row whose line is no longer in the register is shown as
-- such in the app.
--
-- Postings (tiep_cancellations) are written by functions only, each in one transaction, with the balance of
-- every import line checked under a per-company lock.
set search_path = vat_claims, public;

-- ---------------------------------------------------------------------------------------------------------
-- Access. A TIEP tab needs the module switched on and the tab permission.
create or replace function tiep_can(c uuid, p_tab text, p_action text) returns boolean
language sql stable security definer set search_path = vat_claims, public as $$
  select has_module(c, 'tiep') and coalesce(has_perm(c, p_tab, p_action), false)
$$;

-- Read access to TIEP data: view on any TIEP tab.
create or replace function tiep_view(c uuid) returns boolean
language sql stable security definer set search_path = vat_claims, public as $$
  select has_module(c, 'tiep') and exists (
    select 1 from unnest(array['tiep_summary','tiep_status','tiep_register','tiep_exports','tiep_local','tiep_ledger','tiep_settings']) t(tab)
    where coalesce(has_perm(c, t.tab, 'view'), false))
$$;
grant execute on function tiep_can(uuid, text, text) to authenticated;
grant execute on function tiep_view(uuid) to authenticated;

-- TIEP reads the import customs entries: add it to the customs permission (view only).
create or replace function customs_perm(c uuid, p_direction text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select coalesce(has_perm(c, customs_tab(p_direction), p_action), false)
      or coalesce(has_perm(c, customs_reg_tab(p_direction), p_action), false)
      or (p_direction = 'import' and p_action = 'view' and tiep_view(c))
$$;

-- ---------------------------------------------------------------------------------------------------------
-- TIEP fields of an import line.
create table if not exists tiep_import_ext (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  cusdec_no text not null,
  invoice_no text not null default '',
  item_no int not null default 1,
  grp text check (grp in ('Fish Feed','Broodstock Feed','Microalgae','Artemia','Enrichment','Chemicals','Packaging',
                          'Fingerlings','Returned Fish','Equipment & Spares')),
  ftype text check (ftype in ('Marine Fish Feed', 'Hatchery Feed')),   -- fish feed only; null = from description
  req text not null default 'Yes' check (req in ('Yes', 'Confirm', 'No')),  -- cancellation required?
  pending boolean not null default false,          -- import details still to come (added from a local-sales plan)
  duty_total numeric(18,2),                        -- logbook lines: one duty total without CID / PAL / SSCL
  remarks text,
  legacy_id text,                                  -- IMP-0001 in the TIEP app
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id),
  unique (company_id, cusdec_no, invoice_no, item_no)
);

-- Local-sales batches: local sales whose duty is paid together under one customs entry.
create table if not exists tiep_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  ref text not null,                               -- reference of its cancellation postings
  start_date date,
  end_date date,
  sold_qty numeric(18,3),
  duty_amount numeric(18,2),
  status text not null default 'Pending duty payment' check (status in ('Pending duty payment', 'Duty paid')),
  cancel_cusdec text,
  cancel_date date,
  notes text,
  duty_paid_lines jsonb not null default '[]'::jsonb,
  legacy_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id),
  unique (company_id, ref)
);

-- Cancellation postings: one row per import line a posting draws on; rows of one posting share its ref.
create table if not exists tiep_cancellations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  ref text not null,                               -- CN-0001 (export), LS-0001 (local), a batch ref, CN-<invoice> (MUD)
  seq int not null,
  type text not null check (type in ('export', 'local')),
  status text not null default 'Completed' check (status in ('Completed', 'Planned')),
  posting_date date,
  exp_inv text,
  exp_cusdec text,
  product text,
  exp_qty numeric(18,3),
  ratio numeric(18,6),
  ratio_text text,
  remarks text,
  mode text,                                       -- fifo, line, mud
  cusdec_no text not null,                         -- import line key
  invoice_no text not null default '',
  item_no int not null default 1,
  grp text,
  uom text,
  qty numeric(18,4) not null check (qty > 0),
  item text,                                       -- import line description at posting
  batch_id uuid references tiep_batches (id) on delete set null,
  cancel_cusdec text,                              -- local: customs entry raised for the duty payment
  cancel_date date,
  hs text,
  duty numeric(18,2),                              -- liability for guarantee (MUD / logbook)
  value_usd numeric(18,2),
  source text not null default 'manual' check (source in ('manual', 'mud', 'logbook', 'plan')),
  sales_invoice_id uuid references sales_invoices (id) on delete set null,
  legacy_id text,
  posted_by uuid references auth.users (id),
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id),
  unique (company_id, ref, seq)
);
create index if not exists tiep_cancellations_line on tiep_cancellations (company_id, cusdec_no, invoice_no, item_no);

-- Conversion standards: sales product → raw fish (yield) → raw materials, each for a period of sales dates.
create table if not exists tiep_standards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  short text,
  valid_from date,
  valid_to date,
  edible_kg numeric(18,3) not null default 2124000,
  fcr numeric(10,4) not null default 2,
  notes text,
  source text,
  yields jsonb not null default '[]'::jsonb,       -- [{product, hs, yield (fraction)}]
  materials jsonb not null default '[]'::jsonb,    -- [{mat, stage, hs, uom, grp, sub, annual, perKg}]
  mud jsonb not null default '[]'::jsonb,          -- [{label, hs, uom, basis, per1000, grp, kind, kw}]
  legacy_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id),
  check (valid_from is null or valid_to is null or valid_from <= valid_to)
);

-- TIEP item master: system (Business Central) items mapped to the TIEP item (sales product) they are.
create table if not exists tiep_skumap (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  code text,                                       -- BC item no.
  item text not null,                              -- invoice description
  tiep text,                                       -- TIEP item; null = no TIEP item (left out of consumption)
  alt jsonb not null default '{}'::jsonb,          -- {standard id: TIEP item to use under that standard}
  status text not null default 'confident' check (status in ('confident', 'review', 'none')),
  notes text,
  src text,
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id),
  legacy_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id)
);
create index if not exists tiep_skumap_company on tiep_skumap (company_id);

-- Settings, one row per company.
create table if not exists tiep_settings (
  company_id uuid primary key references companies (id) on delete cascade,
  period_days int not null default 365 check (period_days > 0),   -- cancellation period after the import date
  as_at date,                                      -- null = today
  guarantee numeric(18,2),                         -- bank guarantee amount
  mud_config jsonb not null default '{}'::jsonb,   -- MUD form header (importer, TIN, office, ref prefix …)
  product_map jsonb not null default '{}'::jsonb,  -- sales list product name → TIEP item
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz,
  updated_by uuid references auth.users (id)
);

-- ---------------------------------------------------------------------------------------------------------
-- Row level security. Everyone with a TIEP tab reads; writes per owning tab. Postings only via functions.
alter table tiep_import_ext enable row level security;
alter table tiep_batches enable row level security;
alter table tiep_cancellations enable row level security;
alter table tiep_standards enable row level security;
alter table tiep_skumap enable row level security;
alter table tiep_settings enable row level security;

do $$ declare t record; begin
  for t in select * from (values
    ('tiep_import_ext', 'tiep_register'),
    ('tiep_batches', 'tiep_status'),
    ('tiep_standards', 'tiep_settings'),
    ('tiep_skumap', 'tiep_settings'),
    ('tiep_settings', 'tiep_settings'),
    ('tiep_cancellations', null)
  ) as v(tbl, tab) loop
    execute format('drop policy if exists %I on %I', t.tbl || '_read', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_insert', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_update', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_delete', t.tbl);
    execute format('create policy %I on %I for select using (tiep_view(company_id))', t.tbl || '_read', t.tbl);
    if t.tab is not null then
      execute format('create policy %I on %I for insert with check (tiep_can(company_id, %L, ''edit''))', t.tbl || '_insert', t.tbl, t.tab);
      execute format('create policy %I on %I for update using (tiep_can(company_id, %L, ''edit'')) with check (tiep_can(company_id, %L, ''edit''))', t.tbl || '_update', t.tbl, t.tab, t.tab);
      execute format('create policy %I on %I for delete using (tiep_can(company_id, %L, ''delete''))', t.tbl || '_delete', t.tbl, t.tab);
      execute format('grant select, insert, update, delete on %I to authenticated', t.tbl);
    else
      execute format('grant select on %I to authenticated', t.tbl);
    end if;
    execute format('grant all on %I to service_role', t.tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Change log: TIEP tables under their tabs. As in 0024, plus the TIEP tables.
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
    ('tiep_import_ext', 'id'), ('tiep_batches', 'id'), ('tiep_cancellations', 'id'),
    ('tiep_standards', 'id'), ('tiep_skumap', 'id'), ('tiep_settings', 'company_id')
  ) as v(tbl, key) loop
    execute format('drop trigger if exists log_change on %I', t.tbl);
    execute format('create trigger log_change after insert or update or delete on %I for each row execute function log_change(%L)', t.tbl, t.key);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Balance of an import line still free to cancel: quantity less every posting (completed or planned).
create or replace function tiep_line_free(p_company uuid, p_cusdec text, p_invoice text, p_item int) returns numeric
language sql stable security definer set search_path = vat_claims, public as $$
  select coalesce((select sum(quantity) from customs_entries
                   where company_id = p_company and direction = 'import'
                     and cusdec_no = p_cusdec and invoice_no = p_invoice and item_no = p_item), 0)
       - coalesce((select sum(qty) from tiep_cancellations
                   where company_id = p_company and cusdec_no = p_cusdec and invoice_no = p_invoice and item_no = p_item), 0)
$$;

-- Post a cancellation. p_head: {type, status, posting_date, exp_inv, exp_cusdec, product, exp_qty, ratio,
-- remarks, mode, batch_id, cancel_cusdec, cancel_date}; p_allocs: [{cusdec_no, invoice_no, item_no, qty}],
-- worked out by the app (FIFO or one line). Every line must be a TIEP line still requiring cancellation with
-- enough free balance. Returns the posting's reference.
create or replace function tiep_post_cancellation(p_company uuid, p_head jsonb, p_allocs jsonb) returns text
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  v_type text := p_head->>'type';
  v_status text := coalesce(nullif(p_head->>'status', ''), 'Completed');
  v_batch tiep_batches;
  v_ref text;
  v_seq int;
  a record;
  ce customs_entries;
  x tiep_import_ext;
  v_free numeric;
  v_n int := 0;
begin
  if not tiep_can(p_company, 'tiep_status', 'edit') then
    raise exception 'You do not have edit permission on TIEP Status.' using errcode = '42501';
  end if;
  if v_type not in ('export', 'local') or v_status not in ('Completed', 'Planned') then
    raise exception 'Unknown cancellation type or status' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_allocs, '[]'::jsonb)) = 0 then
    raise exception 'Nothing to post' using errcode = '22023';
  end if;
  -- One posting at a time per company, so balances and references are checked against settled data.
  perform pg_advisory_xact_lock(hashtext('tiep_post:' || p_company::text));

  if nullif(p_head->>'batch_id', '') is not null then
    select * into v_batch from tiep_batches where id = (p_head->>'batch_id')::uuid and company_id = p_company;
    if not found then
      raise exception 'Local-sales batch not found' using errcode = 'P0002';
    end if;
    v_ref := v_batch.ref;
  else
    select (case when v_type = 'local' then 'LS' else 'CN' end) || '-' ||
           lpad((coalesce(max(substring(ref from '^(?:CN|LS)-(\d+)$')::int), 0) + 1)::text, 4, '0')
      into v_ref
    from tiep_cancellations
    where company_id = p_company and ref ~ ('^' || case when v_type = 'local' then 'LS' else 'CN' end || '-\d+$');
  end if;
  select coalesce(max(seq), 0) into v_seq from tiep_cancellations where company_id = p_company and ref = v_ref;
  perform change_label('Posted ' || v_ref || ' (' || v_type || ' cancellation)', 'add');

  for a in select * from jsonb_to_recordset(p_allocs) as r(cusdec_no text, invoice_no text, item_no int, qty numeric) loop
    if coalesce(a.qty, 0) <= 0 then
      raise exception 'Quantities must be above zero' using errcode = '22023';
    end if;
    select * into ce from customs_entries
    where company_id = p_company and direction = 'import' and cusdec_no = a.cusdec_no
      and invoice_no = coalesce(a.invoice_no, '') and item_no = coalesce(a.item_no, 1);
    if not found then
      raise exception 'Import line % / % item % is not in the Import Register', a.cusdec_no, a.invoice_no, a.item_no
        using errcode = 'P0002';
    end if;
    select * into x from tiep_import_ext
    where company_id = p_company and cusdec_no = ce.cusdec_no and invoice_no = ce.invoice_no and item_no = ce.item_no;
    if coalesce(x.req, case when upper(trim(ce.cusdec_no)) like 'S%' then 'Yes' else 'No' end) <> 'Yes' then
      raise exception 'Import line % item % does not require cancellation', ce.cusdec_no, ce.item_no using errcode = '22023';
    end if;
    if coalesce(x.pending, false) then
      raise exception 'Import line % item % is waiting for its import details', ce.cusdec_no, ce.item_no using errcode = '22023';
    end if;
    v_free := tiep_line_free(p_company, ce.cusdec_no, ce.invoice_no, ce.item_no);
    if a.qty > v_free + 0.00005 then
      raise exception 'Only % is free on import line % item % (asked %). Refresh and preview again.',
        round(v_free, 4), ce.cusdec_no, ce.item_no, a.qty using errcode = '22023';
    end if;
    v_n := v_n + 1;
    insert into tiep_cancellations (company_id, ref, seq, type, status, posting_date, exp_inv, exp_cusdec, product, exp_qty,
                                    ratio, remarks, mode, cusdec_no, invoice_no, item_no, grp, uom, qty, item, batch_id,
                                    cancel_cusdec, cancel_date, hs, source, posted_by, created_by)
    values (p_company, v_ref, v_seq + v_n, v_type, v_status, nullif(p_head->>'posting_date', '')::date,
            nullif(trim(p_head->>'exp_inv'), ''), nullif(trim(p_head->>'exp_cusdec'), ''), nullif(trim(p_head->>'product'), ''),
            nullif(p_head->>'exp_qty', '')::numeric, nullif(p_head->>'ratio', '')::numeric, nullif(trim(p_head->>'remarks'), ''),
            nullif(p_head->>'mode', ''), ce.cusdec_no, ce.invoice_no, ce.item_no, x.grp, ce.uom, round(a.qty, 4), ce.description,
            v_batch.id,
            coalesce(v_batch.cancel_cusdec, nullif(trim(p_head->>'cancel_cusdec'), '')),
            coalesce(v_batch.cancel_date, nullif(p_head->>'cancel_date', '')::date),
            ce.hs_code, 'manual', auth.uid(), auth.uid());
  end loop;
  return v_ref;
end $$;

-- Update every row of a posting: status, remarks, and the export CusDec and date (export) or the
-- cancellation customs entry and its date (local). p_patch keys present are applied. Logbook rows are kept.
create or replace function tiep_update_ref(p_company uuid, p_ref text, p_patch jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare n int;
begin
  if not tiep_can(p_company, 'tiep_ledger', 'edit') then
    raise exception 'You do not have edit permission on the Cancellation Ledger.' using errcode = '42501';
  end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('Completed', 'Planned') then
    raise exception 'Status must be Completed or Planned' using errcode = '22023';
  end if;
  perform change_label('Updated ' || p_ref, 'edit');
  update tiep_cancellations set
    status        = case when p_patch ? 'status' then p_patch->>'status' else status end,
    remarks       = case when p_patch ? 'remarks' then nullif(trim(p_patch->>'remarks'), '') else remarks end,
    exp_cusdec    = case when p_patch ? 'exp_cusdec' then nullif(trim(p_patch->>'exp_cusdec'), '') else exp_cusdec end,
    posting_date  = case when p_patch ? 'posting_date' then coalesce(nullif(p_patch->>'posting_date', '')::date, posting_date) else posting_date end,
    cancel_cusdec = case when p_patch ? 'cancel_cusdec' then nullif(trim(p_patch->>'cancel_cusdec'), '') else cancel_cusdec end,
    cancel_date   = case when p_patch ? 'cancel_date' then nullif(p_patch->>'cancel_date', '')::date else cancel_date end,
    updated_at = now(), updated_by = auth.uid()
  where company_id = p_company and ref = p_ref and source <> 'logbook';
  get diagnostics n = row_count;
  return n;
end $$;

-- Reverse a posting (every row of p_ref) or one row of it (p_id). Quantities go back to the open balance.
create or replace function tiep_reverse(p_company uuid, p_ref text, p_id uuid default null) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare n int;
begin
  if not tiep_can(p_company, 'tiep_ledger', 'delete') then
    raise exception 'You do not have delete permission on the Cancellation Ledger.' using errcode = '42501';
  end if;
  perform change_label('Reversed ' || p_ref || case when p_id is null then '' else ' (one row)' end, 'delete');
  delete from tiep_cancellations
  where company_id = p_company and ref = p_ref and source <> 'logbook' and (p_id is null or id = p_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- Add an import line by hand (p_key null) or edit one (p_key = {cusdec_no, invoice_no, item_no}), with its
-- TIEP fields. The line is written to the Import Register (customs_entries), so VAT and Registers see it too.
-- p_line: customs fields (cusdec_no, cusdec_date ISO, invoice_no, item_no, hs_code, description, party, uom,
-- quantity, currency_type, ex_rate, invoice_value, customs_value, cid_amount, cid_code, pal_amount, pal_code,
-- sscl_amount, sscl_code, vat_base, vat_amount, vat_code, vat_type, file_name) and TIEP fields (grp, ftype,
-- req, duty_total, remarks). Returns the line key.
create or replace function tiep_save_import_line(p_company uuid, p_line jsonb, p_key jsonb default null) returns jsonb
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  v_cd text := trim(coalesce(p_key->>'cusdec_no', p_line->>'cusdec_no'));
  v_inv text := trim(coalesce(p_key->>'invoice_no', p_line->>'invoice_no', ''));
  v_item int := coalesce((p_key->>'item_no')::int, nullif(p_line->>'item_no', '')::int, 1);
  v_date date := nullif(p_line->>'cusdec_date', '')::date;
  v_qty numeric := nullif(p_line->>'quantity', '')::numeric;
  v_grp text := nullif(p_line->>'grp', '');
  v_req text;
begin
  if not tiep_can(p_company, 'tiep_register', 'edit') then
    raise exception 'You do not have edit permission on the TIEP Import Register.' using errcode = '42501';
  end if;
  if coalesce(v_cd, '') = '' or v_date is null or coalesce(trim(p_line->>'description'), '') = '' then
    raise exception 'CusDec no., date and description are needed' using errcode = '22023';
  end if;
  if p_key is null and exists (select 1 from customs_entries where company_id = p_company and direction = 'import'
                                 and cusdec_no = v_cd and invoice_no = v_inv and item_no = v_item) then
    raise exception 'CusDec % invoice % item % is already in the Import Register', v_cd, v_inv, v_item using errcode = '23505';
  end if;
  perform change_label(case when p_key is null then 'Added import line ' else 'Edited import line ' end
                       || v_cd || ' item ' || v_item, case when p_key is null then 'add' else 'edit' end);

  insert into customs_entries as e (company_id, direction, cusdec_no, cusdec_date, cusdec_month, invoice_no, item_no, hs_code,
                                    description, party, uom, quantity, currency_type, ex_rate, invoice_value, customs_value,
                                    cid_amount, cid_code, pal_amount, pal_code, sscl_amount, sscl_code,
                                    vat_base, vat_amount, vat_code, vat_type, file_name, created_by)
  values (p_company, 'import', v_cd, to_char(v_date, 'YYYY-MM-DD'), to_char(v_date, 'Mon YYYY'), v_inv, v_item,
          nullif(trim(p_line->>'hs_code'), ''), upper(trim(p_line->>'description')), nullif(trim(p_line->>'party'), ''),
          nullif(trim(p_line->>'uom'), ''), v_qty, nullif(trim(p_line->>'currency_type'), ''),
          nullif(p_line->>'ex_rate', '')::numeric, nullif(p_line->>'invoice_value', '')::numeric,
          nullif(p_line->>'customs_value', '')::numeric,
          nullif(p_line->>'cid_amount', '')::numeric, nullif(p_line->>'cid_code', ''),
          nullif(p_line->>'pal_amount', '')::numeric, nullif(p_line->>'pal_code', ''),
          nullif(p_line->>'sscl_amount', '')::numeric, nullif(p_line->>'sscl_code', ''),
          nullif(p_line->>'vat_base', '')::numeric, nullif(p_line->>'vat_amount', '')::numeric,
          nullif(p_line->>'vat_code', ''), nullif(trim(p_line->>'vat_type'), ''), nullif(trim(p_line->>'file_name'), ''),
          auth.uid())
  on conflict (company_id, direction, cusdec_no, invoice_no, item_no) do update set
    cusdec_date = excluded.cusdec_date, cusdec_month = excluded.cusdec_month, hs_code = excluded.hs_code,
    description = excluded.description, party = excluded.party, uom = excluded.uom, quantity = excluded.quantity,
    currency_type = excluded.currency_type, ex_rate = excluded.ex_rate, invoice_value = excluded.invoice_value,
    customs_value = excluded.customs_value, cid_amount = excluded.cid_amount, cid_code = excluded.cid_code,
    pal_amount = excluded.pal_amount, pal_code = excluded.pal_code, sscl_amount = excluded.sscl_amount,
    sscl_code = excluded.sscl_code, vat_base = excluded.vat_base, vat_amount = excluded.vat_amount,
    vat_code = excluded.vat_code, vat_type = excluded.vat_type, file_name = coalesce(excluded.file_name, e.file_name);

  -- Default "cancellation required": duty-paid (not S) CusDecs no; capital goods and spares to confirm.
  v_req := coalesce(nullif(p_line->>'req', ''),
                    (select req from tiep_import_ext where company_id = p_company and cusdec_no = v_cd
                       and invoice_no = v_inv and item_no = v_item),
                    case when upper(v_cd) not like 'S%' then 'No' when v_grp = 'Equipment & Spares' then 'Confirm' else 'Yes' end);
  insert into tiep_import_ext as x (company_id, cusdec_no, invoice_no, item_no, grp, ftype, req, pending, duty_total, remarks, created_by)
  values (p_company, v_cd, v_inv, v_item, v_grp,
          case when v_grp = 'Fish Feed' then nullif(p_line->>'ftype', '') end,
          v_req, coalesce(v_qty, 0) <= 0, nullif(p_line->>'duty_total', '')::numeric, nullif(trim(p_line->>'remarks'), ''),
          auth.uid())
  on conflict (company_id, cusdec_no, invoice_no, item_no) do update set
    grp = excluded.grp, ftype = excluded.ftype, req = excluded.req, pending = excluded.pending,
    duty_total = excluded.duty_total, remarks = excluded.remarks, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('cusdec_no', v_cd, 'invoice_no', v_inv, 'item_no', v_item);
end $$;

revoke execute on function tiep_line_free(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function tiep_post_cancellation(uuid, jsonb, jsonb) from public, anon;
revoke execute on function tiep_update_ref(uuid, text, jsonb) from public, anon;
revoke execute on function tiep_reverse(uuid, text, uuid) from public, anon;
revoke execute on function tiep_save_import_line(uuid, jsonb, jsonb) from public, anon;
grant execute on function tiep_post_cancellation(uuid, jsonb, jsonb) to authenticated;
grant execute on function tiep_update_ref(uuid, text, jsonb) to authenticated;
grant execute on function tiep_reverse(uuid, text, uuid) to authenticated;
grant execute on function tiep_save_import_line(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
