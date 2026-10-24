-- Public application submissions need a stable key so a client retry cannot
-- create another application after the first request was persisted.
alter table public.applications
  add column if not exists submission_key uuid,
  add column if not exists confirmation_email_sent boolean not null default false,
  add column if not exists recruitment_notification_sent boolean not null default false;

create unique index if not exists applications_submission_key_unique
  on public.applications (submission_key)
  where submission_key is not null;
