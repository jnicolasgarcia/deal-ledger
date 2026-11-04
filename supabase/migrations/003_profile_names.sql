-- 003_profile_names.sql
-- Display names for "last updated by" in the deals grid.
-- Editors can only read their own profile row (002), so they can't look up
-- a colleague's name directly. This returns just a display name per user,
-- for editors and admins. No role, no other profile fields. Plain SQL, runs
-- top to bottom in the Supabase SQL editor.

begin;

create function public.get_profile_names(user_ids uuid[])
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.current_app_role() is null or public.current_app_role() not in ('editor', 'admin') then
    raise exception 'get_profile_names: editor or admin role required' using errcode = '42501';
  end if;
  if coalesce(array_length(user_ids, 1), 0) > 1000 then
    raise exception 'get_profile_names: at most 1000 ids per call' using errcode = '22023';
  end if;

  return query
  select p.user_id, coalesce(nullif(btrim(p.full_name), ''), p.email)
  from profiles p
  where p.user_id = any (user_ids);
end;
$$;

revoke all on function public.get_profile_names(uuid[]) from public, anon;
grant execute on function public.get_profile_names(uuid[]) to authenticated;

commit;
