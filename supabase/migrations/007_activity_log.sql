-- 007_activity_log.sql
-- Usage log for the admin view: sign-ins, page views (deals, weekly, admin),
-- deal edits and role changes. Only admins read it.
-- Plain SQL, runs top to bottom in the Supabase SQL editor.
--
-- Who writes what:
-- - page_view: the app's server code inserts it as the signed-in user. The
--   policy allows only the user's own page_view rows, and the column grants
--   leave out created_at and is_demo, so neither can be forged.
-- - sign_in: record_sign_in(), called by the sign-in action. Also sets
--   profiles.last_login_at.
-- - role_change: set_user_role(), the role change path for the admin view.
--   The update and its log row commit together.
-- - deal_edit: a trigger on deal_events, so every update_deal save that
--   changed something logs one row (fields listed), in the same transaction.
-- - is_demo: only the secret key (scripts/seed_demo_data.py) sets it.

begin;

create table public.activity_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users (id) on delete set null,  -- who did it; null if the account was deleted
  action          text not null check (action in ('sign_in', 'page_view', 'deal_edit', 'role_change')),
  page            text check (page in ('deals', 'weekly', 'admin')),
  deal_id         uuid references public.deals (id) on delete set null,
  target_user_id  uuid references auth.users (id) on delete set null,  -- role_change: whose role
  detail          jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 2000),
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint activity_log_page_only_for_views check ((action = 'page_view') = (page is not null)),
  constraint activity_log_deal_only_for_edits check (deal_id is null or action = 'deal_edit'),
  constraint activity_log_target_only_for_roles check (target_user_id is null or action = 'role_change')
);

comment on table public.activity_log is 'Usage log. Admins read it; see 007 for who writes each action.';
comment on column public.activity_log.is_demo is 'true = seeded demo activity (scripts/seed_demo_data.py), not real usage';

create index activity_log_created_at_idx on public.activity_log (created_at desc);
create index activity_log_user_created_at_idx on public.activity_log (user_id, created_at desc);

alter table public.activity_log enable row level security;

revoke all on table public.activity_log from anon, authenticated;
grant select on table public.activity_log to authenticated;
grant insert (user_id, action, page, detail) on table public.activity_log to authenticated;
grant all on table public.activity_log to service_role;

create policy activity_log_select_admin on public.activity_log
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');

create policy activity_log_insert_own_page_view on public.activity_log
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and action = 'page_view'
              and (select public.current_app_role()) is not null);

-- ---------------------------------------------------------------------------
-- record_sign_in(): called once after a successful password sign-in.
-- ---------------------------------------------------------------------------
create function public.record_sign_in()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'record_sign_in: sign in required' using errcode = '42501';
  end if;
  update profiles set last_login_at = now() where user_id = v_uid;
  insert into activity_log (user_id, action) values (v_uid, 'sign_in');
end;
$$;

revoke all on function public.record_sign_in() from public, anon;
grant execute on function public.record_sign_in() to authenticated;

-- ---------------------------------------------------------------------------
-- set_user_role(target, new_role): admins only. new_role null = no access.
-- The last-admin guard (002) still applies. No change = no write, no log.
-- ---------------------------------------------------------------------------
create function public.set_user_role(target_user_id uuid, new_role public.app_role)
returns public.app_role
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.app_role;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'set_user_role: admin role required' using errcode = '42501';
  end if;

  select p.role into v_old from profiles p where p.user_id = set_user_role.target_user_id for update;
  if not found then
    raise exception 'set_user_role: user not found' using errcode = 'P0002';
  end if;
  if v_old is not distinct from new_role then
    return new_role;
  end if;

  update profiles p set role = new_role where p.user_id = set_user_role.target_user_id;

  insert into activity_log (user_id, action, target_user_id, detail)
  values (auth.uid(), 'role_change', set_user_role.target_user_id,
          jsonb_build_object('from', v_old, 'to', new_role));
  return new_role;
end;
$$;

revoke all on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Deal edits: one log row per update_deal save (per deal and editor), listing
-- the fields it changed. Statement-level, reads the inserted rows.
-- ---------------------------------------------------------------------------
create function public.log_deal_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into activity_log (user_id, action, deal_id, detail)
  select n.changed_by, 'deal_edit', n.deal_id,
         jsonb_build_object('fields', jsonb_agg(distinct n.field))
  from new_events n
  where n.changed_by is not null
  group by n.changed_by, n.deal_id;
  return null;
end;
$$;

revoke all on function public.log_deal_edits() from public, anon, authenticated;

create trigger deal_events_log_edits
  after insert on public.deal_events
  referencing new table as new_events
  for each statement execute function public.log_deal_edits();

-- ---------------------------------------------------------------------------
-- get_admin_users(): the users table for /admin. Admins only. Runs as the
-- caller (RLS applies) and checks the role explicitly too.
-- ---------------------------------------------------------------------------
create function public.get_admin_users()
returns table (
  user_id        uuid,
  full_name      text,
  email          text,
  role           public.app_role,
  last_login_at  timestamptz,
  edits_7d       integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'get_admin_users: admin role required' using errcode = '42501';
  end if;

  return query
  select p.user_id, p.full_name, p.email, p.role, p.last_login_at,
         (select count(*)::integer from activity_log a
           where a.user_id = p.user_id and a.action = 'deal_edit'
             and a.created_at >= now() - interval '7 days')
  from profiles p
  order by lower(coalesce(nullif(btrim(p.full_name), ''), p.email));
end;
$$;

revoke all on function public.get_admin_users() from public, anon;
grant execute on function public.get_admin_users() to authenticated;

commit;
