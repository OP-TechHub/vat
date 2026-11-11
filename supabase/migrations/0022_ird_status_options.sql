-- Extra IRD statuses that company admins add on the IRD status tab, beside the four built in
-- (received, pending, submission, rmi). ird_status.status holds a built-in key or the id of one of
-- these options; renaming an option renames it on every period, and an option in use cannot be deleted.
set search_path = vat_claims, public;

create table if not exists ird_status_options (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create unique index if not exists ird_status_options_label on ird_status_options (company_id, lower(btrim(label)));

alter table ird_status_options enable row level security;
drop policy if exists ird_status_options_read on ird_status_options;
drop policy if exists ird_status_options_write on ird_status_options;
create policy ird_status_options_read on ird_status_options for select using (member_role(company_id) is not null);
create policy ird_status_options_write on ird_status_options for all
  using (member_role(company_id) = 'admin') with check (member_role(company_id) = 'admin');
grant all on ird_status_options to authenticated, service_role;

-- The status is a built-in key or one of the company's options.
alter table ird_status drop constraint if exists ird_status_status_check;

create or replace function ird_status_check_status() returns trigger
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if new.status is null or new.status in ('received', 'pending', 'submission', 'rmi') then return new; end if;
  if exists (select 1 from ird_status_options o where o.company_id = new.company_id and o.id::text = new.status) then
    return new;
  end if;
  raise exception 'Unknown IRD status "%"', new.status using errcode = '23514';
end $$;

drop trigger if exists ird_status_check_status on ird_status;
create trigger ird_status_check_status before insert or update of status on ird_status
  for each row execute function ird_status_check_status();

-- An option still set on a period cannot be deleted.
create or replace function ird_status_option_in_use() returns trigger
language plpgsql security definer set search_path = vat_claims, public as $$
declare n int;
begin
  -- The company itself is being deleted: let the cascade through.
  if not exists (select 1 from companies c where c.id = old.company_id) then return old; end if;
  select count(*) into n from ird_status s where s.company_id = old.company_id and s.status = old.id::text;
  if n > 0 then
    raise exception '"%" is the status of % period(s). Change their status first.', old.label, n using errcode = '23503';
  end if;
  return old;
end $$;

drop trigger if exists ird_status_option_in_use on ird_status_options;
create trigger ird_status_option_in_use before delete on ird_status_options
  for each row execute function ird_status_option_in_use();

notify pgrst, 'reload schema';
