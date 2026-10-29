-- Import reconciliation: the value on which customs charged VAT (the VTD / VAT tax base on the
-- CusDec, i.e. CIF plus duties), beside the VAT amount. Carried on customs_entries and import_purchases.
set search_path = vat_claims, public;

alter table customs_entries add column if not exists vat_base numeric(18,2);        -- VTD / VAT tax base
alter table import_purchases add column if not exists custom_vat_base numeric(18,2); -- value for VAT per customs

create or replace function apply_customs(p_company uuid, p_direction text, p_month date default null) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
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
    from (
      select distinct on (norm_doc_no(invoice_no)) *
      from customs_entries where company_id = p_company and direction = 'export'
      order by norm_doc_no(invoice_no), created_at desc
    ) c
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
    from (
      select distinct on (norm_doc_no(invoice_no)) *
      from customs_entries where company_id = p_company and direction = 'import'
      order by norm_doc_no(invoice_no), created_at desc
    ) c
    where s.company_id = p_company
      and norm_doc_no(s.invoice_no) = norm_doc_no(c.invoice_no)
      and (p_month is null or s.sales_month = date_trunc('month', p_month)::date);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function replace_customs_entries(p_company uuid, p_direction text, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int; m int;
begin
  if p_direction not in ('export','import') then
    raise exception 'direction must be export or import' using errcode = '22023';
  end if;
  insert into customs_entries (company_id, direction, cusdec_no, cusdec_date, cusdec_month, invoice_no, currency_type,
                               ex_rate, invoice_value, customs_value, vat_base, vat_amount, party, description, created_by)
  select p_company, p_direction, r.cusdec_no, r.cusdec_date, r.cusdec_month, r.invoice_no, r.currency_type,
         r.ex_rate, r.invoice_value, r.customs_value, r.vat_base, r.vat_amount, r.party, r.description, auth.uid()
  from jsonb_to_recordset(p_rows) as r(cusdec_no text, cusdec_date text, cusdec_month text, invoice_no text,
                                       currency_type text, ex_rate numeric, invoice_value numeric, customs_value numeric,
                                       vat_base numeric, vat_amount numeric, party text, description text)
  on conflict (company_id, direction, cusdec_no, invoice_no) do update set
    cusdec_date = excluded.cusdec_date, cusdec_month = excluded.cusdec_month, currency_type = excluded.currency_type,
    ex_rate = excluded.ex_rate, invoice_value = excluded.invoice_value, customs_value = excluded.customs_value,
    vat_base = excluded.vat_base, vat_amount = excluded.vat_amount, party = excluded.party, description = excluded.description,
    created_at = now(), created_by = auth.uid();
  get diagnostics n = row_count;
  m := apply_customs(p_company, p_direction);
  return jsonb_build_object('entries', n, 'applied', m);
end $$;

create or replace function replace_import_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
  create temp table _keep_imp on commit drop as
    select invoice_no, cusdec_no, cusdec_date, cusdec_month, currency_type, custom_ex_rate, custom_invoice_value,
           custom_value, custom_vat_base, custom_vat_amount, short_shipment, sales_reversed, updated_in_custom_report,
           updated_at, updated_by
    from import_purchases
    where company_id = p_company and sales_month = date_trunc('month', p_month)::date;
  delete from import_purchases where company_id = p_company and sales_month = date_trunc('month', p_month)::date;
  insert into import_purchases (company_id, sales_month, invoice_no, amount_fc, ex_rate, net_sales,
                                cusdec_no, cusdec_date, cusdec_month, currency_type, custom_ex_rate, custom_invoice_value,
                                custom_value, custom_vat_base, custom_vat_amount, short_shipment, sales_reversed,
                                updated_in_custom_report, created_by, updated_at, updated_by)
  select p_company, date_trunc('month', p_month)::date, r.invoice_no, coalesce(r.amount_fc, 0), r.ex_rate,
         coalesce(r.net_sales, 0),
         coalesce(nullif(r.cusdec_no, ''), k.cusdec_no),
         coalesce(nullif(r.cusdec_date, ''), k.cusdec_date),
         coalesce(nullif(r.cusdec_month, ''), k.cusdec_month),
         coalesce(nullif(r.currency_type, ''), k.currency_type, 'USD'),
         coalesce(r.custom_ex_rate, k.custom_ex_rate),
         coalesce(r.custom_invoice_value, k.custom_invoice_value),
         coalesce(r.custom_value, k.custom_value),
         coalesce(r.custom_vat_base, k.custom_vat_base),
         coalesce(r.custom_vat_amount, k.custom_vat_amount),
         coalesce(r.short_shipment, k.short_shipment),
         coalesce(r.sales_reversed, k.sales_reversed),
         coalesce(nullif(r.updated_in_custom_report, ''), k.updated_in_custom_report),
         auth.uid(), k.updated_at, k.updated_by
  from jsonb_to_recordset(p_rows) as r(invoice_no text, amount_fc numeric, ex_rate numeric, net_sales numeric,
                                       cusdec_no text, cusdec_date text, cusdec_month text, currency_type text,
                                       custom_ex_rate numeric, custom_invoice_value numeric, custom_value numeric,
                                       custom_vat_base numeric, custom_vat_amount numeric, short_shipment numeric,
                                       sales_reversed numeric, updated_in_custom_report text)
  left join _keep_imp k using (invoice_no);
  get diagnostics n = row_count;
  perform apply_customs(p_company, 'import', p_month);
  return n;
end $$;

notify pgrst, 'reload schema';
