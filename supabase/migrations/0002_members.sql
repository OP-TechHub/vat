-- Members screen support.
-- The browser cannot read auth.users and the app never uses the service-role key, so two
-- security-definer functions do the email lookups on the database side, limited to company members.
set search_path = vat_claims, public;

-- Members of a company with their email addresses. Any member may read; mirrors members_read.
create or replace function member_list(p_company uuid)
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = vat_claims, public as $$
  select m.user_id, u.email::text, m.role
  from company_members m
  join auth.users u on u.id = m.user_id
  where m.company_id = p_company
    and member_role(p_company) is not null
  order by u.email
$$;

-- Add (or re-role) a member by email. Admins only. The person must already have a login in this
-- Supabase project; the function reports clearly when they do not.
create or replace function add_member_by_email(p_company uuid, p_email text, p_role text)
returns table (user_id uuid, email text, role text)
language plpgsql security definer set search_path = vat_claims, public as $$
declare v_user uuid;
begin
  if member_role(p_company) is distinct from 'admin' then
    raise exception 'Only company admins can add members' using errcode = '42501';
  end if;
  if p_role not in ('viewer','editor','admin') then
    raise exception 'Role must be viewer, editor or admin' using errcode = '22023';
  end if;
  select id into v_user from auth.users where lower(auth.users.email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'No login found for %. Create the user under Authentication first, then add them here.', trim(p_email)
      using errcode = 'P0002';
  end if;
  insert into company_members (company_id, user_id, role) values (p_company, v_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role;
  return query select m.user_id, u.email::text, m.role
    from company_members m join auth.users u on u.id = m.user_id
    where m.company_id = p_company and m.user_id = v_user;
end $$;

revoke all on function member_list(uuid) from public;
revoke all on function add_member_by_email(uuid, text, text) from public;
grant execute on function member_list(uuid) to authenticated;
grant execute on function add_member_by_email(uuid, text, text) to authenticated;
