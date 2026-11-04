-- Checks for 005_no_default_role.sql. Paste into the Supabase SQL editor
-- after the migration. One transaction ending in rollback: leaves nothing
-- behind. Every row of the result should say PASS.

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
  return sqlstate;
end;
$$;

select pg_temp.ok('profiles.role is nullable with no default',
  is_nullable = 'YES' and column_default is null,
  format('nullable=%s default=%s', is_nullable, coalesce(column_default, 'none')))
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'role';

select pg_temp.ok('demo users keep their roles',
  string_agg(email || '=' || coalesce(role::text, 'null'), ', ' order by email) like
  'admin@demo.dealledger.test=admin, editor@demo.dealledger.test=editor, %viewer@demo.dealledger.test=viewer',
  string_agg(email || '=' || coalesce(role::text, 'null'), ', ' order by email))
from public.profiles where email like '%@demo.dealledger.test';

do $$
declare
  v_id   uuid := gen_random_uuid();
  v_role text;
  v_n    integer;
  v_deal uuid := (select id from public.deals limit 1);
begin
  -- A brand-new auth user (rolled back at the end) gets a profile with no role.
  begin
    insert into auth.users (id, email, aud, role) values (v_id, 'no-role-check@example.test', 'authenticated', 'authenticated');
    select coalesce(role::text, 'null') into v_role from public.profiles where user_id = v_id;
    perform pg_temp.ok('signup trigger creates the profile with no role', v_role = 'null', v_role);
  exception when others then
    perform pg_temp.ok('signup trigger creates the profile with no role', false, 'insert into auth.users failed: ' || sqlerrm);
    return;
  end;

  -- Signed in as that user: no access anywhere, own profile still readable.
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  set local role authenticated;

  perform pg_temp.ok('current_app_role() is null', public.current_app_role() is null);
  select count(*) into v_n from public.deals;
  perform pg_temp.ok('reads 0 deals', v_n = 0, v_n || ' rows');
  select count(*) into v_n from public.deal_events;
  perform pg_temp.ok('reads 0 deal_events', v_n = 0, v_n || ' rows');
  perform pg_temp.ok('get_weekly_review is refused (42501)', pg_temp.err('select * from public.get_weekly_review()') = '42501');
  perform pg_temp.ok('update_deal is refused (42501)',
    pg_temp.err(format('select public.update_deal(%L, %L)', v_deal, '{"notes_raw": "x"}')) = '42501');
  perform pg_temp.ok('get_profile_names is refused (42501)',
    pg_temp.err(format('select * from public.get_profile_names(array[%L]::uuid[])', v_id)) = '42501');
  select count(*) into v_n from public.profiles;
  perform pg_temp.ok('reads only its own profile', v_n = 1, v_n || ' rows');
  update public.profiles set role = 'admin' where user_id = v_id;
  get diagnostics v_n = row_count;
  perform pg_temp.ok('cannot give itself a role', v_n = 0, v_n || ' rows updated');
  reset role;
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
