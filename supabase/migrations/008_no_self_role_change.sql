-- 008_no_self_role_change.sql
-- Admins can't change their own role: another admin has to do it, so nobody
-- locks themselves out or demotes a shared demo account by mistake.
-- Also closes the direct path: since 007, every role change goes through
-- set_user_role, which checks this and logs the change. A direct
-- `update profiles set role` from the app would skip both, so the column
-- grant is revoked. Scripts (service_role) are unaffected.
-- Plain SQL, runs top to bottom in the Supabase SQL editor.

begin;

revoke update on table public.profiles from authenticated;
drop policy profiles_update_admin on public.profiles;

create or replace function public.set_user_role(target_user_id uuid, new_role public.app_role)
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
  if set_user_role.target_user_id = auth.uid() then
    raise exception 'set_user_role: you cannot change your own role' using errcode = '42501';
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

-- create or replace keeps the 007 grants; restated so this file stands alone.
revoke all on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

commit;
