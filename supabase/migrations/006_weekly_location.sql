-- 006_weekly_location.sql
-- get_weekly_review() also returns city and state, so weekly cards can say
-- where a site is (5861 Washington Blvd is in Culver City, CA, under the
-- Atlanta search) and tell deals without an address apart. City and State
-- are also added to the assumption mapping. Everything else is unchanged
-- from 004. The return type changes, so the function is dropped and
-- recreated in one transaction, with its grants re-applied. Plain SQL, runs
-- top to bottom in the Supabase SQL editor.

begin;

drop function public.get_weekly_review();

create function public.get_weekly_review()
returns table (
  id                 uuid,
  vertical           text,
  market             text,
  address            text,
  city               text,
  state              text,
  stage              public.deal_stage,
  list_price         numeric,
  bldg_sf            numeric,
  list_price_per_sf  numeric,
  lot_sf             numeric,
  notes              text,
  assumption_fields  text[],
  days_in_stage      integer,
  previous_stage     public.deal_stage,
  updated_at         timestamptz,
  imported_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.current_app_role() is null then
    raise exception 'get_weekly_review: sign in required' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.vertical,
    d.market,
    d.address,
    d.city,
    d.state,
    d.stage,
    d.list_price,
    d.bldg_sf,
    d.list_price_per_sf,
    d.lot_sf,
    d.notes_raw,
    array(
      select m.col
      from unnest(d.assumption_fields) as f(header)
      join (values ('metro', 'market'), ('address', 'address'), ('city', 'city'),
                   ('state', 'state'), ('status', 'stage'),
                   ('list price', 'list_price'), ('bldg sf', 'bldg_sf'),
                   ('list price/sf', 'list_price_per_sf'), ('lot sf', 'lot_sf'),
                   ('notes', 'notes')) as m(header, col)
        on m.header = lower(btrim(f.header))
      order by m.col
    ),
    case when d.stage_changed_at is null then null
         else floor(extract(epoch from (now() - d.stage_changed_at)) / 86400)::integer
    end,
    -- Stage at the start of the 7-day window, if it changed since and differs now.
    (select nullif((e.old_value #>> '{}')::public.deal_stage, d.stage)
       from deal_events e
      where e.deal_id = d.id
        and e.field = 'stage'
        and e.changed_at >= now() - interval '7 days'
      order by e.changed_at asc
      limit 1),
    d.updated_at,
    d.created_at
  from deals d
  order by d.vertical, d.stage, d.market, d.address nulls last;
end;
$$;

revoke all on function public.get_weekly_review() from public, anon;
grant execute on function public.get_weekly_review() to authenticated;

commit;
