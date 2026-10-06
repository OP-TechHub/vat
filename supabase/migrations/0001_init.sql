-- VAT Input Claims Register: schema, claim-status view, row level security
-- Everything lives in the dedicated schema vat_claims so it can share a Supabase project with other apps.
-- After running: Project Settings -> API -> "Exposed schemas": add vat_claims.
create extension if not exists pgcrypto;

create schema if not exists vat_claims;
grant usage on schema vat_claims to anon, authenticated, service_role;
alter default privileges in schema vat_claims grant all on tables to anon, authenticated, service_role;
alter default privileges in schema vat_claims grant all on functions to anon, authenticated, service_role;
alter default privileges in schema vat_claims grant all on sequences to anon, authenticated, service_role;

-- Every unqualified object below is created in vat_claims.
set search_path = vat_claims, public;

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- role: viewer (read), editor (upload and edit), admin (also manages members)
create table company_members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer','editor','admin')),
  primary key (company_id, user_id)
);

-- Input invoices as per the ledger VAT control account
create table ledger_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_no text not null,
  posting_date date not null,
  vendor_name text,
  external_doc_no text,
  description text,
  amount_lcy numeric(18,2) not null default 0,
  source_amount numeric(18,2),
  original_invoice text check (original_invoice in ('Yes','No')),   -- null = not marked
  manual_claim_month date,                                           -- override: first day of month
  manual_not_claimed boolean not null default false,                 -- override: force not claimed
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (company_id, invoice_no)
);
create index on ledger_invoices (company_id, posting_date);

-- Local input schedule submitted to IRD with each month's return
create table schedule_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  return_month date not null,          -- first day of the return month
  serial_no text,
  invoice_date text,                   -- kept as written on the schedule
  tax_invoice_no text not null,
  supplier_tin text,
  supplier_name text,
  description text,
  purchase_value numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index on schedule_lines (company_id, return_month);

-- One row per monthly VAT return
create table vat_returns (
  company_id uuid not null references companies(id) on delete cascade,
  return_month date not null,
  zero_rated numeric(18,2) not null default 0,        -- D
  exempt numeric(18,2) not null default 0,            -- E
  imports_value numeric(18,2) not null default 0,     -- H
  imports_deferred numeric(18,2) not null default 0,  -- cage 4
  imports_upfront numeric(18,2) not null default 0,   -- cage 5
  local_value numeric(18,2) not null default 0,       -- I
  local_tax numeric(18,2) not null default 0,         -- cage 6
  disallowed numeric(18,2) not null default 0,        -- cage 8
  brought_forward numeric(18,2) not null default 0,   -- cage 10
  ledger_exports numeric(18,2) not null default 0,
  ledger_local_sales numeric(18,2) not null default 0,
  ledger_imports numeric(18,2) not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (company_id, return_month)
);

-- Matching key: trimmed, upper-cased, all whitespace removed
create or replace function norm_doc_no(t text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(t,''), '\s+', '', 'g')), '') $$;

create index on ledger_invoices (company_id, norm_doc_no(external_doc_no));
create index on schedule_lines (company_id, norm_doc_no(tax_invoice_no));

-- Claim status is derived, never stored.
-- auto_claim_month = earliest return month whose schedule carries the invoice's external document number.
create or replace view invoice_claim_status with (security_invoker = true) as
select i.*,
       a.auto_claim_month,
       case when i.manual_not_claimed then null
            else coalesce(i.manual_claim_month, a.auto_claim_month) end as claim_month,
       case when i.manual_not_claimed then 'Not Claimed'
            when coalesce(i.manual_claim_month, a.auto_claim_month) is not null then 'Claimed'
            else 'Not Claimed' end as claim_status
from ledger_invoices i
left join lateral (
  select min(s.return_month) as auto_claim_month
  from schedule_lines s
  where s.company_id = i.company_id
    and norm_doc_no(s.tax_invoice_no) = norm_doc_no(i.external_doc_no)
) a on true;

-- Schedule lines with the ledger invoice they match, if any
create or replace view schedule_line_match with (security_invoker = true) as
select s.*, m.invoice_no as ledger_invoice_no
from schedule_lines s
left join lateral (
  select i.invoice_no from ledger_invoices i
  where i.company_id = s.company_id
    and norm_doc_no(i.external_doc_no) = norm_doc_no(s.tax_invoice_no)
  order by i.posting_date limit 1
) m on true;

-- Row level security
create or replace function member_role(c uuid) returns text
language sql stable security definer set search_path = vat_claims, public as
$$ select role from company_members where company_id = c and user_id = auth.uid() $$;

alter table companies enable row level security;
alter table company_members enable row level security;
alter table ledger_invoices enable row level security;
alter table schedule_lines enable row level security;
alter table vat_returns enable row level security;

create policy companies_read on companies for select using (member_role(id) is not null);
create policy members_read on company_members for select using (member_role(company_id) is not null);
create policy members_admin on company_members for all
  using (member_role(company_id) = 'admin') with check (member_role(company_id) = 'admin');

do $$ declare t text; begin
  foreach t in array array['ledger_invoices','schedule_lines','vat_returns'] loop
    execute format('create policy %I on %I for select using (member_role(company_id) is not null)', t||'_read', t);
    execute format('create policy %I on %I for all using (member_role(company_id) in (''editor'',''admin'')) with check (member_role(company_id) in (''editor'',''admin''))', t||'_write', t);
  end loop;
end $$;

-- Replace one month atomically (upload). Keeps original-invoice marks and manual overrides by invoice_no.
create or replace function replace_ledger_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
  create temp table _keep on commit drop as
    select invoice_no, original_invoice, manual_claim_month, manual_not_claimed
    from ledger_invoices
    where company_id = p_company and date_trunc('month', posting_date) = date_trunc('month', p_month);
  delete from ledger_invoices
    where company_id = p_company and date_trunc('month', posting_date) = date_trunc('month', p_month);
  insert into ledger_invoices (company_id, invoice_no, posting_date, vendor_name, external_doc_no, description,
                               amount_lcy, source_amount, original_invoice, manual_claim_month, manual_not_claimed, updated_by)
  select p_company, r.invoice_no, r.posting_date, r.vendor_name, r.external_doc_no, r.description,
         r.amount_lcy, r.source_amount, k.original_invoice, k.manual_claim_month, coalesce(k.manual_not_claimed, false), auth.uid()
  from jsonb_to_recordset(p_rows) as r(invoice_no text, posting_date date, vendor_name text, external_doc_no text,
                                       description text, amount_lcy numeric, source_amount numeric)
  left join _keep k using (invoice_no);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function replace_schedule_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
  delete from schedule_lines where company_id = p_company and return_month = date_trunc('month', p_month)::date;
  insert into schedule_lines (company_id, return_month, serial_no, invoice_date, tax_invoice_no, supplier_tin,
                              supplier_name, description, purchase_value, vat_amount, created_by)
  select p_company, date_trunc('month', p_month)::date, r.serial_no, r.invoice_date, r.tax_invoice_no, r.supplier_tin,
         r.supplier_name, r.description, r.purchase_value, r.vat_amount, auth.uid()
  from jsonb_to_recordset(p_rows) as r(serial_no text, invoice_date text, tax_invoice_no text, supplier_tin text,
                                       supplier_name text, description text, purchase_value numeric, vat_amount numeric);
  get diagnostics n = row_count;
  return n;
end $$;

-- Grants for the objects created above (default privileges only cover objects created afterwards).
grant all on all tables in schema vat_claims to anon, authenticated, service_role;
grant all on all functions in schema vat_claims to anon, authenticated, service_role;
grant all on all sequences in schema vat_claims to anon, authenticated, service_role;
