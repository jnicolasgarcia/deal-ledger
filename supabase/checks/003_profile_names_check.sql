-- Checks for 003_profile_names.sql. Paste into the Supabase SQL editor after
-- the migration. One transaction ending in rollback: leaves nothing behind.
-- Every row of the result should say PASS.

begin;

create temp table _check (n serial, check_name text, result text, detail text) on commit drop;
grant insert, select on _check to authenticated;
grant usage on sequence _check_n_seq to authenticated;

create function pg_temp.ok(p_name text, p_pass boolean, p_detail text default null) returns void
language sql as $$
  insert into _check (check_name, result, detail)
  values (p_name, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
$$;

select pg_temp.ok('execute: anon none, authenticated yes',
  not has_function_privilege('anon', 'public.get_profile_names(uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.get_profile_names(uuid[])', 'execute'));

select pg_temp.ok('security definer with search_path=public',
  p.prosecdef and p.proconfig @> array['search_path=public'])
from pg_proc p where p.oid = 'public.get_profile_names(uuid[])'::regprocedure;

select pg_temp.ok('returns only user_id and display_name',
  pg_get_function_result('public.get_profile_names(uuid[])'::regprocedure) = 'TABLE(user_id uuid, display_name text)',
  pg_get_function_result('public.get_profile_names(uuid[])'::regprocedure));

do $$
declare
  v_admin  uuid := (select user_id from public.profiles where email = 'admin@demo.dealledger.test');
  v_editor uuid := (select user_id from public.profiles where email = 'editor@demo.dealledger.test');
  v_viewer uuid := (select user_id from public.profiles where email = 'viewer@demo.dealledger.test');
  v_names  text;
  v_n      integer;
begin
  if v_admin is null or v_editor is null or v_viewer is null then
    perform pg_temp.ok('demo users exist (run create_demo_users.py)', false);
    return;
  end if;

  -- editor
  perform set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  set local role authenticated;
  select string_agg(display_name, ', ' order by display_name) into v_names
  from public.get_profile_names(array[v_admin, v_viewer]);
  perform pg_temp.ok('editor gets colleagues'' display names', v_names = 'Demo Admin, Demo Viewer', v_names);
  select count(*) into v_n from public.profiles;
  perform pg_temp.ok('editor still reads only own profile row', v_n = 1, v_n || ' rows');

  -- viewer
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  begin
    perform public.get_profile_names(array[v_admin]);
    perform pg_temp.ok('viewer is refused (42501)', false, 'no error');
  exception when others then
    perform pg_temp.ok('viewer is refused (42501)', sqlstate = '42501', sqlstate || ': ' || sqlerrm);
  end;

  -- too many ids
  perform set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  begin
    perform public.get_profile_names(array(select gen_random_uuid() from generate_series(1, 1001)));
    perform pg_temp.ok('more than 1000 ids is refused (22023)', false, 'no error');
  exception when others then
    perform pg_temp.ok('more than 1000 ids is refused (22023)', sqlstate = '22023', sqlstate);
  end;

  reset role;
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
