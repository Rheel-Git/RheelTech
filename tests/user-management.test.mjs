import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261018142719_user_management.sql', import.meta.url), 'utf8');
const handler = await readFile(new URL('../supabase/functions/staff-management/index.ts', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/CareersDashboard.tsx', import.meta.url), 'utf8');
const login = await readFile(new URL('../src/Admin.tsx', import.meta.url), 'utf8');

test('privileged staff operations require a verified JWT and active database administrator role', () => {
  assert.match(handler, /admin\.auth\.getUser\(token\)/);
  assert.match(handler, /from\('admin_profiles'\)[\s\S]*?select\('role,is_active'\)/);
  assert.match(handler, /actor\?\.role !== 'admin' \|\| actor\.is_active !== true/);
  assert.doesNotMatch(handler, /user_metadata[\s\S]{0,80}role/);
});

test('staff mutation RPC is service-role-only and browser writes to profiles are revoked', () => {
  assert.match(migration, /revoke insert, update, delete on public\.admin_profiles from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.careers_apply_staff_change\([\s\S]*?\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.careers_apply_staff_change\([\s\S]*?\) to service_role/i);
});

test('only administrators receive the user-management UI and server checks the role for every operation', () => {
  assert.match(dashboard, /role==='admin'&&<button[^>]*>[^<]*<UserRoundPlus/);
  assert.match(handler, /if \(actorError \|\| actor\?\.role !== 'admin' \|\| actor\.is_active !== true\)/);
});

test('invitations use Supabase Auth setup links and never return the link to the browser', () => {
  assert.match(handler, /admin\.auth\.admin\.generateLink/);
  assert.match(handler, /type: linkType/);
  assert.match(handler, /actionLink, ''/);
  assert.match(handler, /inviteEmailSent: emailSent/);
  assert.doesNotMatch(handler, /json\(request,\s*\{[^}]*actionLink/);
  assert.match(login, /window\.location\.hash\.includes\('type=invite'\)/);
  assert.match(login, /supabase\.auth\.updateUser\(\{password:newPassword\}\)/);
});

test('the database serializes staff changes and blocks demotion, deactivation, or removal of the last active admin', () => {
  assert.match(migration, /lock table public\.admin_profiles in exclusive mode/i);
  assert.match(migration, /active_admin_count <= 1/);
  assert.match(migration, /Cannot remove the last active administrator/);
  assert.match(migration, /p_action in \('deactivate', 'removal_started'\)/);
  assert.match(migration, /target_profile\.role = 'admin' and target_profile\.is_active/);
  assert.match(migration, /p_role = 'recruiter'/);
});

test('deactivation gates database authorization and Auth access; reactivation rolls back safely on RPC failure', () => {
  assert.match(migration, /p\.user_id = auth\.uid\(\) and p\.role = 'admin' and p\.is_active/);
  assert.match(migration, /p\.user_id = auth\.uid\(\) and p\.role = 'recruiter' and p\.is_active/);
  assert.match(handler, /ban_duration: 'none'/);
  assert.match(handler, /ban_duration: '876000h'/);
  assert.match(handler, /staff_reactivation_profile_save_failed/);
  assert.match(handler, /ban_duration: '876000h'/);
});

test('audit records access changes without storing applicant data or depending on the removed Auth user', () => {
  assert.match(migration, /create table if not exists public\.staff_management_audit/);
  assert.match(migration, /actor_email text not null/);
  assert.match(migration, /'invite_created'[\s\S]*?'removal_failed'/);
  assert.match(handler, /p_action: 'removal_started'/);
  assert.match(handler, /targetEmail, 'removal_completed', profile\.role/);
  assert.match(migration, /foreign key \(created_by\) references auth\.users\(id\) on delete set null/i);
  assert.doesNotMatch(migration.match(/create table if not exists public\.staff_management_audit \(([\s\S]*?)\n\);/)?.[1] || '', /references auth\.users/i);
});

test('existing careers vacancy, application, and private-CV screens remain in place', () => {
  assert.match(dashboard, /supabase\.from\('jobs'\)/);
  assert.match(dashboard, /supabase\.from\('applications'\)/);
  assert.match(dashboard, /storage\.from\('private-cvs'\)/);
  assert.match(handler, /listUsers\(admin\)/);
});
