-- TIEP Status and TIEP Settings: one permission per sub-tab.
--
-- The two tab keys tiep_status and tiep_settings are replaced by one key per sub-tab. TIEP Status (and
-- Settings) shows when a member may view at least one of its sub-tabs. What each sub-tab may change is
-- enforced here: a table written from more than one sub-tab accepts a write from any of them.
--
--   TIEP Status   tiep_status_entries   By customs entry        view
--                 tiep_status_cancels   By cancellation entry   view
--                 tiep_status_post      Post cancellation       edit            (tiep_post_cancellation)
--                 tiep_status_local     Local sales batches     edit, delete    (tiep_batches, tiep_save_batch)
--                 tiep_status_logbook   Logbook check           view            (tiep_logbook_*: no edits in the app)
--   Settings      tiep_settings_standards   Conversion standards     edit, delete   (tiep_standards)
--                 tiep_settings_items       System items & mapping   edit, delete   (tiep_skumap)
--                 tiep_settings_tiep_items  TIEP items               edit, delete   (tiep_standards: yields)
--                 tiep_settings_confirm     Confirm export mapping   edit           (tiep_skumap)
--                 tiep_settings_mapmud      Item mapping vs MUD      edit, delete   (tiep_skumap, tiep_mudhist)
--                 tiep_settings_general     General                  edit           (tiep_settings, incl. MUD form settings)
--                 tiep_settings_documents   Documents                upload, edit, delete (tiep_documents, files)
--
-- Members who had a permission on tiep_status or tiep_settings get the same on each sub-tab (as far as the
-- sub-tab offers the action). Run once in the Supabase SQL Editor.
set search_path = vat_claims, public;

-- ---------------------------------------------------------------------------------------------------------
-- Actions each tab offers (lib/permissions.ts TABS must agree).
create or replace function tab_allows(p_tab text, p_action text) returns boolean
language sql immutable as $$
  select case
    when p_tab in ('summary', 'tiep_summary', 'tiep_status_entries', 'tiep_status_cancels', 'tiep_status_logbook') then false
    when p_tab = 'filing' then p_action in ('upload', 'delete')
    when p_tab = 'tiep_ledger' then p_action in ('edit', 'delete')
    when p_tab in ('tiep_status_post', 'tiep_settings_confirm', 'tiep_settings_general') then p_action = 'edit'
    when p_tab in ('tiep_status_local', 'tiep_settings_standards', 'tiep_settings_items', 'tiep_settings_tiep_items',
                   'tiep_settings_mapmud') then p_action in ('edit', 'delete')
    else p_action in ('upload', 'edit', 'delete')
  end
$$;

-- Move existing permissions to the sub-tabs, before the constraint drops the old keys.
alter table company_member_permissions drop constraint if exists company_member_permissions_tab_check;
alter table company_member_permissions drop constraint if exists company_member_permissions_actions_check;

insert into company_member_permissions (company_id, user_id, tab, can_upload, can_edit, can_delete)
select p.company_id, p.user_id, n.tab,
       p.can_upload and tab_allows(n.tab, 'upload'),
       p.can_edit and tab_allows(n.tab, 'edit'),
       p.can_delete and tab_allows(n.tab, 'delete')
from company_member_permissions p
join (values
  ('tiep_status', 'tiep_status_entries'), ('tiep_status', 'tiep_status_cancels'), ('tiep_status', 'tiep_status_post'),
  ('tiep_status', 'tiep_status_local'), ('tiep_status', 'tiep_status_logbook'),
  ('tiep_settings', 'tiep_settings_standards'), ('tiep_settings', 'tiep_settings_items'),
  ('tiep_settings', 'tiep_settings_tiep_items'), ('tiep_settings', 'tiep_settings_confirm'),
  ('tiep_settings', 'tiep_settings_mapmud'), ('tiep_settings', 'tiep_settings_general'),
  ('tiep_settings', 'tiep_settings_documents')
) as n(src, tab) on p.tab = n.src
on conflict do nothing;
delete from company_member_permissions where tab in ('tiep_status', 'tiep_settings');

alter table company_member_permissions add constraint company_member_permissions_tab_check
  check (tab in (
    'summary','invoices','schedule','exports','imports','returns','filing','ird_status','submissions',
    'reg_imports','reg_exports','reg_local',
    'tiep_summary','tiep_register','tiep_exports','tiep_local','tiep_ledger',
    'tiep_status_entries','tiep_status_cancels','tiep_status_post','tiep_status_local','tiep_status_logbook',
    'tiep_settings_standards','tiep_settings_items','tiep_settings_tiep_items','tiep_settings_confirm',
    'tiep_settings_mapmud','tiep_settings_general','tiep_settings_documents'));
alter table company_member_permissions add constraint company_member_permissions_actions_check
  check ((not can_upload or tab_allows(tab, 'upload'))
     and (not can_edit or tab_allows(tab, 'edit'))
     and (not can_delete or tab_allows(tab, 'delete')));

-- ---------------------------------------------------------------------------------------------------------
-- Read access to TIEP data: view on any TIEP tab or sub-tab.
create or replace function tiep_view(c uuid) returns boolean
language sql stable security definer set search_path = vat_claims, public as $$
  select has_module(c, 'tiep') and exists (
    select 1 from unnest(array[
      'tiep_summary','tiep_register','tiep_exports','tiep_local','tiep_ledger',
      'tiep_status_entries','tiep_status_cancels','tiep_status_post','tiep_status_local','tiep_status_logbook',
      'tiep_settings_standards','tiep_settings_items','tiep_settings_tiep_items','tiep_settings_confirm',
      'tiep_settings_mapmud','tiep_settings_general','tiep_settings_documents']) t(tab)
    where coalesce(has_perm(c, t.tab, 'view'), false))
$$;

-- p_action on any of the tabs.
create or replace function tiep_can_any(c uuid, p_tabs text[], p_action text) returns boolean
language sql stable security definer set search_path = vat_claims, public as $$
  select has_module(c, 'tiep') and exists (
    select 1 from unnest(p_tabs) t(tab) where coalesce(has_perm(c, t.tab, p_action), false))
$$;
grant execute on function tiep_can_any(uuid, text[], text) to authenticated;

-- Write policies of the tables the sub-tabs change.
do $$ declare t record; begin
  for t in select * from (values
    ('tiep_batches', array['tiep_status_local']),
    ('tiep_logbook_summary', array['tiep_status_logbook']),
    ('tiep_logbook_findings', array['tiep_status_logbook']),
    ('tiep_standards', array['tiep_settings_standards', 'tiep_settings_tiep_items']),
    ('tiep_skumap', array['tiep_settings_items', 'tiep_settings_confirm', 'tiep_settings_mapmud']),
    ('tiep_settings', array['tiep_settings_general']),
    ('tiep_documents', array['tiep_settings_documents']),
    ('tiep_mudhist', array['tiep_settings_mapmud'])
  ) as v(tbl, tabs) loop
    execute format('drop policy if exists %I on %I', t.tbl || '_insert', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_update', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl || '_delete', t.tbl);
    execute format('create policy %I on %I for insert with check (tiep_can_any(company_id, %L, ''edit''))', t.tbl || '_insert', t.tbl, t.tabs);
    execute format('create policy %I on %I for update using (tiep_can_any(company_id, %L, ''edit'')) with check (tiep_can_any(company_id, %L, ''edit''))',
                   t.tbl || '_update', t.tbl, t.tabs, t.tabs);
    execute format('create policy %I on %I for delete using (tiep_can_any(company_id, %L, ''delete''))', t.tbl || '_delete', t.tbl, t.tabs);
  end loop;
end $$;

-- Files under <company>/tiep/documents/ belong to Settings › Documents.
create or replace function storage_perm(p_name text, p_action text) returns boolean
language sql stable set search_path = vat_claims, public as $$
  select case
    when doc_company(p_name) is null then false
    when (storage.foldername(p_name))[2] = 'tiep' then
      case when p_action = 'view' then tiep_view(doc_company(p_name))
           when (storage.foldername(p_name))[3] = 'documents' then tiep_can(doc_company(p_name), 'tiep_settings_documents', p_action)
           else tiep_inv_can(doc_company(p_name), p_action) end
    when (storage.foldername(p_name))[2] = 'customs'
      then customs_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
    when (storage.foldername(p_name))[2] = 'invoices'
      then has_perm(doc_company(p_name), 'invoices', p_action)
    else doc_perm(doc_company(p_name), (storage.foldername(p_name))[3], p_action)
  end
$$;

-- Functions that checked TIEP Status: posting a cancellation needs Post cancellation, saving a batch
-- needs Local sales batches. Their bodies are otherwise unchanged.
do $$
declare f record; v_def text;
begin
  for f in select * from (values
    ('tiep_post_cancellation', 'tiep_status_post', 'Post cancellation'),
    ('tiep_save_batch', 'tiep_status_local', 'Local sales batches')
  ) as v(fn, tab, label) loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'vat_claims' and p.proname = f.fn;
    if v_def is null then
      raise exception 'Function % not found', f.fn;
    end if;
    v_def := replace(v_def, 'tiep_can(p_company, ''tiep_status'', ''edit'')', format('tiep_can(p_company, %L, ''edit'')', f.tab));
    v_def := replace(v_def, 'edit permission on TIEP Status.', format('edit permission on TIEP Status › %s.', f.label));
    execute v_def;
  end loop;
end $$;

-- Change log: the sub-tab that owns each table (entries made before this keep tiep_status / tiep_settings).
do $$
declare v_def text;
begin
  select pg_get_functiondef('vat_claims.log_change()'::regprocedure) into v_def;
  v_def := replace(v_def, $q$when 'tiep_batches' then 'tiep_status'$q$, $q$when 'tiep_batches' then 'tiep_status_local'$q$);
  v_def := replace(v_def, $q$when 'tiep_standards' then 'tiep_settings'$q$, $q$when 'tiep_standards' then 'tiep_settings_standards'$q$);
  v_def := replace(v_def, $q$when 'tiep_skumap' then 'tiep_settings'$q$, $q$when 'tiep_skumap' then 'tiep_settings_items'$q$);
  v_def := replace(v_def, $q$when 'tiep_settings' then 'tiep_settings'$q$, $q$when 'tiep_settings' then 'tiep_settings_general'$q$);
  v_def := replace(v_def, $q$when 'tiep_documents' then 'tiep_settings'$q$, $q$when 'tiep_documents' then 'tiep_settings_documents'$q$);
  v_def := replace(v_def, $q$when 'tiep_mudhist' then 'tiep_settings'$q$, $q$when 'tiep_mudhist' then 'tiep_settings_mapmud'$q$);
  execute v_def;
end $$;

notify pgrst, 'reload schema';
