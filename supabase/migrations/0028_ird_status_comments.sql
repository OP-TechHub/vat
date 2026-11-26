-- IRD status: several comments per taxable period.
--
-- Each comment is kept with who wrote it and when. ird_status.remarks holds the latest comment, kept in step by
-- a trigger, so the Remarks column, its filter, the Excel export and "Last updated" keep working as before.
--
-- Access follows the IRD status tab: view reads the comments, edit adds one, delete removes one. A comment is
-- not edited after it is added; add a new one instead.
--
-- Existing remarks become each period's first comment. Run once in the Supabase SQL Editor.
set search_path = vat_claims, public;

create table if not exists ird_status_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  return_month date not null,                       -- first day of the taxable period
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  author_email text                                 -- filled from the login when added
);
create index if not exists ird_status_comments_period on ird_status_comments (company_id, return_month, created_at);

alter table ird_status_comments enable row level security;
drop policy if exists ird_status_comments_read on ird_status_comments;
drop policy if exists ird_status_comments_insert on ird_status_comments;
drop policy if exists ird_status_comments_delete on ird_status_comments;
create policy ird_status_comments_read on ird_status_comments for select
  using (has_perm(company_id, 'ird_status', 'view'));
create policy ird_status_comments_insert on ird_status_comments for insert
  with check (has_perm(company_id, 'ird_status', 'edit') and created_by = auth.uid());
create policy ird_status_comments_delete on ird_status_comments for delete
  using (has_perm(company_id, 'ird_status', 'delete'));
grant select, insert, delete on ird_status_comments to authenticated;
grant all on ird_status_comments to service_role;

-- Author's email from the login, whatever the client sends.
create or replace function ird_status_comment_author() returns trigger
language plpgsql security definer set search_path = vat_claims, public as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.author_email := (select email from auth.users where id = auth.uid());
  end if;
  new.body := btrim(new.body);
  return new;
end $$;
drop trigger if exists ird_status_comment_author on ird_status_comments;
create trigger ird_status_comment_author before insert on ird_status_comments
  for each row execute function ird_status_comment_author();

-- Latest comment of the period into ird_status.remarks (null when none is left).
create or replace function ird_status_comment_sync() returns trigger
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  r ird_status_comments := coalesce(new, old);
  v_latest text;
begin
  select body into v_latest from ird_status_comments
  where company_id = r.company_id and return_month = r.return_month
  order by created_at desc, id desc limit 1;
  insert into ird_status (company_id, return_month, remarks, updated_at, updated_by)
  values (r.company_id, r.return_month, v_latest, now(), auth.uid())
  on conflict (company_id, return_month) do update
    set remarks = excluded.remarks, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    where ird_status.remarks is distinct from excluded.remarks or tg_op = 'INSERT';
  return null;
end $$;
drop trigger if exists ird_status_comment_sync on ird_status_comments;
create trigger ird_status_comment_sync after insert or delete on ird_status_comments
  for each row execute function ird_status_comment_sync();

-- Existing remarks become the first comment of their period (only where the period has no comments yet),
-- without touching the periods' "Last updated".
alter table ird_status_comments disable trigger ird_status_comment_sync;
insert into ird_status_comments (company_id, return_month, body, created_at, created_by, author_email)
select s.company_id, s.return_month, btrim(s.remarks), s.updated_at, s.updated_by, u.email
from ird_status s
left join auth.users u on u.id = s.updated_by
where nullif(btrim(s.remarks), '') is not null
  and not exists (select 1 from ird_status_comments c where c.company_id = s.company_id and c.return_month = s.return_month);
alter table ird_status_comments enable trigger ird_status_comment_sync;

notify pgrst, 'reload schema';
