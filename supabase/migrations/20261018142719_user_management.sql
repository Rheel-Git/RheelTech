-- Extend the existing admin_profiles authorization model. Roles remain stored
-- in this database table; client-editable Auth metadata is never trusted.
alter table public.admin_profiles
  add column if not exists display_name text not null default '',
  add column if not exists is_active boolean not null default true,
  add column if not exists deactivated_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_profiles_display_name_length') then
    alter table public.admin_profiles
      add constraint admin_profiles_display_name_length check (char_length(display_name) <= 120);
  end if;
end $$;

create table if not exists public.staff_management_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text not null,
  target_user_id uuid not null,
  target_email text not null,
  event_type text not null check (event_type in (
    'invite_created', 'invitation_sent', 'setup_link_sent', 'profile_updated',
    'role_changed', 'deactivated', 'reactivated', 'removal_started',
    'removal_completed', 'removal_failed'
  )),
  old_role text check (old_role is null or old_role in ('admin', 'recruiter')),
  new_role text check (new_role is null or new_role in ('admin', 'recruiter')),
  created_at timestamptz not null default now()
);

alter table public.staff_management_audit enable row level security;
revoke all on public.staff_management_audit from public, anon, authenticated;
grant select on public.staff_management_audit to authenticated;
drop policy if exists "active administrators read staff audit" on public.staff_management_audit;
create policy "active administrators read staff audit"
  on public.staff_management_audit for select to authenticated
  using (public.is_careers_admin());

-- Profiles can still be read under the existing self/admin policies, but no
-- browser session can write role assignments or staff status directly.
drop policy if exists "admins manage careers profiles" on public.admin_profiles;
drop policy if exists "admins manage profiles" on public.admin_profiles;
revoke insert, update, delete on public.admin_profiles from public, anon, authenticated;
grant select on public.admin_profiles to authenticated;

create or replace function public.is_careers_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_profiles p
    where p.user_id = auth.uid() and p.role = 'admin' and p.is_active
  );
$$;

create or replace function public.is_careers_recruiter()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_profiles p
    where p.user_id = auth.uid() and p.role = 'recruiter' and p.is_active
  );
$$;

create or replace function public.is_careers_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_careers_admin() or public.is_careers_recruiter(); $$;

revoke all on function public.is_careers_admin() from public, anon;
revoke all on function public.is_careers_recruiter() from public, anon;
revoke all on function public.is_careers_staff() from public, anon;
grant execute on function public.is_careers_admin() to authenticated;
grant execute on function public.is_careers_recruiter() to authenticated;
grant execute on function public.is_careers_staff() to authenticated;

-- Preserve historical vacancies when an Auth account is removed.
alter table public.jobs drop constraint if exists jobs_created_by_fkey;
alter table public.jobs add constraint jobs_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- This transaction-bound RPC is executable only by service_role from the
-- protected Edge Function. It serializes profile mutations so concurrent
-- operations cannot demote/deactivate the final active administrator.
create or replace function public.careers_apply_staff_change(
  p_actor_user_id uuid,
  p_actor_email text,
  p_action text,
  p_target_user_id uuid,
  p_target_email text,
  p_display_name text default null,
  p_role text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_profile public.admin_profiles%rowtype;
  active_admin_count integer;
  clean_email text := lower(btrim(coalesce(p_target_email, '')));
  clean_actor_email text := lower(btrim(coalesce(p_actor_email, '')));
  clean_name text := btrim(coalesce(p_display_name, ''));
begin
  if p_action is null or p_action not in ('invite', 'update', 'deactivate', 'reactivate', 'removal_started', 'removal_completed', 'removal_failed', 'invitation_sent', 'setup_link_sent') then
    raise exception using errcode = '22023', message = 'Invalid staff action';
  end if;
  if p_actor_user_id is null or clean_actor_email = '' or char_length(clean_actor_email) > 320 or p_target_user_id is null or clean_email = '' or char_length(clean_email) > 320 then
    raise exception using errcode = '22023', message = 'Invalid staff target';
  end if;

  lock table public.admin_profiles in exclusive mode;

  if p_action = 'invite' then
    if p_role is null or p_role not in ('admin', 'recruiter') or char_length(clean_name) > 120 then
      raise exception using errcode = '22023', message = 'Invalid staff profile';
    end if;
    insert into public.admin_profiles (user_id, role, display_name, is_active)
    values (p_target_user_id, p_role, clean_name, true);
    insert into public.staff_management_audit (actor_user_id, actor_email, target_user_id, target_email, event_type, new_role)
    values (p_actor_user_id, clean_actor_email, p_target_user_id, clean_email, 'invite_created', p_role);
    return;
  end if;

  if p_action in ('removal_completed', 'removal_failed', 'invitation_sent', 'setup_link_sent') then
    insert into public.staff_management_audit (actor_user_id, actor_email, target_user_id, target_email, event_type)
    values (p_actor_user_id, clean_actor_email, p_target_user_id, clean_email, p_action);
    return;
  end if;

  select * into target_profile from public.admin_profiles
  where user_id = p_target_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Staff profile not found'; end if;

  if p_action in ('deactivate', 'removal_started') and target_profile.user_id = p_actor_user_id then
    raise exception using errcode = '22023', message = 'Self-deactivation is not allowed';
  end if;

  if (p_action in ('deactivate', 'removal_started') and target_profile.role = 'admin' and target_profile.is_active)
    or (p_action = 'update' and target_profile.role = 'admin' and target_profile.is_active and p_role = 'recruiter') then
    select count(*) into active_admin_count from public.admin_profiles
    where role = 'admin' and is_active;
    if active_admin_count <= 1 then
      raise exception using errcode = '23514', message = 'Cannot remove the last active administrator';
    end if;
  end if;

  if p_action = 'update' then
    if p_role is null or p_role not in ('admin', 'recruiter') or char_length(clean_name) > 120 then
      raise exception using errcode = '22023', message = 'Invalid staff profile';
    end if;
    update public.admin_profiles set role = p_role, display_name = clean_name
    where user_id = p_target_user_id;
    if target_profile.role <> p_role then
      insert into public.staff_management_audit (actor_user_id, actor_email, target_user_id, target_email, event_type, old_role, new_role)
      values (p_actor_user_id, clean_actor_email, p_target_user_id, clean_email, 'role_changed', target_profile.role, p_role);
    end if;
    if target_profile.display_name is distinct from clean_name then
      insert into public.staff_management_audit (actor_user_id, actor_email, target_user_id, target_email, event_type)
      values (p_actor_user_id, clean_actor_email, p_target_user_id, clean_email, 'profile_updated');
    end if;
  elsif p_action = 'deactivate' or p_action = 'removal_started' then
    update public.admin_profiles set is_active = false, deactivated_at = coalesce(deactivated_at, now())
    where user_id = p_target_user_id;
    insert into public.staff_management_audit (actor_user_id, actor_email, target_user_id, target_email, event_type, old_role)
    values (p_actor_user_id, clean_actor_email, p_target_user_id, clean_email, p_action, target_profile.role);
  elsif p_action = 'reactivate' then
    update public.admin_profiles set is_active = true, deactivated_at = null
    where user_id = p_target_user_id;
    insert into public.staff_management_audit (actor_user_id, actor_email, target_user_id, target_email, event_type, new_role)
    values (p_actor_user_id, clean_actor_email, p_target_user_id, clean_email, 'reactivated', target_profile.role);
  end if;
end;
$$;

revoke all on function public.careers_apply_staff_change(uuid, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.careers_apply_staff_change(uuid, text, text, uuid, text, text, text) to service_role;
