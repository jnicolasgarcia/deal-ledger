-- 002_auth.sql
-- Authorization boundary: roles, profiles, policies, the weekly read
-- function and the single audited write path (update_deal).
-- Plain SQL, runs top to bottom in the Supabase SQL editor.
--
-- Rules:
-- - anon gets nothing.
-- - deals, deal_events, contacts: select for editor and admin only.
--   No insert/update/delete policy for any app role. Writes come only from
--   update_deal (security definer) and the ingest (service_role).
-- - Viewers read deals only through get_weekly_review().

begin;

-- ---------------------------------------------------------------------------
-- Roles and profiles
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'editor', 'viewer');

create table public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  full_name      text,
  email          text,
  role           public.app_role not null default 'viewer',
  last_login_at  timestamptz
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select, update (role) on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

-- One profile per new auth user, as viewer.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users who existed before this migration get a profile too.
insert into public.profiles (user_id, email, full_name)
select u.id, u.email, nullif(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- current_app_role(): the caller's role, or null (signed out / no profile).
-- Security definer so policies can use it without selecting from profiles
-- under RLS (no recursion in the profiles policies).
-- ---------------------------------------------------------------------------
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role from profiles p where p.user_id = auth.uid()
$$;

revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies. (select ...) wrappers let Postgres evaluate the role once per
-- statement instead of once per row.
-- ---------------------------------------------------------------------------
create policy deals_select_editor_admin on public.deals
  for select to authenticated
  using ((select public.current_app_role()) in ('editor', 'admin'));

create policy deal_events_select_editor_admin on public.deal_events
  for select to authenticated
  using ((select public.current_app_role()) in ('editor', 'admin'));

create policy contacts_select_editor_admin on public.contacts
  for select to authenticated
  using ((select public.current_app_role()) in ('editor', 'admin'));

create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid())
         or (select public.current_app_role()) = 'admin');

-- Column grant limits this to the role column.
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- Guard: a role change that would leave no admin is rejected. Applies to
-- every caller, service_role included. The advisory lock serializes
-- concurrent demotions so two admins can't demote each other at once.
create function public.prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.profiles.last_admin_guard'));
  if not exists (
    select 1 from profiles p where p.role = 'admin' and p.user_id <> old.user_id
  ) then
    raise exception 'role change rejected: it would leave no admin'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_last_admin_removal() from public, anon, authenticated;

create trigger profiles_keep_one_admin
  before update of role on public.profiles
  for each row
  when (old.role = 'admin' and new.role is distinct from 'admin')
  execute function public.prevent_last_admin_removal();

-- ---------------------------------------------------------------------------
-- get_weekly_review(): the only deal read for viewers. Weekly fields only
-- (ASSUMPTIONS.md section 4). assumption_fields is limited to the weekly
-- fields and uses the returned column names.
-- ---------------------------------------------------------------------------
create function public.get_weekly_review()
returns table (
  id                 uuid,
  vertical           text,
  market             text,
  address            text,
  stage              public.deal_stage,
  list_price         numeric,
  bldg_sf            numeric,
  list_price_per_sf  numeric,
  lot_sf             numeric,
  notes              text,
  assumption_fields  text[],
  days_in_stage      integer,
  previous_stage     public.deal_stage
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
    d.stage,
    d.list_price,
    d.bldg_sf,
    d.list_price_per_sf,
    d.lot_sf,
    d.notes_raw,
    array(
      select m.col
      from unnest(d.assumption_fields) as f(header)
      join (values ('metro', 'market'), ('address', 'address'), ('status', 'stage'),
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
      limit 1)
  from deals d
  order by d.vertical, d.stage, d.market, d.address nulls last;
end;
$$;

revoke all on function public.get_weekly_review() from public, anon;
grant execute on function public.get_weekly_review() to authenticated;

-- ---------------------------------------------------------------------------
-- update_deal(deal_id, changes): the single audited write path.
--
-- Editable: stage, market, address, city, state, bldg_sf, list_price,
-- list_price_per_sf, lot_sf, list_price_per_lot_sf, notes_raw, and keys
-- inside attributes (a null value removes the key). Any other key raises.
-- Text is trimmed (empty becomes null). Numbers must be >= 0.
-- Unchanged fields write nothing. If nothing changed, the row is returned
-- untouched (updated_by is not set).
-- ---------------------------------------------------------------------------
create function public.update_deal(deal_id uuid, changes jsonb)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       public.app_role := public.current_app_role();
  v_uid        uuid := auth.uid();
  text_fields  text[] := array['market', 'address', 'city', 'state'];
  num_fields   text[] := array['bldg_sf', 'list_price', 'list_price_per_sf',
                               'lot_sf', 'list_price_per_lot_sf'];
  v_old        public.deals;
  v_new        public.deals;
  v_old_json   jsonb;
  v_bad        text[];
  v_key        text;
  v_val        jsonb;
  v_attr_key   text;
  v_attr_val   jsonb;
  v_attrs      jsonb;
  v_patch      jsonb := '{}'::jsonb;
  v_events     jsonb := '[]'::jsonb;
begin
  if v_role is null or v_role not in ('editor', 'admin') then
    raise exception 'update_deal: editor or admin role required' using errcode = '42501';
  end if;

  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'update_deal: changes must be a non-empty JSON object' using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_bad
  from jsonb_object_keys(changes) as k
  where not (k = any (text_fields || num_fields || array['stage', 'notes_raw', 'attributes']));
  if v_bad is not null then
    raise exception 'update_deal: field not editable: %', array_to_string(v_bad, ', ')
      using errcode = '42501';
  end if;

  select * into v_old from deals d where d.id = update_deal.deal_id for update;
  if not found then
    raise exception 'update_deal: deal % not found', update_deal.deal_id using errcode = 'P0002';
  end if;
  v_old_json := to_jsonb(v_old);

  -- Typed fields
  for v_key, v_val in select j.key, j.value from jsonb_each(changes) as j loop
    continue when v_key = 'attributes';

    if v_key = any (text_fields) or v_key = 'notes_raw' then
      if jsonb_typeof(v_val) not in ('string', 'null') then
        raise exception 'update_deal: % must be text or null', v_key using errcode = '22023';
      end if;
      if jsonb_typeof(v_val) = 'string' then
        v_val := coalesce(to_jsonb(nullif(btrim(v_val #>> '{}'), '')), 'null'::jsonb);
      end if;
      if length(v_val #>> '{}') > (case when v_key = 'notes_raw' then 5000 else 500 end) then
        raise exception 'update_deal: % is too long', v_key using errcode = '22001';
      end if;

    elsif v_key = any (num_fields) then
      if jsonb_typeof(v_val) not in ('number', 'null') then
        raise exception 'update_deal: % must be a number or null', v_key using errcode = '22023';
      end if;
      if jsonb_typeof(v_val) = 'number' and (v_val #>> '{}')::numeric < 0 then
        raise exception 'update_deal: % must be >= 0', v_key using errcode = '22023';
      end if;

    elsif v_key = 'stage' then
      if jsonb_typeof(v_val) <> 'string'
         or not ((v_val #>> '{}') = any (enum_range(null::public.deal_stage)::text[])) then
        raise exception 'update_deal: stage must be one of %',
          array_to_string(enum_range(null::public.deal_stage)::text[], ', ')
          using errcode = '22023';
      end if;
    end if;

    if (v_old_json -> v_key) is distinct from v_val then
      v_patch := v_patch || jsonb_build_object(v_key, v_val);
      v_events := v_events || jsonb_build_array(
        jsonb_build_object('field', v_key, 'old', v_old_json -> v_key, 'new', v_val));
    end if;
  end loop;

  -- Attributes: per-key merge, scalar values only, null removes the key.
  if changes ? 'attributes' then
    if jsonb_typeof(changes -> 'attributes') <> 'object' then
      raise exception 'update_deal: attributes must be a JSON object' using errcode = '22023';
    end if;
    v_attrs := v_old.attributes;
    for v_attr_key, v_attr_val in select j.key, j.value from jsonb_each(changes -> 'attributes') as j loop
      if length(btrim(v_attr_key)) = 0 or length(v_attr_key) > 100 then
        raise exception 'update_deal: attribute names must be 1 to 100 characters' using errcode = '22023';
      end if;
      if jsonb_typeof(v_attr_val) not in ('string', 'number', 'boolean', 'null') then
        raise exception 'update_deal: attribute % must be text, number, boolean or null', v_attr_key
          using errcode = '22023';
      end if;
      if jsonb_typeof(v_attr_val) = 'string' and length(v_attr_val #>> '{}') > 1000 then
        raise exception 'update_deal: attribute % is too long', v_attr_key using errcode = '22001';
      end if;

      if jsonb_typeof(v_attr_val) = 'null' then
        continue when not (v_attrs ? v_attr_key);
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'field', 'attributes.' || v_attr_key, 'old', v_attrs -> v_attr_key, 'new', null));
        v_attrs := v_attrs - v_attr_key;
      elsif (v_attrs -> v_attr_key) is distinct from v_attr_val then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'field', 'attributes.' || v_attr_key, 'old', v_attrs -> v_attr_key, 'new', v_attr_val));
        v_attrs := v_attrs || jsonb_build_object(v_attr_key, v_attr_val);
      end if;
    end loop;
    if v_attrs is distinct from v_old.attributes then
      v_patch := v_patch || jsonb_build_object('attributes', v_attrs);
    end if;
  end if;

  if v_patch = '{}'::jsonb then
    return v_old;  -- nothing changed: no write, no events
  end if;

  v_new := jsonb_populate_record(v_old, v_patch);

  update deals d set
    market                = v_new.market,
    address               = v_new.address,
    city                  = v_new.city,
    state                 = v_new.state,
    bldg_sf               = v_new.bldg_sf,
    list_price            = v_new.list_price,
    list_price_per_sf     = v_new.list_price_per_sf,
    lot_sf                = v_new.lot_sf,
    list_price_per_lot_sf = v_new.list_price_per_lot_sf,
    stage                 = v_new.stage,
    notes_raw             = v_new.notes_raw,
    attributes            = v_new.attributes,
    stage_changed_at      = case when v_new.stage is distinct from v_old.stage
                                 then now() else d.stage_changed_at end,
    updated_by            = v_uid
  where d.id = v_old.id
  returning d.* into v_new;

  insert into deal_events (deal_id, field, old_value, new_value, changed_by)
  select v_old.id, e ->> 'field', e -> 'old', e -> 'new', v_uid
  from jsonb_array_elements(v_events) as e;

  return v_new;
end;
$$;

revoke all on function public.update_deal(uuid, jsonb) from public, anon;
grant execute on function public.update_deal(uuid, jsonb) to authenticated;

commit;
