import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getResendConfig, isValidEmail, sendResendEmail } from '../_shared/email.ts';
import { getStaffOrigins, logStaffDiagnostic, staffCorsHeaders } from './safety.mjs';

const projectRef = Deno.env.get('SUPABASE_URL')?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1] || '';
const allowedOrigins = getStaffOrigins(Deno.env.get('STAFF_ALLOWED_ORIGINS') || '', projectRef);
const maxBodyBytes = 16 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type StaffRole = 'admin' | 'recruiter';
type Action = 'list' | 'invite' | 'update' | 'deactivate' | 'reactivate' | 'remove' | 'send_setup';
type Profile = { user_id: string; role: StaffRole; display_name: string; is_active: boolean; deactivated_at: string | null; created_at: string };
type AuthUser = { id: string; email?: string; created_at: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null; banned_until?: string | null };
type AdminClient = SupabaseClient<any, 'public'>;

function headers(request: Request): Headers {
  const origin = request.headers.get('origin') || '';
  return staffCorsHeaders(origin, allowedOrigins);
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

function validRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'recruiter';
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : null;
}

async function requestBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(length) && length > maxBodyBytes) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function listUsers(admin: AdminClient): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw error;
    const batch = (data.users || []) as AuthUser[];
    users.push(...batch);
    if (batch.length < 500) return users;
  }
  throw new Error('User list exceeds the supported staff directory size');
}

async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<AuthUser | null> {
  return (await listUsers(admin)).find((user) => user.email?.toLowerCase() === email) || null;
}

async function audit(admin: AdminClient, actorId: string, actorEmail: string, targetId: string, email: string, action: string, role?: StaffRole) {
  const { error } = await admin.rpc('careers_apply_staff_change', {
    p_actor_user_id: actorId,
    p_actor_email: actorEmail,
    p_action: action,
    p_target_user_id: targetId,
    p_target_email: email,
    p_role: role ?? null,
  });
  if (error) throw error;
}

function staffPortalRedirect(origin: string): string {
  const path = origin === 'https://rheel-git.github.io' ? '/RheelTech/admin' : '/admin';
  return `${origin}${path}`;
}

async function createSetupLink(admin: AdminClient, email: string, redirectTo: string, linkType: 'invite' | 'recovery') {
  const { data, error } = await admin.auth.admin.generateLink({
    type: linkType,
    email,
    options: { redirectTo },
  });
  if (error) throw error;
  const actionLink = data.properties?.action_link;
  if (!actionLink) throw new Error('Auth did not provide a setup link');
  return { user: data.user as AuthUser, actionLink };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return json(request, { error: 'This site is not allowed to manage staff.' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(request) });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed = await requestBody(request);
    if (!parsed) return json(request, { error: 'The request is too large or invalid.' }, 400);
    body = parsed;
  } catch {
    return json(request, { error: 'The request is too large or invalid.' }, 400);
  }

  const action = body.action as Action;
  if (!['list', 'invite', 'update', 'deactivate', 'reactivate', 'remove', 'send_setup'].includes(action)) {
    return json(request, { error: 'Choose a valid staff action.' }, 400);
  }

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || !url || !serviceKey) {
    return json(request, { error: 'Staff management is temporarily unavailable.' }, 503);
  }

  const admin = createClient<any, 'public'>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json(request, { error: 'Sign in again to manage staff.' }, 401);
    const actorId = authData.user.id;
    const actorEmail = authData.user.email?.toLowerCase();
    if (!actorEmail || !isValidEmail(actorEmail)) return json(request, { error: 'Sign in again to manage staff.' }, 401);
    const { data: actor, error: actorError } = await admin.from('admin_profiles')
      .select('user_id,role,is_active').eq('user_id', actorId).maybeSingle();
    if (actorError || !actor || actor.role !== 'admin' || actor.is_active !== true) {
      logStaffDiagnostic('staff_management_authorization_denied', actorError?.code);
      return json(request, {
        error: 'Administrator verification failed. Check staff-management logs.'
      }, 403);
    }

    if (action === 'list') {
      const [{ data: profiles, error: profileError }, { data: events, error: auditError }, authUsers] = await Promise.all([
        admin.from('admin_profiles').select('user_id,role,display_name,is_active,deactivated_at,created_at').order('created_at', { ascending: false }),
        admin.from('staff_management_audit').select('id,actor_user_id,actor_email,target_user_id,target_email,event_type,old_role,new_role,created_at').order('created_at', { ascending: false }).limit(100),
        listUsers(admin),
      ]);
      if (profileError || auditError) throw profileError || auditError;
      const authById = new Map(authUsers.map((user) => [user.id, user]));
      const staff = ((profiles || []) as Profile[]).flatMap((profile) => {
        const user = authById.get(profile.user_id);
        if (!user?.email) return [];
        const banned = Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now());
        const status = !profile.is_active || banned ? 'deactivated' : (!user.email_confirmed_at && !user.confirmed_at ? 'invited' : 'active');
        return [{ id: profile.user_id, email: user.email, displayName: profile.display_name, role: profile.role, status, createdAt: profile.created_at, lastSignInAt: user.last_sign_in_at || null }];
      });
      return json(request, { users: staff, audit: events || [] });
    }

    const targetId = cleanString(body.user_id, 36);
    const email = cleanString(body.email, 320)?.toLowerCase() || null;
    if (targetId && !uuidPattern.test(targetId)) return json(request, { error: 'The selected user is invalid.' }, 400);

    if (action === 'invite') {
      const displayName = cleanString(body.display_name, 120);
      const role = body.role;
      if (!email || !isValidEmail(email) || !displayName || !validRole(role)) {
        return json(request, { error: 'Enter a valid name, email address, and role.' }, 400);
      }
      const mailConfig = getResendConfig();
      if (!mailConfig) return json(request, { error: 'Invitation email is not configured on staging.' }, 503);
      const existing = await findAuthUserByEmail(admin, email);
      if (existing) {
        const { data: existingProfile, error } = await admin.from('admin_profiles').select('user_id').eq('user_id', existing.id).maybeSingle();
        if (error) throw error;
        if (existingProfile) return json(request, { error: 'This user already has staff access.' }, 409);
      }
      const { user, actionLink } = await createSetupLink(admin, email, staffPortalRedirect(origin), existing ? 'recovery' : 'invite');
      const targetUserId = user.id;
      const { error: profileInsertError } = await admin.rpc('careers_apply_staff_change', {
        p_actor_user_id: actorId,
        p_actor_email: actorEmail,
        p_action: 'invite',
        p_target_user_id: targetUserId,
        p_target_email: email,
        p_display_name: displayName,
        p_role: role,
      });
      if (profileInsertError) {
        if (!existing) {
          const { data: racedProfile } = await admin.from('admin_profiles').select('user_id').eq('user_id', targetUserId).maybeSingle();
          if (!racedProfile) await admin.auth.admin.deleteUser(targetUserId);
        }
        logStaffDiagnostic('staff_invite_profile_save_failed', profileInsertError.code);
        return json(request, { error: 'The staff invitation could not be prepared.' }, 500);
      }
      const emailSent = await sendResendEmail({
        config: mailConfig,
        to: email,
        subject: 'You have been invited to the RheelTech Careers Staff Portal',
        text: [
          `Hello ${displayName},`, '',
          'An administrator has invited you to the RheelTech Careers Staff Portal.',
          `Assigned role: ${role === 'admin' ? 'Administrator' : 'Recruitment Manager'}.`,
          'Use this secure, one-time link to set or reset your password and open the portal:',
          actionLink, '',
          'If you were not expecting this invitation, contact RheelTech directly.',
        ].join('\n'),
      });
      if (emailSent) {
        try { await audit(admin, actorId, actorEmail, targetUserId, email, 'invitation_sent', role); }
        catch (error) { logStaffDiagnostic('staff_invitation_delivery_audit_failed', (error as { code?: string })?.code); }
      }
      return json(request, { ok: true, inviteEmailSent: emailSent, message: emailSent ? 'Invitation created and email accepted by the mail provider.' : 'Staff access was prepared, but the invitation email could not be sent. Use Send setup link to retry.' }, 201);
    }

    if (!targetId) return json(request, { error: 'Choose a staff account.' }, 400);
    const { data: profile, error: profileError } = await admin.from('admin_profiles')
      .select('user_id,role,display_name,is_active,deactivated_at').eq('user_id', targetId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return json(request, { error: 'The staff account no longer exists.' }, 404);
    const { data: targetAuth, error: targetAuthError } = await admin.auth.admin.getUserById(targetId);
    if (targetAuthError || !targetAuth.user?.email) return json(request, { error: 'The staff account could not be verified.' }, 404);
    const targetEmail = targetAuth.user.email.toLowerCase();

    if (action === 'update') {
      const displayName = cleanString(body.display_name, 120);
      const role = body.role;
      if (!displayName || !validRole(role)) return json(request, { error: 'Enter a valid display name and role.' }, 400);
      const { error } = await admin.rpc('careers_apply_staff_change', { p_actor_user_id: actorId, p_actor_email: actorEmail, p_action: 'update', p_target_user_id: targetId, p_target_email: targetEmail, p_display_name: displayName, p_role: role });
      if (error) {
        if (error.code === '23514') return json(request, { error: 'The last active administrator cannot be demoted.' }, 409);
        throw error;
      }
      return json(request, { ok: true });
    }

    if (action === 'deactivate' || action === 'reactivate') {
      let authStateError: unknown = null;
      if (action === 'reactivate') {
        const result = await admin.auth.admin.updateUserById(targetId, { ban_duration: 'none' });
        authStateError = result.error;
        if (authStateError) return json(request, { error: 'The account remains deactivated because Supabase could not restore sign-in.' }, 502);
      }
      const { error } = await admin.rpc('careers_apply_staff_change', { p_actor_user_id: actorId, p_actor_email: actorEmail, p_action: action, p_target_user_id: targetId, p_target_email: targetEmail });
      if (error) {
        if (action === 'reactivate') {
          await admin.auth.admin.updateUserById(targetId, { ban_duration: '876000h' });
          logStaffDiagnostic('staff_reactivation_profile_save_failed', error.code);
        }
        if (error.code === '23514') return json(request, { error: 'The last active administrator cannot be deactivated.' }, 409);
        if (error.code === '22023') return json(request, { error: 'You cannot deactivate your own account.' }, 409);
        throw error;
      }
      if (action === 'deactivate') {
        const result = await admin.auth.admin.updateUserById(targetId, { ban_duration: '876000h' });
        authStateError = result.error;
      }
      return json(request, {
        ok: true,
        authBanApplied: !authStateError,
        message: authStateError && action === 'deactivate'
          ? 'Careers access is blocked. Supabase sign-in could not be disabled, so contact support before relying on this account being fully disabled.'
          : authStateError
            ? 'The account remains disabled because its access status could not be fully restored.'
            : action === 'deactivate' ? 'Staff access deactivated.' : 'Staff access reactivated.',
      }, authStateError && action === 'reactivate' ? 502 : 200);
    }

    if (action === 'send_setup') {
      if (!profile.is_active) return json(request, { error: 'Reactivate this account before sending a setup link.' }, 409);
      const mailConfig = getResendConfig();
      if (!mailConfig) return json(request, { error: 'Invitation email is not configured on staging.' }, 503);
      const { actionLink } = await createSetupLink(admin, targetEmail, staffPortalRedirect(origin), 'recovery');
      const emailSent = await sendResendEmail({
        config: mailConfig,
        to: targetEmail,
        subject: 'Set up your RheelTech Careers Staff Portal password',
        text: [`Hello ${profile.display_name || targetEmail},`, '', 'Use this secure, one-time link to set or reset your RheelTech staff password:', actionLink, '', 'If you did not request this, contact a RheelTech administrator.'].join('\n'),
      });
      if (emailSent) {
        try { await audit(admin, actorId, actorEmail, targetId, targetEmail, 'setup_link_sent'); }
        catch (error) { logStaffDiagnostic('staff_setup_delivery_audit_failed', (error as { code?: string })?.code); }
      }
      return json(request, { ok: true, inviteEmailSent: emailSent, message: emailSent ? 'Setup link email accepted by the mail provider.' : 'The setup link email could not be sent. Try again later.' }, emailSent ? 200 : 502);
    }

    if (action === 'remove') {
      if (targetId === actorId) return json(request, { error: 'You cannot remove your own staff account.' }, 409);
      const confirmation = cleanString(body.confirm_email, 320)?.toLowerCase();
      if (confirmation !== targetEmail) return json(request, { error: 'Enter the staff email exactly to confirm removal.' }, 400);
      const { error: beginError } = await admin.rpc('careers_apply_staff_change', { p_actor_user_id: actorId, p_actor_email: actorEmail, p_action: 'removal_started', p_target_user_id: targetId, p_target_email: targetEmail });
      if (beginError) {
        if (beginError.code === '23514') return json(request, { error: 'The last active administrator cannot be removed.' }, 409);
        if (beginError.code === '22023') return json(request, { error: 'You cannot remove your own staff account.' }, 409);
        throw beginError;
      }
      await admin.auth.admin.updateUserById(targetId, { ban_duration: '876000h' });
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
      if (deleteError) {
        await audit(admin, actorId, actorEmail, targetId, targetEmail, 'removal_failed', profile.role);
        logStaffDiagnostic('staff_removal_failed', deleteError.code);
        return json(request, { error: 'Access is deactivated, but the Auth account could not be removed. It is safe to retry removal.' }, 502);
      }
      await audit(admin, actorId, actorEmail, targetId, targetEmail, 'removal_completed', profile.role);
      return json(request, { ok: true, message: 'Staff account removed. Historical vacancies and recruitment records were retained.' });
    }

    return json(request, { error: 'Choose a valid staff action.' }, 400);
  } catch (error) {
    logStaffDiagnostic('staff_management_request_failed', (error as { code?: string })?.code);
    return json(request, { error: 'Staff management could not complete this request. Refresh the list and try again.' }, 500);
  }
});
