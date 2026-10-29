-- Customs entries per CusDec item: one line per HS code line of the declaration, with the item
-- number, HS code, unit and quantity, and the CID / PAL / SSCL / VAT amounts and MP codes of its
-- tax table. The header fields (reference, date, rate, invoice, party) repeat on every line.
set search_path = vat_claims, public;

alter table customs_entries
  add column if not exists item_no int not null default 1,
  add column if not exists hs_code text,
  add column if not exists uom text,
  add column if not exists quantity numeric(18,3),
  add column if not exists cid_amount numeric(18,2),
  add column if not exists cid_code text,
  add column if not exists pal_amount numeric(18,2),
  add column if not exists pal_code text,
  add column if not exists sscl_amount numeric(18,2),
  add column if not exists sscl_code text,
  add column if not exists vat_type text,        -- VTD (deferred) or VAT (upfront)
  add column if not exists vat_code text;        -- MP code of the VAT line

-- One row per CusDec, invoice and item.
alter table customs_entries drop constraint if exists customs_entries_company_id_direction_cusdec_no_invoice_no_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customs_entries_line_key') then
    alter table customs_entries add constraint customs_entries_line_key unique (company_id, direction, cusdec_no, invoice_no, item_no);
  end if;
end $$;

-- Fill the customs columns of export sales / import purchases from the latest CusDec carrying the
-- same invoice number, summing its items' customs value, VAT base and VAT.
create or replace function apply_customs(p_company uuid, p_direction text, p_month date default null) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
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
  return n;
end $$;

-- Upload customs entries: every (CusDec, invoice) in the upload is replaced by its uploaded item
-- lines, keeping the CusDec document already held for it; then the matching rows are filled.
-- Returns {"entries": n, "applied": m}.
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
           r.vat_base, r.vat_amount, r.vat_type, r.vat_code, r.party, r.description
    from jsonb_to_recordset(p_rows) as r(cusdec_no text, cusdec_date text, cusdec_month text, invoice_no text, item_no int,
                                         hs_code text, uom text, quantity numeric, currency_type text, ex_rate numeric,
                                         invoice_value numeric, customs_value numeric,
                                         cid_amount numeric, cid_code text, pal_amount numeric, pal_code text,
                                         sscl_amount numeric, sscl_code text, vat_base numeric, vat_amount numeric,
                                         vat_type text, vat_code text, party text, description text);
  create temp table _docs on commit drop as
    select distinct on (e.cusdec_no, e.invoice_no) e.cusdec_no, e.invoice_no, e.doc_path, e.doc_name, e.doc_uploaded_at
    from customs_entries e
    where e.company_id = p_company and e.direction = p_direction and e.doc_path is not null
      and exists (select 1 from _rows r where r.cusdec_no = e.cusdec_no and r.invoice_no = e.invoice_no)
    order by e.cusdec_no, e.invoice_no, e.doc_uploaded_at desc nulls last;
  delete from customs_entries e
  where e.company_id = p_company and e.direction = p_direction
    and exists (select 1 from _rows r where r.cusdec_no = e.cusdec_no and r.invoice_no = e.invoice_no);
  insert into customs_entries (company_id, direction, cusdec_no, cusdec_date, cusdec_month, invoice_no, item_no, hs_code, uom, quantity,
                               currency_type, ex_rate, invoice_value, customs_value,
                               cid_amount, cid_code, pal_amount, pal_code, sscl_amount, sscl_code,
                               vat_base, vat_amount, vat_type, vat_code, party, description,
                               doc_path, doc_name, doc_uploaded_at, created_by)
  select p_company, p_direction, r.cusdec_no, r.cusdec_date, r.cusdec_month, r.invoice_no, r.item_no, r.hs_code, r.uom, r.quantity,
         r.currency_type, r.ex_rate, r.invoice_value, r.customs_value,
         r.cid_amount, r.cid_code, r.pal_amount, r.pal_code, r.sscl_amount, r.sscl_code,
         r.vat_base, r.vat_amount, r.vat_type, r.vat_code, r.party, r.description,
         d.doc_path, d.doc_name, d.doc_uploaded_at, auth.uid()
  from _rows r
  left join _docs d on d.cusdec_no = r.cusdec_no and d.invoice_no = r.invoice_no
  on conflict (company_id, direction, cusdec_no, invoice_no, item_no) do update set
    cusdec_date = excluded.cusdec_date, cusdec_month = excluded.cusdec_month, hs_code = excluded.hs_code,
    uom = excluded.uom, quantity = excluded.quantity, currency_type = excluded.currency_type,
    ex_rate = excluded.ex_rate, invoice_value = excluded.invoice_value, customs_value = excluded.customs_value,
    cid_amount = excluded.cid_amount, cid_code = excluded.cid_code, pal_amount = excluded.pal_amount, pal_code = excluded.pal_code,
    sscl_amount = excluded.sscl_amount, sscl_code = excluded.sscl_code,
    vat_base = excluded.vat_base, vat_amount = excluded.vat_amount, vat_type = excluded.vat_type, vat_code = excluded.vat_code,
    party = excluded.party, description = excluded.description,
    created_at = now(), created_by = auth.uid();
  get diagnostics n = row_count;
  drop table _rows;
  drop table _docs;
  m := apply_customs(p_company, p_direction);
  return jsonb_build_object('entries', n, 'applied', m);
end $$;

notify pgrst, 'reload schema';
