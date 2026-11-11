-- Remarks on the IRD status of each taxable period: free text typed on the IRD status tab.
set search_path = vat_claims, public;

alter table ird_status add column if not exists remarks text;

notify pgrst, 'reload schema';
