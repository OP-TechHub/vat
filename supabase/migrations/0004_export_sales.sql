-- Export reconciliation: one row per export invoice in the monthly sales report, with the
-- customs (CusDec) details and the reconciling differences entered against it.
set search_path = vat_claims, public;

create table export_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sales_month date not null,                       -- first day of the sales-report month
  -- Details in sales report (from the upload)
  invoice_no text not null,
  amount_fc numeric(18,2) not null default 0,      -- Amount FC (FOB) in USD / EUR
  ex_rate numeric(18,6),                           -- sales report exchange rate
  net_sales numeric(18,2) not null default 0,      -- Net sales (A) in LKR
  -- As per customs (entered by hand or included in the upload)
  cusdec_no text,
  cusdec_date text,                                -- kept as written
  cusdec_month text,
  currency_type text not null default 'USD' check (currency_type in ('USD','EUR')),
  custom_ex_rate numeric(18,6),                    -- customs exchange rate (LKR)
  custom_invoice_value numeric(18,2),              -- invoice value as per customs in USD / EUR
  custom_value numeric(18,2),                      -- customs value in LKR (= invoice value x customs rate)
  -- Differences: exchange difference (1) is derived in the app as custom_value - net_sales
  short_shipment numeric(18,2),                    -- (3)
  sales_reversed numeric(18,2),                    -- (4) sales reversed in the month
  updated_in_custom_report text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz,
  updated_by uuid references auth.users(id),
  unique (company_id, sales_month, invoice_no)
);
create index on export_sales (company_id, sales_month);

alter table export_sales enable row level security;
create policy export_sales_read on export_sales for select using (member_role(company_id) is not null);
create policy export_sales_write on export_sales for all
  using (member_role(company_id) in ('editor','admin')) with check (member_role(company_id) in ('editor','admin'));

-- Replace one sales-report month atomically (upload). Customs and difference fields already entered are
-- kept by invoice number wherever the uploaded row leaves them blank.
create or replace function replace_export_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
  create temp table _keep_exp on commit drop as
    select invoice_no, cusdec_no, cusdec_date, cusdec_month, currency_type, custom_ex_rate, custom_invoice_value,
           custom_value, short_shipment, sales_reversed, updated_in_custom_report, updated_at, updated_by
    from export_sales
    where company_id = p_company and sales_month = date_trunc('month', p_month)::date;
  delete from export_sales where company_id = p_company and sales_month = date_trunc('month', p_month)::date;
  insert into export_sales (company_id, sales_month, invoice_no, amount_fc, ex_rate, net_sales,
                            cusdec_no, cusdec_date, cusdec_month, currency_type, custom_ex_rate, custom_invoice_value,
                            custom_value, short_shipment, sales_reversed, updated_in_custom_report,
                            created_by, updated_at, updated_by)
  select p_company, date_trunc('month', p_month)::date, r.invoice_no, coalesce(r.amount_fc, 0), r.ex_rate,
         coalesce(r.net_sales, 0),
         coalesce(nullif(r.cusdec_no, ''), k.cusdec_no),
         coalesce(nullif(r.cusdec_date, ''), k.cusdec_date),
         coalesce(nullif(r.cusdec_month, ''), k.cusdec_month),
         coalesce(nullif(r.currency_type, ''), k.currency_type, 'USD'),
         coalesce(r.custom_ex_rate, k.custom_ex_rate),
         coalesce(r.custom_invoice_value, k.custom_invoice_value),
         coalesce(r.custom_value, k.custom_value),
         coalesce(r.short_shipment, k.short_shipment),
         coalesce(r.sales_reversed, k.sales_reversed),
         coalesce(nullif(r.updated_in_custom_report, ''), k.updated_in_custom_report),
         auth.uid(), k.updated_at, k.updated_by
  from jsonb_to_recordset(p_rows) as r(invoice_no text, amount_fc numeric, ex_rate numeric, net_sales numeric,
                                       cusdec_no text, cusdec_date text, cusdec_month text, currency_type text,
                                       custom_ex_rate numeric, custom_invoice_value numeric, custom_value numeric,
                                       short_shipment numeric, sales_reversed numeric, updated_in_custom_report text)
  left join _keep_exp k using (invoice_no);
  get diagnostics n = row_count;
  return n;
end $$;

grant all on export_sales to anon, authenticated, service_role;
grant execute on function replace_export_month(uuid, date, jsonb) to authenticated;
