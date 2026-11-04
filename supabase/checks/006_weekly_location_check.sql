-- Checks for 006_weekly_location.sql. Paste into the Supabase SQL editor
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

select pg_temp.ok('returns the weekly columns with city and state',
  pg_get_function_result('public.get_weekly_review()'::regprocedure) =
  'TABLE(id uuid, vertical text, market text, address text, city text, state text, stage deal_stage, '
  'list_price numeric, bldg_sf numeric, list_price_per_sf numeric, lot_sf numeric, notes text, '
  'assumption_fields text[], days_in_stage integer, previous_stage deal_stage, '
  'updated_at timestamp with time zone, imported_at timestamp with time zone)',
  pg_get_function_result('public.get_weekly_review()'::regprocedure));

select pg_temp.ok('execute: public none, anon none, authenticated yes',
  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = 'public.get_weekly_review()'::regprocedure and a.grantee = 0)
  and not has_function_privilege('anon', 'public.get_weekly_review()', 'execute')
  and has_function_privilege('authenticated', 'public.get_weekly_review()', 'execute'));

select pg_temp.ok('security definer with search_path=public',
  p.prosecdef and p.proconfig @> array['search_path=public'])
from pg_proc p where p.oid = 'public.get_weekly_review()'::regprocedure;

do $$
declare
  v_viewer uuid := (select user_id from public.profiles where email = 'viewer@demo.dealledger.test');
  v_norole uuid := (select user_id from public.profiles where email = 'norole@demo.dealledger.test');
  v_rows   integer;
  v_deals  integer := (select count(*) from public.deals);
  v_city   text;
  v_err    text;
begin
  if v_viewer is null then
    perform pg_temp.ok('demo viewer exists (run create_demo_users.py)', false);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  set local role authenticated;

  select count(*) into v_rows from public.get_weekly_review();
  perform pg_temp.ok('viewer gets every deal', v_rows = v_deals, v_rows || ' of ' || v_deals);
  select city || ', ' || state into v_city from public.get_weekly_review() where address = '5861 Washington Blvd';
  perform pg_temp.ok('5861 Washington Blvd is in Culver City, CA', v_city = 'Culver City, CA', v_city);
  select count(*) into v_rows from public.get_weekly_review() where address is null and city is not null;
  perform pg_temp.ok('deals without an address can be told apart by city', v_rows > 0, v_rows || ' deals');
  select count(*) into v_rows from public.deals;
  perform pg_temp.ok('viewer still reads 0 rows from deals directly', v_rows = 0, v_rows || ' rows');

  if v_norole is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_norole, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_norole::text, true);
    begin
      perform 1 from public.get_weekly_review();
      v_err := 'no error';
    exception when others then
      v_err := sqlstate;
    end;
    perform pg_temp.ok('user with no role is still refused (42501)', v_err = '42501', v_err);
  end if;
  reset role;
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
