-- Checks for 007_activity_log.sql. Paste into the Supabase SQL editor after
-- the migration and after scripts/create_demo_users.py. One transaction
-- ending in rollback: leaves nothing behind. Users are impersonated with
-- set local role + request.jwt.claims. Every row should say PASS.

begin;

create temp table _check (n serial, check_name text, result text, detail text) on commit drop;
grant insert, select on _check to authenticated;
grant usage on sequence _check_n_seq to authenticated;

create function pg_temp.ok(p_name text, p_pass boolean, p_detail text default null) returns void
language sql as $$
  insert into _check (check_name, result, detail)
  values (p_name, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
$$;

-- SQLSTATE of running p_sql as the current role, or 'no error'.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.act_as(p_email text) returns uuid language plpgsql as $$
declare v_id uuid := (select user_id from public.profiles where email = p_email);
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  return v_id;
end;
$$;

-- ---------- structure (as postgres) ----------

select pg_temp.ok('activity_log has RLS', relrowsecurity) from pg_class where oid = 'public.activity_log'::regclass;

select pg_temp.ok('anon has no privilege on activity_log',
  not has_table_privilege('anon', 'public.activity_log', 'select, insert, update, delete, truncate, references, trigger'));

select pg_temp.ok('authenticated: select, insert only; no update/delete',
  has_table_privilege('authenticated', 'public.activity_log', 'select')
  and not has_table_privilege('authenticated', 'public.activity_log', 'update, delete, truncate'));

select pg_temp.ok('authenticated can insert ' || c || ': ' || has_column_privilege('authenticated', 'public.activity_log', c, 'insert'),
  has_column_privilege('authenticated', 'public.activity_log', c, 'insert') = (c in ('user_id', 'action', 'page', 'detail')))
from unnest(array['id', 'user_id', 'action', 'page', 'deal_id', 'target_user_id', 'detail', 'is_demo', 'created_at']) c;

select pg_temp.ok(format('execute on %s: anon=%s authenticated=%s', f,
                         has_function_privilege('anon', f, 'execute'),
                         has_function_privilege('authenticated', f, 'execute')),
                  not has_function_privilege('anon', f, 'execute')
                  and has_function_privilege('authenticated', f, 'execute'))
from unnest(array['public.record_sign_in()', 'public.set_user_role(uuid,public.app_role)',
                  'public.get_admin_users()']) f;

select pg_temp.ok('log_deal_edits is not callable by app roles',
  not has_function_privilege('authenticated', 'public.log_deal_edits()', 'execute')
  and not has_function_privilege('anon', 'public.log_deal_edits()', 'execute'));

-- ---------- behaviour, as each demo user ----------

do $$
declare
  v_admin   uuid := (select user_id from public.profiles where email = 'admin@demo.dealledger.test');
  v_editor  uuid := (select user_id from public.profiles where email = 'editor@demo.dealledger.test');
  v_viewer  uuid := (select user_id from public.profiles where email = 'viewer@demo.dealledger.test');
  v_deal    public.deals := (select d from public.deals d order by natural_key limit 1);
  v_n       integer;
  v_text    text;
  v_res     text;
begin
  -- Viewer
  perform pg_temp.act_as('viewer@demo.dealledger.test');
  set local role authenticated;
  select count(*) into v_n from public.activity_log;
  perform pg_temp.ok('viewer reads 0 activity_log rows', v_n = 0, v_n || ' rows');
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action, page) values (%L, 'page_view', 'weekly')$q$, v_viewer));
  perform pg_temp.ok('viewer can insert its own page_view', v_res = 'no error', v_res);
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action, page) values (%L, 'page_view', 'weekly')$q$, v_admin));
  perform pg_temp.ok('viewer cannot insert a row for another user (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action) values (%L, 'role_change')$q$, v_viewer));
  perform pg_temp.ok('viewer cannot insert a role_change (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action) values (%L, 'sign_in')$q$, v_viewer));
  perform pg_temp.ok('viewer cannot insert a sign_in directly (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action, page, is_demo) values (%L, 'page_view', 'weekly', true)$q$, v_viewer));
  perform pg_temp.ok('viewer cannot set is_demo (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action, page, created_at) values (%L, 'page_view', 'weekly', '2020-01-01')$q$, v_viewer));
  perform pg_temp.ok('viewer cannot set created_at (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err('delete from public.activity_log');
  perform pg_temp.ok('viewer cannot delete (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err(format('select public.set_user_role(%L, %L)', v_viewer, 'admin'));
  perform pg_temp.ok('viewer cannot call set_user_role (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err('select * from public.get_admin_users()');
  perform pg_temp.ok('viewer cannot call get_admin_users (42501)', v_res = '42501', v_res);
  perform public.record_sign_in();
  reset role;
  perform pg_temp.ok('record_sign_in sets last_login_at',
    (select last_login_at from public.profiles where user_id = v_viewer) = now());
  perform pg_temp.ok('record_sign_in logs a sign_in',
    exists (select 1 from public.activity_log where user_id = v_viewer and action = 'sign_in' and created_at = now()));

  -- Editor
  perform pg_temp.act_as('editor@demo.dealledger.test');
  set local role authenticated;
  select count(*) into v_n from public.activity_log;
  perform pg_temp.ok('editor reads 0 activity_log rows', v_n = 0, v_n || ' rows');
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action) values (%L, 'deal_edit')$q$, v_editor));
  perform pg_temp.ok('editor cannot insert a deal_edit directly (42501)', v_res = '42501', v_res);
  v_res := pg_temp.err(format('select public.set_user_role(%L, %L)', v_editor, 'admin'));
  perform pg_temp.ok('editor cannot call set_user_role (42501)', v_res = '42501', v_res);
  perform public.update_deal(v_deal.id, jsonb_build_object('notes_raw', coalesce(v_deal.notes_raw, '') || ' (check)',
                                                           'lot_sf', coalesce(v_deal.lot_sf, 0) + 1));
  perform public.update_deal(v_deal.id, jsonb_build_object('lot_sf', coalesce(v_deal.lot_sf, 0) + 1));  -- no change
  reset role;
  select count(*), max(detail::text) into v_n, v_text from public.activity_log
   where user_id = v_editor and action = 'deal_edit' and deal_id = v_deal.id and created_at = now();
  perform pg_temp.ok('a real edit logs one deal_edit with its fields; a no-op logs nothing',
    v_n = 1 and v_text = '{"fields": ["lot_sf", "notes_raw"]}', v_n || ' rows, ' || coalesce(v_text, 'none'));

  -- Admin
  perform pg_temp.act_as('admin@demo.dealledger.test');
  set local role authenticated;
  select count(*) into v_n from public.activity_log;
  perform pg_temp.ok('admin reads activity_log', v_n > 0, v_n || ' rows');
  select count(*) into v_n from public.get_admin_users();
  perform pg_temp.ok('admin: get_admin_users lists every profile', v_n = (select count(*) from public.profiles), v_n || ' rows');
  perform pg_temp.ok('admin: edits_7d counts the edit above',
    (select edits_7d from public.get_admin_users() where user_id = v_editor) >= 1);
  perform public.set_user_role(v_viewer, 'editor');
  perform public.set_user_role(v_viewer, 'editor');  -- no change
  select count(*), max(detail::text) into v_n, v_text from public.activity_log
   where action = 'role_change' and target_user_id = v_viewer and created_at = now();
  perform pg_temp.ok('set_user_role changes the role and logs it once',
    v_n = 1 and v_text = '{"to": "editor", "from": "viewer"}'
    and (select role from public.profiles where user_id = v_viewer) = 'editor',
    v_n || ' rows, ' || coalesce(v_text, 'none'));
  perform public.set_user_role(v_viewer, null);
  perform pg_temp.ok('set_user_role can remove access (null)',
    (select role from public.profiles where user_id = v_viewer) is null);
  v_res := pg_temp.err(format('select public.set_user_role(%L, %L)', gen_random_uuid(), 'viewer'));
  perform pg_temp.ok('set_user_role on an unknown user: P0002', v_res = 'P0002', v_res);
  v_res := pg_temp.err(format($q$insert into public.activity_log (user_id, action, page) values (%L, 'page_view', 'admin')$q$, v_admin));
  perform pg_temp.ok('admin can insert its own page_view', v_res = 'no error', v_res);
  reset role;

  -- Last-admin guard through set_user_role: demote every other admin, then try self.
  update public.profiles set role = 'editor' where role = 'admin' and user_id <> v_admin;
  perform pg_temp.act_as('admin@demo.dealledger.test');
  set local role authenticated;
  v_res := pg_temp.err(format('select public.set_user_role(%L, %L)', v_admin, 'viewer'));
  perform pg_temp.ok('set_user_role cannot remove the last admin (23514)', v_res = '23514', v_res);
  reset role;
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
