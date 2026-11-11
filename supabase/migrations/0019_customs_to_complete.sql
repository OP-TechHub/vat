-- "To complete" tag and remarks on customs entries. Entries loaded from a logbook rather than read from the
-- CusDec (no CusDec file held, some fields blank or worked out) are tagged until someone completes them.
-- Uploads read both from the To Complete and Remarks columns of a customs spreadsheet. Uploading the real
-- CusDec later (PDF or sheet, not tagged) replaces a tagged entry with the same CusDec number and month even
-- when its invoice number differs (logbook entries often have none), keeping the documents attached to it.
-- Import entries may now have a blank invoice number.
set search_path = vat_claims, public;

alter table customs_entries
  add column if not exists to_complete boolean not null default false,
  add column if not exists remarks text;

-- As in 0016, with to_complete and remarks, and tagged entries replaced by the real CusDec.
create or replace function replace_customs_entries(p_company uuid, p_direction text, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int; m int;
begin
  if p_direction not in ('export','import') then
    raise exception 'direction must be export or import' using errcode = '22023';
  end if;
  create temp table _rows on commit drop as
    select r.cusdec_no, r.cusdec_date, r.cusdec_month, coalesce(r.invoice_no, '') as invoice_no, coalesce(r.item_no, 1) as item_no,
           r.hs_code, r.uom, r.quantity, r.currency_type, r.ex_rate, r.invoice_value, r.customs_value,
           r.cid_amount, r.cid_code, r.pal_amount, r.pal_code, r.sscl_amount, r.sscl_code,
           r.vat_base, r.vat_amount, r.vat_type, r.vat_code, r.party, r.description, nullif(trim(r.file_name), '') as file_name,
           coalesce(r.to_complete, false) as to_complete, nullif(trim(r.remarks), '') as remarks
    from jsonb_to_recordset(p_rows) as r(cusdec_no text, cusdec_date text, cusdec_month text, invoice_no text, item_no int,
                                         hs_code text, uom text, quantity numeric, currency_type text, ex_rate numeric,
                                         invoice_value numeric, customs_value numeric,
                                         cid_amount numeric, cid_code text, pal_amount numeric, pal_code text,
                                         sscl_amount numeric, sscl_code text, vat_base numeric, vat_amount numeric,
                                         vat_type text, vat_code text, party text, description text, file_name text,
                                         to_complete boolean, remarks text);
  -- Entries each uploaded declaration replaces: the same CusDec and invoice, or a tagged entry of the same
  -- CusDec number and month when the upload itself is not tagged.
  create temp table _old on commit drop as
    select distinct e.id, r.cusdec_no as new_cusdec, r.invoice_no as new_invoice,
           (e.cusdec_no = r.cusdec_no and e.invoice_no = r.invoice_no) as same_key
    from customs_entries e
    join _rows r on r.cusdec_no = e.cusdec_no
      and (e.invoice_no = r.invoice_no
           or (e.to_complete and not r.to_complete and e.cusdec_month is not distinct from r.cusdec_month))
    where e.company_id = p_company and e.direction = p_direction;
  -- The document slots and file name are written to every line of a declaration, so its first line holds them all;
  -- the declaration's own entry wins over a tagged one it replaces.
  create temp table _docs on commit drop as
    select distinct on (o.new_cusdec, o.new_invoice) o.new_cusdec as cusdec_no, o.new_invoice as invoice_no,
           e.doc_path, e.doc_name, e.doc_uploaded_at,
           e.invoice_doc_path, e.invoice_doc_name, e.invoice_doc_uploaded_at,
           e.other_doc_path, e.other_doc_name, e.other_doc_uploaded_at,
           e.all_doc_path, e.all_doc_name, e.all_doc_uploaded_at, e.file_name
    from _old o join customs_entries e on e.id = o.id
    where coalesce(e.doc_path, e.invoice_doc_path, e.other_doc_path, e.all_doc_path, e.file_name) is not null
    order by o.new_cusdec, o.new_invoice, o.same_key desc, e.item_no;
  delete from customs_entries e using _old o where e.id = o.id;
  insert into customs_entries (company_id, direction, cusdec_no, cusdec_date, cusdec_month, invoice_no, item_no, hs_code, uom, quantity,
                               currency_type, ex_rate, invoice_value, customs_value,
                               cid_amount, cid_code, pal_amount, pal_code, sscl_amount, sscl_code,
                               vat_base, vat_amount, vat_type, vat_code, party, description, file_name, to_complete, remarks,
                               doc_path, doc_name, doc_uploaded_at,
                               invoice_doc_path, invoice_doc_name, invoice_doc_uploaded_at,
                               other_doc_path, other_doc_name, other_doc_uploaded_at,
                               all_doc_path, all_doc_name, all_doc_uploaded_at, created_by)
  select p_company, p_direction, r.cusdec_no, r.cusdec_date, r.cusdec_month, r.invoice_no, r.item_no, r.hs_code, r.uom, r.quantity,
         r.currency_type, r.ex_rate, r.invoice_value, r.customs_value,
         r.cid_amount, r.cid_code, r.pal_amount, r.pal_code, r.sscl_amount, r.sscl_code,
         r.vat_base, r.vat_amount, r.vat_type, r.vat_code, r.party, r.description, coalesce(r.file_name, d.file_name),
         r.to_complete, r.remarks,
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
    to_complete = excluded.to_complete, remarks = excluded.remarks,
    created_at = now(), created_by = auth.uid();
  get diagnostics n = row_count;
  drop table _rows;
  drop table _old;
  drop table _docs;
  m := apply_customs(p_company, p_direction);
  return jsonb_build_object('entries', n, 'applied', m);
end $$;

-- Replacing needs delete permission, as in 0015; a tagged entry the real CusDec replaces counts too.
create or replace function upload_customs_entries(p_company uuid, p_direction text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if customs_tab(p_direction) is null then
    raise exception 'direction must be export or import' using errcode = '22023';
  end if;
  perform require_upload(p_company, customs_tab(p_direction), exists (
    select 1 from customs_entries e
    join jsonb_to_recordset(p_rows) as r(cusdec_no text, invoice_no text, cusdec_month text, to_complete boolean)
      on r.cusdec_no = e.cusdec_no
     and (e.invoice_no = coalesce(r.invoice_no, '')
          or (e.to_complete and not coalesce(r.to_complete, false) and e.cusdec_month is not distinct from r.cusdec_month))
    where e.company_id = p_company and e.direction = p_direction));
  perform change_label(
    'Uploaded ' || (select count(distinct (r.cusdec_no, r.invoice_no))
                    from jsonb_to_recordset(p_rows) as r(cusdec_no text, invoice_no text))
      || ' ' || p_direction || ' CusDec(s)', 'upload');
  return replace_customs_entries(p_company, p_direction, p_rows);
end $$;

-- Only through upload_customs_entries, which checks the tab permissions (0016 had granted it again).
revoke execute on function replace_customs_entries(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function upload_customs_entries(uuid, text, jsonb) from public, anon;
grant execute on function upload_customs_entries(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
