-- IRD input schedule: two manually maintained columns per line.
--   ledger_availability: 'none' (default, not yet reviewed), 'available' or 'not_available' in the ledger
--   ledger_reference:    free-text ledger reference entered by hand
-- Both survive a re-upload of the month, matched by tax invoice number (like ledger overrides by invoice_no).
set search_path = vat_claims, public;

alter table schedule_lines
  add column if not exists ledger_availability text not null default 'none'
    check (ledger_availability in ('none','available','not_available')),
  add column if not exists ledger_reference text,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id);

-- The view selects s.*, whose column list was fixed when it was created, so it must be rebuilt
-- to expose the new columns. The definition is unchanged.
drop view if exists schedule_line_match;
create view schedule_line_match with (security_invoker = true) as
select s.*, m.invoice_no as ledger_invoice_no
from schedule_lines s
left join lateral (
  select i.invoice_no from ledger_invoices i
  where i.company_id = s.company_id
    and norm_doc_no(i.external_doc_no) = norm_doc_no(s.tax_invoice_no)
  order by i.posting_date limit 1
) m on true;
grant all on schedule_line_match to anon, authenticated, service_role;

-- Re-upload keeps the manual ledger fields of lines with the same tax invoice number in that month.
create or replace function replace_schedule_month(p_company uuid, p_month date, p_rows jsonb) returns int
language plpgsql security invoker set search_path = vat_claims, public as $$
declare n int;
begin
  create temp table _keep_sched on commit drop as
    select distinct on (norm_doc_no(tax_invoice_no))
           norm_doc_no(tax_invoice_no) as doc_key, ledger_availability, ledger_reference, updated_at, updated_by
    from schedule_lines
    where company_id = p_company and return_month = date_trunc('month', p_month)::date
      and norm_doc_no(tax_invoice_no) is not null
    order by norm_doc_no(tax_invoice_no),
             (ledger_availability <> 'none') desc,
             (nullif(trim(ledger_reference), '') is not null) desc,
             updated_at desc nulls last;
  delete from schedule_lines where company_id = p_company and return_month = date_trunc('month', p_month)::date;
  insert into schedule_lines (company_id, return_month, serial_no, invoice_date, tax_invoice_no, supplier_tin,
                              supplier_name, description, purchase_value, vat_amount, created_by,
                              ledger_availability, ledger_reference, updated_at, updated_by)
  select p_company, date_trunc('month', p_month)::date, r.serial_no, r.invoice_date, r.tax_invoice_no, r.supplier_tin,
         r.supplier_name, r.description, r.purchase_value, r.vat_amount, auth.uid(),
         coalesce(k.ledger_availability, 'none'), k.ledger_reference, k.updated_at, k.updated_by
  from jsonb_to_recordset(p_rows) as r(serial_no text, invoice_date text, tax_invoice_no text, supplier_tin text,
                                       supplier_name text, description text, purchase_value numeric, vat_amount numeric)
  left join _keep_sched k on k.doc_key = norm_doc_no(r.tax_invoice_no);
  get diagnostics n = row_count;
  return n;
end $$;
