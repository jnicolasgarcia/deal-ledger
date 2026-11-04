-- Checks for 001_init.sql. Paste into the Supabase SQL editor after the
-- migration. Everything runs in one transaction that ends with rollback,
-- so it leaves nothing behind. Every row of the result should say PASS.

begin;

create temp table _check (
  n          serial,
  check_name text,
  result     text,
  detail     text
) on commit drop;

-- ---------- structure ----------

insert into _check (check_name, result, detail)
select 'RLS enabled on ' || c.relname,
       case when c.relrowsecurity then 'PASS' else 'FAIL' end, null
from pg_class c
where c.oid in ('public.deals'::regclass, 'public.deal_events'::regclass,
                'public.contacts'::regclass);

insert into _check (check_name, result, detail)
select 'No policies yet on ' || t,
       case when count(p.policyname) = 0 then 'PASS' else 'FAIL' end,
       count(p.policyname) || ' policies'
from unnest(array['deals', 'deal_events', 'contacts']) t
left join pg_policies p on p.schemaname = 'public' and p.tablename = t
group by t;

-- Grants: anon none, authenticated select only, service_role all.
with expected(role, privs) as (
  values ('anon', ''),
         ('authenticated', 'SELECT'),
         ('service_role', 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE')
), actual as (
  select e.role, t, e.privs,
         coalesce(string_agg(p, ',' order by p)
                    filter (where has_table_privilege(e.role, 'public.' || t, p)), '') as got
  from expected e
  cross join unnest(array['deals', 'deal_events', 'contacts']) t
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                          'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  group by e.role, t, e.privs
)
insert into _check (check_name, result, detail)
select format('Grants for %s on %s', role, t),
       case when got = privs then 'PASS' else 'FAIL' end,
       'got: ' || coalesce(nullif(got, ''), 'none')
from actual;

-- Foreign keys: users -> set null, deal -> cascade.
insert into _check (check_name, result, detail)
select format('FK %s.%s on delete %s', v.rel, v.col, v.want),
       case when c.confdeltype = v.want_code then 'PASS' else 'FAIL' end,
       'confdeltype = ' || coalesce(c.confdeltype::text, 'no FK found')
from (values ('public.deals'::regclass,       'updated_by', 'set null', 'n'),
             ('public.deal_events'::regclass, 'changed_by', 'set null', 'n'),
             ('public.deal_events'::regclass, 'deal_id',    'cascade',  'c'))
       v(rel, col, want, want_code)
join pg_attribute a on a.attrelid = v.rel and a.attname = v.col
left join pg_constraint c on c.conrelid = v.rel and c.contype = 'f'
                         and c.conkey = array[a.attnum];

insert into _check (check_name, result, detail)
select 'deal_stage enum values in funnel order',
       case when enum_range(null::public.deal_stage)::text =
         '{sourcing,in_pipeline,pre_loi,negotiating_loi,negotiating_psa,in_contract,closed,on_hold,unknown}'
       then 'PASS' else 'FAIL' end,
       enum_range(null::public.deal_stage)::text;

insert into _check (check_name, result, detail)
select 'stage_changed_at nullable, no default',
       case when is_nullable = 'YES' and column_default is null then 'PASS' else 'FAIL' end,
       format('nullable=%s default=%s', is_nullable, coalesce(column_default, 'none'))
from information_schema.columns
where table_schema = 'public' and table_name = 'deals' and column_name = 'stage_changed_at';

insert into _check (check_name, result, detail)
select 'Indexes ' || string_agg(want, ', '),
       case when count(i.indexname) = 4 then 'PASS' else 'FAIL' end,
       count(i.indexname) || ' of 4 found'
from unnest(array['deals_stage_idx', 'deals_vertical_idx', 'deals_market_idx',
                  'deal_events_deal_id_changed_at_idx']) want
left join pg_indexes i on i.schemaname = 'public' and i.indexname = want;

-- ---------- behaviour (all writes are rolled back) ----------

do $$
declare
  d      public.deals%rowtype;
  n      integer;
  ts     timestamptz;
begin
  -- Defaults on a minimal row. updated_at is set in the past so the trigger
  -- check below can see it move (now() is fixed within a transaction).
  insert into public.deals (client, vertical, source_tab, source_row, natural_key,
                            created_at, updated_at)
  values ('Client A', 'Food', '__check__', 1, '__check__:1',
          now() - interval '1 day', now() - interval '1 day')
  returning * into d;

  insert into _check (check_name, result, detail) values
    ('Default stage is unknown',
     case when d.stage = 'unknown' then 'PASS' else 'FAIL' end, d.stage::text),
    ('stage_changed_at null on insert',
     case when d.stage_changed_at is null then 'PASS' else 'FAIL' end, coalesce(d.stage_changed_at::text, 'null')),
    ('attributes defaults to {}',
     case when d.attributes = '{}'::jsonb then 'PASS' else 'FAIL' end, d.attributes::text),
    ('assumption_fields defaults to {}',
     case when d.assumption_fields = '{}' then 'PASS' else 'FAIL' end, d.assumption_fields::text);

  -- Trigger keeps updated_at current.
  update public.deals set notes_raw = 'changed' where id = d.id returning updated_at into ts;
  insert into _check (check_name, result, detail) values
    ('Trigger sets updated_at on update',
     case when ts = now() then 'PASS' else 'FAIL' end, ts::text);

  -- authenticated: has select, but RLS with no policies returns no rows.
  begin
    set local role authenticated;
    select count(*) into n from public.deals;
    reset role;
    insert into _check (check_name, result, detail) values
      ('authenticated sees 0 deals (RLS, no policies)',
       case when n = 0 then 'PASS' else 'FAIL' end, n || ' rows visible');
  exception when others then
    reset role;
    insert into _check (check_name, result, detail) values
      ('authenticated sees 0 deals (RLS, no policies)', 'FAIL', sqlerrm);
  end;

  -- authenticated: no insert grant.
  begin
    set local role authenticated;
    insert into public.deals (client, vertical, source_tab, source_row, natural_key)
    values ('x', 'x', '__check__', 2, '__check__:2');
    reset role;
    insert into _check (check_name, result, detail) values
      ('authenticated cannot insert deals', 'FAIL', 'insert succeeded');
  exception
    when insufficient_privilege then
      reset role;
      insert into _check (check_name, result, detail) values
        ('authenticated cannot insert deals', 'PASS', sqlerrm);
    when others then
      reset role;
      insert into _check (check_name, result, detail) values
        ('authenticated cannot insert deals', 'FAIL', 'unexpected: ' || sqlerrm);
  end;

  -- anon: no grants at all, so select is a permission error.
  begin
    set local role anon;
    select count(*) into n from public.deals;
    reset role;
    insert into _check (check_name, result, detail) values
      ('anon cannot read deals', 'FAIL', 'select succeeded, ' || n || ' rows');
  exception
    when insufficient_privilege then
      reset role;
      insert into _check (check_name, result, detail) values
        ('anon cannot read deals', 'PASS', sqlerrm);
    when others then
      reset role;
      insert into _check (check_name, result, detail) values
        ('anon cannot read deals', 'FAIL', 'unexpected: ' || sqlerrm);
  end;

  -- Duplicate natural_key is rejected.
  begin
    insert into public.deals (client, vertical, source_tab, source_row, natural_key)
    values ('x', 'x', '__check__', 3, '__check__:1');
    insert into _check (check_name, result, detail) values
      ('natural_key is unique', 'FAIL', 'duplicate accepted');
  exception when unique_violation then
    insert into _check (check_name, result, detail) values
      ('natural_key is unique', 'PASS', sqlerrm);
  end;

  -- Same source row twice is rejected.
  begin
    insert into public.deals (client, vertical, source_tab, source_row, natural_key)
    values ('x', 'x', '__check__', 1, '__check__:other');
    insert into _check (check_name, result, detail) values
      ('(source_tab, source_row) is unique', 'FAIL', 'duplicate accepted');
  exception when unique_violation then
    insert into _check (check_name, result, detail) values
      ('(source_tab, source_row) is unique', 'PASS', sqlerrm);
  end;

  -- attributes must be a JSON object.
  begin
    insert into public.deals (client, vertical, source_tab, source_row, natural_key, attributes)
    values ('x', 'x', '__check__', 4, '__check__:4', '[]');
    insert into _check (check_name, result, detail) values
      ('attributes must be an object', 'FAIL', 'array accepted');
  exception when check_violation then
    insert into _check (check_name, result, detail) values
      ('attributes must be an object', 'PASS', sqlerrm);
  end;

  -- contacts.raw is required.
  begin
    insert into public.contacts (source_tab, source_row) values ('__check__', 1);
    insert into _check (check_name, result, detail) values
      ('contacts.raw is required', 'FAIL', 'null raw accepted');
  exception when not_null_violation then
    insert into _check (check_name, result, detail) values
      ('contacts.raw is required', 'PASS', sqlerrm);
  end;

  -- Deleting a deal cascades to its events.
  insert into public.deal_events (deal_id, field, old_value, new_value)
  values (d.id, 'stage', '"unknown"', '"sourcing"');
  delete from public.deals where id = d.id;
  select count(*) into n from public.deal_events where deal_id = d.id;
  insert into _check (check_name, result, detail) values
    ('Deleting a deal deletes its events',
     case when n = 0 then 'PASS' else 'FAIL' end, n || ' events left');
end
$$;

select n, result, check_name, detail from _check order by n;

rollback;
