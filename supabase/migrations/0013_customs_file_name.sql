-- File name of each CusDec ("IMP 173"): from the File Name column of a customs spreadsheet or the name
-- of the uploaded CusDec PDF. Written to every item line of a declaration, like the other header fields.
set search_path = vat_claims, public;

alter table customs_entries add column if not exists file_name text;

-- As in 0012, with file_name read from the upload. A blank file name keeps the one already held.
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
           e.other_doc_path, e.other_doc_name, e.other_doc_uploaded_at,
           e.all_doc_path, e.all_doc_name, e.all_doc_uploaded_at, e.file_name
    from customs_entries e
    where e.company_id = p_company and e.direction = p_direction
      and coalesce(e.doc_path, e.other_doc_path, e.all_doc_path, e.file_name) is not null
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
                               other_doc_path, other_doc_name, other_doc_uploaded_at,
                               all_doc_path, all_doc_name, all_doc_uploaded_at, created_by)
  select p_company, p_direction, r.cusdec_no, r.cusdec_date, r.cusdec_month, r.invoice_no, r.item_no, r.hs_code, r.uom, r.quantity,
         r.currency_type, r.ex_rate, r.invoice_value, r.customs_value,
         r.cid_amount, r.cid_code, r.pal_amount, r.pal_code, r.sscl_amount, r.sscl_code,
         r.vat_base, r.vat_amount, r.vat_type, r.vat_code, r.party, r.description, coalesce(r.file_name, d.file_name),
         d.doc_path, d.doc_name, d.doc_uploaded_at,
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

notify pgrst, 'reload schema';
