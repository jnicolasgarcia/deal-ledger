-- Checks for 002_auth.sql. Paste into the Supabase SQL editor after the
-- migration and after scripts/create_demo_users.py. Everything runs in one
-- transaction that ends with rollback, so it leaves nothing behind.
-- Users are impersonated with set local role + request.jwt.claims.
-- Every row of the result should say PASS.

begin;

create temp table _check (n serial, check_name text, result text, detail text) on commit drop;
grant insert, select on _check to authenticated;
grant usage on sequence _check_n_seq to authenticated;

-- Run SQL as the current role; PASS if it fails with the expected SQLSTATE.
create function pg_temp.expect_error(p_sql text, p_code text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return case when sqlstate = p_code then 'PASS' else 'got ' || sqlstate || ': ' || sqlerrm end;
end;
$$;

create function pg_temp.ok(p_name text, p_pass boolean, p_detail text default null) returns void
language sql as $$
  insert into _check (check_name, result, detail)
  values (p_name, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
$$;

create function pg_temp.err(p_name text, p_res text) returns void
language sql as $$
  insert into _check (check_name, result, detail)
  values (p_name, case when p_res = 'PASS' then 'PASS' else 'FAIL' end, p_res);
$$;

-- ---------- structure (as postgres) ----------

select pg_temp.ok('profiles has RLS', relrowsecurity) from pg_class where oid = 'public.profiles'::regclass;

select pg_temp.ok('policy ' || want || ' exists', exists (
  select 1 from pg_policies where schemaname = 'public' and policyname = want))
from unnest(array['deals_select_editor_admin', 'deal_events_select_editor_admin',
                  'contacts_select_editor_admin', 'profiles_select_own_or_admin',
                  'profiles_update_admin']) want;

select pg_temp.ok('no insert/update/delete policy on ' || t, not exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT'))
from unnest(array['deals', 'deal_events', 'contacts']) t;

select pg_temp.ok(format('execute on %s: anon=%s authenticated=%s', f,
                         has_function_privilege('anon', f, 'execute'),
                         has_function_privilege('authenticated', f, 'execute')),
                  not has_function_privilege('anon', f, 'execute')
                  and has_function_privilege('authenticated', f, 'execute'))
from unnest(array['public.get_weekly_review()', 'public.update_deal(uuid,jsonb)',
                  'public.current_app_role()']) f;

select pg_temp.ok('functions are security definer with search_path=public',
                  count(*) = 3 and bool_and(p.prosecdef)
                  and bool_and(p.proconfig @> array['search_path=public']),
                  string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-'), ' '))
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('get_weekly_review', 'update_deal', 'current_app_role');

select pg_temp.ok('profiles grants: authenticated select + update(role) only, anon none',
  has_table_privilege('authenticated', 'public.profiles', 'select')
  and has_column_privilege('authenticated', 'public.profiles', 'role', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'email', 'update')
  and not has_table_privilege('authenticated', 'public.profiles', 'insert')
  and not has_table_privilege('authenticated', 'public.profiles', 'delete')
  and not has_table_privilege('anon', 'public.profiles', 'select'));

select pg_temp.ok('last-admin guard trigger on profiles', exists (
  select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_keep_one_admin'));

select pg_temp.ok('signup trigger on auth.users', exists (
  select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'));

-- Column list as of 004 (which added updated_at and imported_at).
select pg_temp.ok('get_weekly_review returns only weekly columns',
  pg_get_function_result('public.get_weekly_review()'::regprocedure) =
  'TABLE(id uuid, vertical text, market text, address text, stage deal_stage, list_price numeric, '
  'bldg_sf numeric, list_price_per_sf numeric, lot_sf numeric, notes text, assumption_fields text[], '
  'days_in_stage integer, previous_stage deal_stage, updated_at timestamp with time zone, '
  'imported_at timestamp with time zone)',
  pg_get_function_result('public.get_weekly_review()'::regprocedure));

-- ---------- behaviour ----------

do $$
declare
  v_admin   uuid := (select user_id from public.profiles where email = 'admin@demo.dealledger.test');
  v_editor  uuid := (select user_id from public.profiles where email = 'editor@demo.dealledger.test');
  v_viewer  uuid := (select user_id from public.profiles where email = 'viewer@demo.dealledger.test');
  v_deal    public.deals;
  v_row     public.deals;
  v_n       integer;
  v_ts      timestamptz;
  v_w       record;
  v_ts_role text;
begin
  if v_admin is null or v_editor is null or v_viewer is null then
    perform pg_temp.ok('demo users exist (run create_demo_users.py)', false);
    return;
  end if;

  -- Test deal: one in sourcing with no prior events.
  select * into v_deal from public.deals d
  where d.stage = 'sourcing'
    and not exists (select 1 from public.deal_events e where e.deal_id = d.id)
  order by d.natural_key limit 1;
  if v_deal.id is null then
    perform pg_temp.ok('found a sourcing deal to test with', false);
    return;
  end if;

  -- ===== as editor =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  set local role authenticated;

  perform pg_temp.ok('editor: current_app_role() = editor', public.current_app_role() = 'editor');

  v_row := public.update_deal(v_deal.id, '{"stage": "in_pipeline"}');
  perform pg_temp.ok('stage change: stage, stage_changed_at = now(), updated_by = editor',
    v_row.stage = 'in_pipeline' and v_row.stage_changed_at = now() and v_row.updated_by = v_editor,
    format('stage=%s changed_at=%s by=%s', v_row.stage, v_row.stage_changed_at, v_row.updated_by));
  select count(*) into v_n from public.deal_events e
  where e.deal_id = v_deal.id and e.field = 'stage' and e.old_value = '"sourcing"'
    and e.new_value = '"in_pipeline"' and e.changed_by = v_editor;
  perform pg_temp.ok('stage change: one event with old/new/changed_by', v_n = 1, v_n || ' event(s)');

  -- Same values again: no events, no write.
  v_row := public.update_deal(v_deal.id,
    jsonb_build_object('stage', 'in_pipeline', 'notes_raw', v_deal.notes_raw, 'market', v_deal.market));
  select count(*) into v_n from public.deal_events where deal_id = v_deal.id;
  perform pg_temp.ok('unchanged fields write no event', v_n = 1, v_n || ' event(s) total');

  -- Make stage_changed_at old (as postgres) so we can see it stay put.
  reset role;
  update public.deals set stage_changed_at = now() - interval '3 days' where id = v_deal.id;
  set local role authenticated;

  v_row := public.update_deal(v_deal.id, '{"list_price": 123456, "city": "  Testville  "}');
  perform pg_temp.ok('non-stage change keeps stage_changed_at',
    v_row.stage_changed_at = now() - interval '3 days', v_row.stage_changed_at::text);
  perform pg_temp.ok('number and trimmed text saved',
    v_row.list_price = 123456 and v_row.city = 'Testville', format('%s / %s', v_row.list_price, v_row.city));
  select count(*) into v_n from public.deal_events
  where deal_id = v_deal.id and field in ('list_price', 'city');
  perform pg_temp.ok('one event per changed field', v_n = 2, v_n || ' event(s)');

  v_row := public.update_deal(v_deal.id, '{"attributes": {"_check": "x", "_absent": null}}');
  v_row := public.update_deal(v_deal.id, '{"attributes": {"_check": null}}');
  select count(*) into v_n from public.deal_events where deal_id = v_deal.id and field like 'attributes.%';
  perform pg_temp.ok('attribute set + remove: 2 events, removing absent key: none',
    v_n = 2 and not (v_row.attributes ? '_check'), v_n || ' event(s)');

  perform pg_temp.err('forbidden key natural_key raises 42501', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{"natural_key": "x"}'), '42501'));
  perform pg_temp.err('forbidden key stage_changed_at raises 42501', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{"stage_changed_at": null}'), '42501'));
  perform pg_temp.err('text in a number field raises 22023', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{"list_price": "abc"}'), '22023'));
  perform pg_temp.err('negative number raises 22023', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{"lot_sf": -1}'), '22023'));
  perform pg_temp.err('invalid stage raises 22023', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{"stage": "won"}'), '22023'));
  perform pg_temp.err('empty changes raises 22023', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{}'), '22023'));
  perform pg_temp.err('nested attribute value raises 22023', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{"attributes": {"a": {"b": 1}}}'), '22023'));
  perform pg_temp.err('editor direct update on deals is denied', pg_temp.expect_error(
    format('update public.deals set notes_raw = notes_raw where id = %L', v_deal.id), '42501'));

  select * into v_w from public.get_weekly_review() w where w.id = v_deal.id;
  perform pg_temp.ok('weekly: days_in_stage = 3, previous_stage = sourcing',
    v_w.days_in_stage = 3 and v_w.previous_stage = 'sourcing',
    format('days=%s previous=%s', v_w.days_in_stage, v_w.previous_stage));
  select count(*) into v_n from public.get_weekly_review() w
  where w.days_in_stage is null and w.id <> v_deal.id;
  perform pg_temp.ok('weekly: days_in_stage null where stage_changed_at is null', v_n > 0, v_n || ' rows');

  select count(*) into v_n from public.deal_events;
  perform pg_temp.ok('editor reads deal_events', v_n > 0, v_n || ' rows');

  -- ===== as viewer =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);

  select count(*) into v_n from public.deals;
  perform pg_temp.ok('viewer reads 0 deals', v_n = 0, v_n || ' rows');
  select count(*) into v_n from public.deal_events;
  perform pg_temp.ok('viewer reads 0 deal_events (events exist)', v_n = 0, v_n || ' rows');
  select count(*) into v_n from public.contacts;
  perform pg_temp.ok('viewer reads 0 contacts', v_n = 0, v_n || ' rows');
  select count(*) into v_n from public.get_weekly_review();
  perform pg_temp.ok('viewer can call get_weekly_review', v_n > 0, v_n || ' rows');
  perform pg_temp.err('viewer update_deal raises 42501', pg_temp.expect_error(
    format('select public.update_deal(%L, %L)', v_deal.id, '{"notes_raw": "x"}'), '42501'));
  select count(*) into v_n from public.profiles;
  perform pg_temp.ok('viewer reads only own profile', v_n = 1, v_n || ' rows');
  update public.profiles set role = 'admin' where user_id = v_viewer;
  get diagnostics v_n = row_count;
  perform pg_temp.ok('viewer cannot change own role', v_n = 0, v_n || ' rows updated');

  -- ===== as admin =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  select count(*) into v_n from public.profiles;
  perform pg_temp.ok('admin reads all profiles', v_n >= 3, v_n || ' rows');
  update public.profiles set role = 'editor' where user_id = v_viewer;
  get diagnostics v_n = row_count;
  perform pg_temp.ok('admin can change a role', v_n = 1, v_n || ' rows updated');
  perform pg_temp.err('admin cannot update other profile columns', pg_temp.expect_error(
    format('update public.profiles set email = %L where user_id = %L', 'x@y.z', v_viewer), '42501'));
  perform pg_temp.err('admin direct update on deals is denied', pg_temp.expect_error(
    format('update public.deals set notes_raw = notes_raw where id = %L', v_deal.id), '42501'));

  -- Last-admin guard. Make the demo admin the only admin first (as postgres).
  reset role;
  update public.profiles set role = 'editor' where role = 'admin' and user_id <> v_admin;
  set local role authenticated;

  perform pg_temp.err('last admin cannot demote themselves (23514)', pg_temp.expect_error(
    format('update public.profiles set role = %L where user_id = %L', 'viewer', v_admin), '23514'));
  select role::text into v_ts_role from public.profiles where user_id = v_admin;
  perform pg_temp.ok('last admin is still admin', v_ts_role = 'admin', v_ts_role);

  update public.profiles set role = 'admin' where user_id = v_viewer;   -- second admin
  update public.profiles set role = 'viewer' where user_id = v_admin;   -- now allowed
  get diagnostics v_n = row_count;
  perform pg_temp.ok('admin can step down when another admin exists', v_n = 1, v_n || ' rows updated');

  -- The guard applies to everyone, service_role and postgres included.
  reset role;
  perform pg_temp.err('guard also blocks postgres removing the last admin', pg_temp.expect_error(
    format('update public.profiles set role = %L where user_id = %L', 'viewer', v_viewer), '23514'));
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
