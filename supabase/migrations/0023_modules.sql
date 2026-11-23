-- Modules. The app now has three areas, chosen from the top level after login:
--   registers  Registers: the one place the Import, Export and Local Sales registers are uploaded
--   vat        VAT Register: the existing VAT tabs
--   tiep       TIEP Import Register: duty-suspended imports and their cancellation against exports
-- A company uses a module only when it is switched on in company_modules (admins switch them). A member
-- sees a module when it is on for the company and they may view at least one of its tabs.
-- Existing companies get registers and vat, so nothing changes for them; tiep starts switched off.
set search_path = vat_claims, public;

create table if not exists company_modules (
  company_id uuid not null references companies (id) on delete cascade,
  module text not null check (module in ('registers', 'vat', 'tiep')),
  enabled_at timestamptz not null default now(),
  enabled_by uuid,
  primary key (company_id, module)
);

insert into company_modules (company_id, module)
select c.id, m.module from companies c cross join unnest(array['registers', 'vat']) as m(module)
on conflict do nothing;

alter table company_modules enable row level security;
drop policy if exists company_modules_read on company_modules;
create policy company_modules_read on company_modules for select using (member_role(company_id) is not null);
-- Changes go through set_company_module only.
grant select on company_modules to authenticated;
grant all on company_modules to service_role;

-- True when module m is switched on for company c and the signed-in user is a member of c.
create or replace function has_module(c uuid, m text) returns boolean
language sql stable security definer set search_path = vat_claims, public as $$
  select member_role(c) is not null
     and exists (select 1 from company_modules where company_id = c and module = m)
$$;
grant execute on function has_module(uuid, text) to authenticated;

-- Switch a module on or off for a company. Admins only. Switching off keeps the module's data and
-- members' tab access; it only hides the module until it is switched on again.
create or replace function set_company_module(p_company uuid, p_module text, p_on boolean) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if member_role(p_company) is distinct from 'admin' then
    raise exception 'Only company admins can switch modules' using errcode = '42501';
  end if;
  if p_module not in ('registers', 'vat', 'tiep') then
    raise exception 'Unknown module %', p_module using errcode = '22023';
  end if;
  if p_on then
    insert into company_modules (company_id, module, enabled_by) values (p_company, p_module, auth.uid())
    on conflict do nothing;
  else
    delete from company_modules where company_id = p_company and module = p_module;
  end if;
end $$;
revoke all on function set_company_module(uuid, text, boolean) from public, anon;
grant execute on function set_company_module(uuid, text, boolean) to authenticated;

-- Which actions a tab offers. View is implied by having a row. Kept in one place so the table check and
-- set_member_access agree with the app's TABS list (lib/permissions.ts).
create or replace function tab_allows(p_tab text, p_action text) returns boolean
language sql immutable as $$
  select case
    when p_tab in ('summary', 'tiep_summary') then false
    when p_tab = 'filing' then p_action in ('upload', 'delete')
    when p_tab = 'tiep_ledger' then p_action in ('edit', 'delete')
    else p_action in ('upload', 'edit', 'delete')
  end
$$;
grant execute on function tab_allows(text, text) to authenticated;

-- The new tabs in the per-tab permissions.
alter table company_member_permissions drop constraint if exists company_member_permissions_tab_check;
alter table company_member_permissions add constraint company_member_permissions_tab_check
  check (tab in (
    'summary','invoices','schedule','exports','imports','returns','filing','ird_status','submissions',
    'reg_imports','reg_exports','reg_local',
    'tiep_summary','tiep_status','tiep_register','tiep_exports','tiep_local','tiep_ledger','tiep_settings'));
alter table company_member_permissions drop constraint if exists company_member_permissions_actions_check;
alter table company_member_permissions add constraint company_member_permissions_actions_check
  check ((not can_upload or tab_allows(tab, 'upload'))
     and (not can_edit or tab_allows(tab, 'edit'))
     and (not can_delete or tab_allows(tab, 'delete')));

-- Members keep doing their register uploads where they did them: Registers › Import gets the access they
-- have on the VAT Import Register, Export and Local Sales the access they have on Export reconciliation.
-- TIEP tabs start with no member access; admins grant it on the Members tab.
insert into company_member_permissions (company_id, user_id, tab, can_upload, can_edit, can_delete)
select company_id, user_id, n.tab, can_upload, can_edit, can_delete
from company_member_permissions p
join (values ('imports', 'reg_imports'), ('exports', 'reg_exports'), ('exports', 'reg_local')) as n(src, tab)
  on p.tab = n.src
on conflict do nothing;

-- As in 0014, with the actions each tab offers taken from tab_allows.
create or replace function set_member_access(p_company uuid, p_user uuid, p_role text, p_perms jsonb) returns void
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if member_role(p_company) is distinct from 'admin' then
    raise exception 'Only company admins can change members' using errcode = '42501';
  end if;
  if p_role not in ('member', 'admin') then
    raise exception 'Role must be member or admin' using errcode = '22023';
  end if;
  if p_role <> 'admin'
     and exists (select 1 from company_members where company_id = p_company and user_id = p_user and role = 'admin')
     and (select count(*) from company_members where company_id = p_company and role = 'admin') <= 1 then
    raise exception 'This is the only admin. Make someone else an admin first.' using errcode = '42501';
  end if;
  insert into company_members (company_id, user_id, role) values (p_company, p_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role;
  delete from company_member_permissions where company_id = p_company and user_id = p_user;
  if p_role = 'member' then
    insert into company_member_permissions (company_id, user_id, tab, can_upload, can_edit, can_delete)
    select p_company, p_user, r.tab,
           coalesce(r.can_upload, false) and tab_allows(r.tab, 'upload'),
           coalesce(r.can_edit, false) and tab_allows(r.tab, 'edit'),
           coalesce(r.can_delete, false) and tab_allows(r.tab, 'delete')
    from jsonb_to_recordset(coalesce(p_perms, '[]'::jsonb)) as r(tab text, can_upload boolean, can_edit boolean, can_delete boolean);
  end if;
end $$;

notify pgrst, 'reload schema';
