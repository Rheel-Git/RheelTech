create extension if not exists pgcrypto;
create type public.job_status as enum ('draft','published','closed','archived');
create type public.application_status as enum ('new','under_review','shortlisted','interview','offered','rejected','withdrawn');
create table public.admin_profiles (user_id uuid primary key references auth.users(id) on delete cascade, role text not null default 'recruiter' check (role in ('admin','recruiter')), created_at timestamptz not null default now());
create or replace function public.is_careers_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.admin_profiles where user_id=auth.uid()) $$;
revoke all on function public.is_careers_admin() from public;
grant execute on function public.is_careers_admin() to authenticated;
create table public.jobs (
 id uuid primary key default gen_random_uuid(), title text not null, slug text not null unique, department text not null, employment_type text not null, work_arrangement text not null check(work_arrangement in ('on-site','hybrid','remote')), location text not null, summary text not null, description text not null, responsibilities jsonb not null default '[]', requirements jsonb not null default '[]', salary_range text, status public.job_status not null default 'draft', published_at timestamptz, closing_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id)
);
create table public.applications (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), full_name text not null, email text not null, phone text not null, location text not null, experience_summary text not null, cover_letter text not null, cv_storage_path text not null, status public.application_status not null default 'new', consent_at timestamptz not null, internal_notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.admin_profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
revoke all on public.admin_profiles,public.jobs,public.applications from anon,authenticated;
grant select on public.jobs to anon,authenticated;
grant insert,update,delete on public.jobs to authenticated;
grant select,insert,update,delete on public.applications to authenticated;
grant select on public.admin_profiles to authenticated;
create policy "public reads current jobs" on public.jobs for select to anon,authenticated using(status='published' and (closing_at is null or closing_at>=now()));
create policy "admins read all jobs" on public.jobs for select to authenticated using(public.is_careers_admin());
create policy "admins create jobs" on public.jobs for insert to authenticated with check(public.is_careers_admin());
create policy "admins edit jobs" on public.jobs for update to authenticated using(public.is_careers_admin()) with check(public.is_careers_admin());
create policy "admins delete jobs" on public.jobs for delete to authenticated using(public.is_careers_admin());
create policy "admins read applications" on public.applications for select to authenticated using(public.is_careers_admin());
create policy "admins manage applications" on public.applications for update to authenticated using(public.is_careers_admin()) with check(public.is_careers_admin());
create policy "admins delete applications" on public.applications for delete to authenticated using(public.is_careers_admin());
create policy "admins read own profile" on public.admin_profiles for select to authenticated using(user_id=auth.uid() and public.is_careers_admin());
create or replace view public.admin_dashboard_counts with (security_invoker=true) as select count(*)::int total_jobs,count(*) filter(where status='published')::int published_jobs,count(*) filter(where status='draft')::int draft_jobs from public.jobs;
grant select on public.admin_dashboard_counts to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('private-cvs','private-cvs',false,5242880,array['application/pdf']) on conflict(id) do nothing;
create policy "admins read private CVs" on storage.objects for select to authenticated using(bucket_id='private-cvs' and public.is_careers_admin());
create policy "applicants upload private PDF CVs" on storage.objects for insert to anon,authenticated with check(bucket_id='private-cvs' and name ~* '^[0-9a-f-]{36}\.pdf$');
