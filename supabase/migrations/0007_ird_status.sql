-- IRD status per taxable period: credit voucher status, date and value. The deferred import VAT (cage 4)
-- and refund due (cage 15) shown beside them come from vat_returns. The voucher itself is kept in the
-- vat-claims bucket as a return_documents row of kind 'credit_voucher'.
set search_path = vat_claims, public;

create table ird_status (
  company_id uuid not null references companies(id) on delete cascade,
  return_month date not null,                  -- first day of the taxable period
  status text check (status in ('received', 'pending', 'submission')),   -- null = not set
  voucher_date date,
  voucher_value numeric(18,2),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (company_id, return_month)
);

alter table ird_status enable row level security;
create policy ird_status_read on ird_status for select using (member_role(company_id) is not null);
create policy ird_status_write on ird_status for all
  using (member_role(company_id) in ('editor','admin')) with check (member_role(company_id) in ('editor','admin'));
grant all on ird_status to anon, authenticated, service_role;

-- Allow the credit voucher as a third document kind.
alter table return_documents drop constraint if exists return_documents_kind_check;
alter table return_documents add constraint return_documents_kind_check
  check (kind in ('return', 'acknowledgement', 'credit_voucher'));

notify pgrst, 'reload schema';
