-- Checks for 008_no_self_role_change.sql. Paste into the Supabase SQL editor
-- after the migration. One transaction ending in rollback: leaves nothing
-- behind. Every row should say PASS.

begin;

create temp table _check (n serial, check_name text, result text, detail text) on commit drop;
grant insert, select on _check to authenticated;
grant usage on sequence _check_n_seq to authenticated;

create function pg_temp.ok(p_name text, p_pass boolean, p_detail text default null) returns void
language sql as $$
  insert into _check (check_name, result, detail)
  values (p_name, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
$$;

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;

select pg_temp.ok('authenticated has no update privilege on profiles',
  not has_table_privilege('authenticated', 'public.profiles', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'role', 'update'));

select pg_temp.ok('profiles_update_admin policy is gone',
  not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'profiles_update_admin'));

do $$
declare
  v_admin  uuid := (select user_id from public.profiles where email = 'admin@demo.dealledger.test');
  v_viewer uuid := (select user_id from public.profiles where email = 'viewer@demo.dealledger.test');
  v_res    text;
  v_n      integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  v_res := pg_temp.err(format('select public.set_user_role(%L, %L)', v_admin, 'viewer'));
  perform pg_temp.ok('admin cannot change own role (42501)', v_res like '42501: %own role%', v_res);
  v_res := pg_temp.err(format('select public.set_user_role(%L, %L)', v_admin, 'admin'));
  perform pg_temp.ok('admin cannot "change" own role even to the same value', v_res like '42501: %own role%', v_res);
  v_res := pg_temp.err(format($q$update public.profiles set role = 'viewer' where user_id = %L$q$, v_viewer));
  perform pg_temp.ok('admin cannot update profiles directly (42501)', v_res like '42501: %', v_res);
  v_res := pg_temp.err(format('select public.set_user_role(%L, %L)', v_viewer, 'editor'));
  perform pg_temp.ok('admin can still change another user''s role', v_res = 'no error', v_res);
  reset role;

  perform pg_temp.ok('admin is still admin', (select role from public.profiles where user_id = v_admin) = 'admin');
  select count(*) into v_n from public.activity_log
   where action = 'role_change' and target_user_id = v_viewer and created_at = now();
  perform pg_temp.ok('the allowed change was logged once', v_n = 1, v_n || ' rows');
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
