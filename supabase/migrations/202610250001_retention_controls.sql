-- Track when an application first reaches an unsuccessful final status and
-- provide a service-role-only claim operation for retryable CV cleanup.
alter table public.staff_management_audit
  add column if not exists retention_hold boolean not null default false,
  add column if not exists retention_hold_reason text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_management_audit_retention_hold_reason_length') then
    alter table public.staff_management_audit add constraint staff_management_audit_retention_hold_reason_length
      check (char_length(retention_hold_reason) <= 500);
  end if;
end $$;

create index if not exists staff_management_audit_retention_idx on public.staff_management_audit (created_at);

alter table public.applications
  add column if not exists final_decision_at timestamptz,
  add column if not exists retention_hold boolean not null default false,
  add column if not exists retention_hold_reason text not null default '',
  add column if not exists retention_deletion_started_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'applications_retention_hold_reason_length'
  ) then
    alter table public.applications add constraint applications_retention_hold_reason_length
      check (char_length(retention_hold_reason) <= 500);
  end if;
end $$;

-- Existing rejected/withdrawn rows use updated_at as a conservative anchor.
update public.applications
set final_decision_at = updated_at
where status in ('rejected', 'withdrawn') and final_decision_at is null;

create or replace function public.careers_track_final_application_decision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.retention_deletion_started_at is not null
     and old.retention_deletion_started_at is not null
     and new.status is distinct from old.status then
    raise exception using errcode = '55000', message = 'Application is being processed for retention deletion';
  end if;

  if new.status in ('rejected', 'withdrawn') then
    if tg_op = 'INSERT' then
      new.final_decision_at := coalesce(new.final_decision_at, now());
    elsif new.status is distinct from old.status then
      new.final_decision_at := now();
    else
      new.final_decision_at := coalesce(new.final_decision_at, old.final_decision_at, old.updated_at, now());
    end if;
  else
    new.final_decision_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists applications_track_final_decision on public.applications;
create trigger applications_track_final_decision
before insert or update of status, final_decision_at on public.applications
for each row execute function public.careers_track_final_application_decision();

create or replace function public.retention_claim_expired_applications(p_limit integer default 100)
returns table (id uuid, cv_storage_path text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'Batch limit must be between 1 and 100';
  end if;

  return query
  with candidates as (
    select a.id
    from public.applications a
    where a.status in ('rejected', 'withdrawn')
      and a.final_decision_at <= now() - interval '12 months'
      and not a.retention_hold
    order by a.final_decision_at, a.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.applications a
    set retention_deletion_started_at = coalesce(a.retention_deletion_started_at, now())
    from candidates c
    where a.id = c.id
    returning a.id, a.cv_storage_path
  )
  select claimed.id, claimed.cv_storage_path from claimed;
end;
$$;

revoke all on function public.careers_track_final_application_decision() from public, anon, authenticated;
revoke all on function public.retention_claim_expired_applications(integer) from public, anon, authenticated;
grant execute on function public.retention_claim_expired_applications(integer) to service_role;

create index if not exists applications_retention_due_idx
  on public.applications (final_decision_at)
  where status in ('rejected', 'withdrawn') and not retention_hold;
