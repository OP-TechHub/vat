-- A fourth IRD status: "RMI Form Received" (the IRD's request for more information has been received).
set search_path = vat_claims, public;

alter table ird_status drop constraint if exists ird_status_status_check;
alter table ird_status add constraint ird_status_status_check
  check (status in ('received', 'pending', 'submission', 'rmi'));

notify pgrst, 'reload schema';
