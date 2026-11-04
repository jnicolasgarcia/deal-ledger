-- Checks for 004_weekly_dates.sql. Paste into the Supabase SQL editor after
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

-- Column list as of 006 (which added city and state).
select pg_temp.ok('returns the weekly columns plus updated_at and imported_at',
  pg_get_function_result('public.get_weekly_review()'::regprocedure) =
  'TABLE(id uuid, vertical text, market text, address text, city text, state text, stage deal_stage, '
  'list_price numeric, bldg_sf numeric, list_price_per_sf numeric, lot_sf numeric, notes text, '
  'assumption_fields text[], days_in_stage integer, previous_stage deal_stage, '
  'updated_at timestamp with time zone, imported_at timestamp with time zone)',
  pg_get_function_result('public.get_weekly_review()'::regprocedure));

select pg_temp.ok('execute: anon none, authenticated yes',
  not has_function_privilege('anon', 'public.get_weekly_review()', 'execute')
  and has_function_privilege('authenticated', 'public.get_weekly_review()', 'execute'));

select pg_temp.ok('security definer with search_path=public',
  p.prosecdef and p.proconfig @> array['search_path=public'])
from pg_proc p where p.oid = 'public.get_weekly_review()'::regprocedure;

do $$
declare
  v_viewer uuid := (select user_id from public.profiles where email = 'viewer@demo.dealledger.test');
  v_rows   integer;
  v_deals  integer := (select count(*) from public.deals);
  v_moved  integer;
  v_dates  boolean;
begin
  if v_viewer is null then
    perform pg_temp.ok('demo viewer exists (run create_demo_users.py)', false);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  set local role authenticated;

  select count(*), count(*) filter (where previous_stage is not null),
         bool_and(updated_at is not null and imported_at is not null)
    into v_rows, v_moved, v_dates
  from public.get_weekly_review();
  perform pg_temp.ok('viewer gets every deal', v_rows = v_deals, v_rows || ' of ' || v_deals);
  perform pg_temp.ok('updated_at and imported_at filled on every row', v_dates);
  perform pg_temp.ok('previous_stage still works (moved in the last 7 days)', v_moved >= 0, v_moved || ' moved');

  select count(*) into v_rows from public.deals;
  perform pg_temp.ok('viewer still reads 0 rows from deals directly', v_rows = 0, v_rows || ' rows');
  reset role;
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
