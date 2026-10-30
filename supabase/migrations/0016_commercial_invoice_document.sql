-- A fourth document slot per customs declaration: the commercial invoice (invoice_doc_*), kept apart from the
-- other documents (packing list, bill of lading...). Files live in the vat-claims bucket under
-- <company_id>/customs/<export|import>/<cusdec no>/invoice/<filename>.
set search_path = vat_claims, public;

alter table customs_entries
  add column if not exists invoice_doc_path text,
  add column if not exists invoice_doc_name text,
  add column if not exists invoice_doc_uploaded_at timestamptz;

-- As in 0013, keeping the commercial invoice too.
create or replace function replace_customs_entries(p_company uuid, p_direction text, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int; m int;
begin
  if p_direction not in ('export','import') then
    raise exception 'direction must be export or import' using errcode = '22023';
  end if;
  create temp table _rows on commit drop as
    select r.cusdec_no, r.cusdec_date, r.cusdec_month, r.invoice_no, coalesce(r.item_no, 1) as item_no, r.hs_code, r.uom, r.quantity,
           r.currency_type, r.ex_rate, r.invoice_value, r.customs_value,
           r.cid_amount, r.cid_code, r.pal_amount, r.pal_code, r.sscl_amount, r.sscl_code,
           r.vat_base, r.vat_amount, r.vat_type, r.vat_code, r.party, r.description, nullif(trim(r.file_name), '') as file_name
    from jsonb_to_recordset(p_rows) as r(cusdec_no text, cusdec_date text, cusdec_month text, invoice_no text, item_no int,
                                         hs_code text, uom text, quantity numeric, currency_type text, ex_rate numeric,
                                         invoice_value numeric, customs_value numeric,
                                         cid_amount numeric, cid_code text, pal_amount numeric, pal_code text,
                                         sscl_amount numeric, sscl_code text, vat_base numeric, vat_amount numeric,
                                         vat_type text, vat_code text, party text, description text, file_name text);
  -- The document slots and file name are written to every line of a declaration, so its first line holds them all.
  create temp table _docs on commit drop as
    select distinct on (e.cusdec_no, e.invoice_no) e.cusdec_no, e.invoice_no,
           e.doc_path, e.doc_name, e.doc_uploaded_at,
           e.invoice_doc_path, e.invoice_doc_name, e.invoice_doc_uploaded_at,
           e.other_doc_path, e.other_doc_name, e.other_doc_uploaded_at,
           e.all_doc_path, e.all_doc_name, e.all_doc_uploaded_at, e.file_name
    from customs_entries e
    where e.company_id = p_company and e.direction = p_direction
      and coalesce(e.doc_path, e.invoice_doc_path, e.other_doc_path, e.all_doc_path, e.file_name) is not null
      and exists (select 1 from _rows r where r.cusdec_no = e.cusdec_no and r.invoice_no = e.invoice_no)
    order by e.cusdec_no, e.invoice_no, e.item_no;
  delete from customs_entries e
  where e.company_id = p_company and e.direction = p_direction
    and exists (select 1 from _rows r where r.cusdec_no = e.cusdec_no and r.invoice_no = e.invoice_no);
  insert into customs_entries (company_id, direction, cusdec_no, cusdec_date, cusdec_month, invoice_no, item_no, hs_code, uom, quantity,
                               currency_type, ex_rate, invoice_value, customs_value,
                               cid_amount, cid_code, pal_amount, pal_code, sscl_amount, sscl_code,
                               vat_base, vat_amount, vat_type, vat_code, party, description, file_name,
                               doc_path, doc_name, doc_uploaded_at,
                               invoice_doc_path, invoice_doc_name, invoice_doc_uploaded_at,
                               other_doc_path, other_doc_name, other_doc_uploaded_at,
                               all_doc_path, all_doc_name, all_doc_uploaded_at, created_by)
  select p_company, p_direction, r.cusdec_no, r.cusdec_date, r.cusdec_month, r.invoice_no, r.item_no, r.hs_code, r.uom, r.quantity,
         r.currency_type, r.ex_rate, r.invoice_value, r.customs_value,
         r.cid_amount, r.cid_code, r.pal_amount, r.pal_code, r.sscl_amount, r.sscl_code,
         r.vat_base, r.vat_amount, r.vat_type, r.vat_code, r.party, r.description, coalesce(r.file_name, d.file_name),
         d.doc_path, d.doc_name, d.doc_uploaded_at,
         d.invoice_doc_path, d.invoice_doc_name, d.invoice_doc_uploaded_at,
         d.other_doc_path, d.other_doc_name, d.other_doc_uploaded_at,
         d.all_doc_path, d.all_doc_name, d.all_doc_uploaded_at, auth.uid()
  from _rows r
  left join _docs d on d.cusdec_no = r.cusdec_no and d.invoice_no = r.invoice_no
  on conflict (company_id, direction, cusdec_no, invoice_no, item_no) do update set
    cusdec_date = excluded.cusdec_date, cusdec_month = excluded.cusdec_month, hs_code = excluded.hs_code,
    uom = excluded.uom, quantity = excluded.quantity, currency_type = excluded.currency_type,
    ex_rate = excluded.ex_rate, invoice_value = excluded.invoice_value, customs_value = excluded.customs_value,
    cid_amount = excluded.cid_amount, cid_code = excluded.cid_code, pal_amount = excluded.pal_amount, pal_code = excluded.pal_code,
    sscl_amount = excluded.sscl_amount, sscl_code = excluded.sscl_code,
    vat_base = excluded.vat_base, vat_amount = excluded.vat_amount, vat_type = excluded.vat_type, vat_code = excluded.vat_code,
    party = excluded.party, description = excluded.description, file_name = excluded.file_name,
    created_at = now(), created_by = auth.uid();
  get diagnostics n = row_count;
  drop table _rows;
  drop table _docs;
  m := apply_customs(p_company, p_direction);
  return jsonb_build_object('entries', n, 'applied', m);
end $$;

grant execute on function replace_customs_entries(uuid, text, jsonb) to authenticated;

-- As in 0015, with the 'invoice' slot.
create or replace function set_customs_document(p_company uuid, p_direction text, p_cusdec_no text, p_invoice_no text,
                                                p_kind text, p_path text, p_name text) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
declare v_tab text := customs_tab(p_direction); held text;
begin
  if v_tab is null or p_kind not in ('cusdec', 'invoice', 'other', 'all') then
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
  if p_path is not null and not has_perm(p_company, v_tab, 'upload') then
    raise exception 'You do not have upload permission on this tab.' using errcode = '42501';
  end if;
  if (p_path is null or held is not null) and not has_perm(p_company, v_tab, 'delete') then
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

create or replace function doc_referenced(p_path text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select exists (select 1 from return_documents where path = p_path)
      or exists (select 1 from customs_entries where p_path in (doc_path, invoice_doc_path, other_doc_path, all_doc_path))
$$;

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
    cross join lateral (values (l.old_row->>'path'), (l.old_row->>'doc_path'), (l.old_row->>'invoice_doc_path'), (l.old_row->>'other_doc_path'), (l.old_row->>'all_doc_path')) p(path)
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

notify pgrst, 'reload schema';
