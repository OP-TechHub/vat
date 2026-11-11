-- Schedule submissions tab: the VAT schedule submission status of every taxable period (the "DVAT Plan"
-- workbook): which schedules (Sch 1, 2, 3, 4, 6, 7) and SVAT 06 were filed in RAMIS, deferred input VAT, RMI,
-- whether the return is held, and the Sch 6 export CusDecs against those in the CusDec register. One row per
-- period code (IRD YYQM: 1910 = Jan-Mar 2019 quarterly, 2632 = Aug 2026). "Schedules submitted" and "Cusdecs
-- availability" are worked out by the app from these columns. Kept up to date by editing in place or by
-- uploading the workbook again (upload_schedule_submissions), under its own tab permission.
set search_path = vat_claims, public;

create table if not exists schedule_submissions (
  company_id uuid not null references companies(id) on delete cascade,
  period_code text not null check (period_code ~ '^[0-9]{2}[1-4][0-3]$'),
  selected boolean not null default false,
  deferred_input_vat numeric(18,2),
  sch1 text,                         -- Submitted / Not Submitted
  sch2_input_vat numeric(18,2),      -- Sch 2 local input VAT per RAMIS
  sch2_note text,                    -- e.g. "No local purchases" when there is no amount
  sch3 text,
  sch4 text,
  sch6 text,
  sch7 text,
  svat06 text,                       -- Submitted / Not Submitted / Not Applicable
  rmi text,                          -- e.g. Received
  return_availability text,          -- Available / Not Available
  sch6_cusdecs int,                  -- Sch 6 export CusDecs in RAMIS
  cusdecs_in_register int,           -- of those, found in the CusDec register
  remarks text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (company_id, period_code)
);

alter table schedule_submissions enable row level security;
drop policy if exists schedule_submissions_read on schedule_submissions;
drop policy if exists schedule_submissions_insert on schedule_submissions;
drop policy if exists schedule_submissions_update on schedule_submissions;
drop policy if exists schedule_submissions_delete on schedule_submissions;
create policy schedule_submissions_read on schedule_submissions for select using (has_perm(company_id, 'submissions', 'view'));
create policy schedule_submissions_insert on schedule_submissions for insert with check (has_perm(company_id, 'submissions', 'edit'));
create policy schedule_submissions_update on schedule_submissions for update
  using (has_perm(company_id, 'submissions', 'edit')) with check (has_perm(company_id, 'submissions', 'edit'));
create policy schedule_submissions_delete on schedule_submissions for delete using (has_perm(company_id, 'submissions', 'delete'));
grant all on schedule_submissions to authenticated, service_role;

-- The new tab in the per-tab permissions. Members get the access they have on IRD status, its nearest tab.
alter table company_member_permissions drop constraint if exists company_member_permissions_tab_check;
alter table company_member_permissions add constraint company_member_permissions_tab_check
  check (tab in ('summary','invoices','schedule','exports','imports','returns','filing','ird_status','submissions'));
insert into company_member_permissions (company_id, user_id, tab, can_upload, can_edit, can_delete)
select company_id, user_id, 'submissions', can_upload, can_edit, can_delete
from company_member_permissions where tab = 'ird_status'
on conflict do nothing;

-- As in 0015, with schedule_submissions logged under its tab.
create or replace function log_change() returns trigger
language plpgsql security definer set search_path = vat_claims, public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_company uuid := (v_row->>'company_id')::uuid;
  v_key jsonb := '{}'::jsonb;
  v_tab text;
  v_cur text := current_setting('vat_claims.change_set', true);
  v_set bigint;
  k text;
begin
  if tg_op = 'UPDATE' and strip_meta(v_old) = strip_meta(v_new) then
    return null;
  end if;
  foreach k in array tg_argv loop
    v_key := v_key || jsonb_build_object(k, v_row->k);
  end loop;
  v_tab := case tg_table_name
    when 'ledger_invoices' then 'invoices'
    when 'schedule_lines' then 'schedule'
    when 'export_sales' then 'exports'
    when 'import_purchases' then 'imports'
    when 'customs_entries' then coalesce(customs_tab(v_row->>'direction'), 'imports')
    when 'vat_returns' then 'returns'
    when 'return_documents' then case when v_row->>'kind' = 'credit_voucher' then 'ird_status' else 'filing' end
    when 'ird_status' then 'ird_status'
    when 'schedule_submissions' then 'submissions'
    else 'members'
  end;
  if v_cur like v_company::text || ':%' then
    v_set := split_part(v_cur, ':', 2)::bigint;
  end if;
  -- The customs refresh the app runs straight after an edit belongs to that edit.
  if v_set is null and current_setting('vat_claims.derived', true) = 'on' then
    select id into v_set from change_sets
    where company_id = v_company and changed_by is not distinct from auth.uid()
      and changed_at > now() - interval '2 minutes' and undone_by is null
    order by id desc limit 1;
  end if;
  if v_set is null then
    insert into change_sets (company_id, changed_by, label, kind, undo_of)
    values (v_company, auth.uid(),
            nullif(current_setting('vat_claims.label', true), ''),
            nullif(current_setting('vat_claims.kind', true), ''),
            nullif(current_setting('vat_claims.undo_of', true), '')::bigint)
    returning id into v_set;
  end if;
  perform set_config('vat_claims.change_set', v_company::text || ':' || v_set, true);
  insert into change_log (set_id, tbl, tab, op, row_key, old_row, new_row)
  values (v_set, tg_table_name, v_tab, tg_op, v_key, v_old, v_new);
  update change_sets set
    tabs = case when v_tab = any (tabs) then tabs else tabs || v_tab end,
    n_insert = n_insert + (tg_op = 'INSERT')::int,
    n_update = n_update + (tg_op = 'UPDATE')::int,
    n_delete = n_delete + (tg_op = 'DELETE')::int
  where id = v_set;
  return null;
end $$;

drop trigger if exists log_change on schedule_submissions;
create trigger log_change after insert or update or delete on schedule_submissions
  for each row execute function log_change('company_id', 'period_code');

-- Upload the workbook: every period in p_rows is added or has its columns replaced; periods not in the file
-- are kept. Replacing periods already held needs delete permission as well as upload.
create or replace function upload_schedule_submissions(p_company uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = vat_claims, public as $$
declare n int;
begin
  perform require_upload(p_company, 'submissions', exists (
    select 1 from schedule_submissions s
    join jsonb_to_recordset(p_rows) as r(period_code text) on r.period_code = s.period_code
    where s.company_id = p_company));
  perform change_label('Uploaded the schedule submission status for '
    || (select count(*) from jsonb_array_elements(p_rows)) || ' periods', 'upload');
  insert into schedule_submissions (company_id, period_code, selected, deferred_input_vat, sch1, sch2_input_vat, sch2_note,
                                    sch3, sch4, sch6, sch7, svat06, rmi, return_availability, sch6_cusdecs,
                                    cusdecs_in_register, remarks, updated_at, updated_by)
  select p_company, r.period_code, coalesce(r.selected, false), r.deferred_input_vat, r.sch1, r.sch2_input_vat, r.sch2_note,
         r.sch3, r.sch4, r.sch6, r.sch7, r.svat06, r.rmi, r.return_availability, r.sch6_cusdecs,
         r.cusdecs_in_register, r.remarks, now(), auth.uid()
  from jsonb_to_recordset(p_rows) as r(period_code text, selected boolean, deferred_input_vat numeric, sch1 text,
                                       sch2_input_vat numeric, sch2_note text, sch3 text, sch4 text, sch6 text, sch7 text,
                                       svat06 text, rmi text, return_availability text, sch6_cusdecs int,
                                       cusdecs_in_register int, remarks text)
  on conflict (company_id, period_code) do update set
    selected = excluded.selected, deferred_input_vat = excluded.deferred_input_vat, sch1 = excluded.sch1,
    sch2_input_vat = excluded.sch2_input_vat, sch2_note = excluded.sch2_note, sch3 = excluded.sch3, sch4 = excluded.sch4,
    sch6 = excluded.sch6, sch7 = excluded.sch7, svat06 = excluded.svat06, rmi = excluded.rmi,
    return_availability = excluded.return_availability, sch6_cusdecs = excluded.sch6_cusdecs,
    cusdecs_in_register = excluded.cusdecs_in_register, remarks = excluded.remarks,
    updated_at = now(), updated_by = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function upload_schedule_submissions(uuid, jsonb) from public, anon;
grant execute on function upload_schedule_submissions(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
