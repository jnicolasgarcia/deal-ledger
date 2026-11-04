-- 005_no_default_role.sql
-- New users start with no role (null) instead of viewer, so a missed Auth
-- setting can't expose data. Null already means no access everywhere:
-- current_app_role() returns null, which every policy and function refuses.
-- The signup trigger (002) doesn't set a role, so new profiles get null.
-- Existing profiles (the demo users) keep their roles.
-- Plain SQL, runs top to bottom in the Supabase SQL editor.

begin;

alter table public.profiles alter column role drop default;
alter table public.profiles alter column role drop not null;

comment on column public.profiles.role is 'null = no access until an admin grants a role';

commit;
