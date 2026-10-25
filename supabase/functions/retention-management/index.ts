import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const allowedOrigins = new Set([
  'https://rheeltech.ng',
  'https://rheel-git.github.io',
  'https://rheeltech-staging-git-vercel-staging-rheel.vercel.app',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

function corsHeaders(origin: string) {
  const headers = new Headers({ 'Vary': 'Origin', 'Content-Type': 'application/json' });
  if (allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

function monthsAgo(months: number): string {
  const date = new Date();
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

function reply(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request.headers.get('origin') || '') });
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return reply(request, { error: 'This site is not allowed to manage retention.' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (request.method !== 'POST') return reply(request, { error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !serviceKey || !token) return reply(request, { error: 'Retention review is temporarily unavailable.' }, 503);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body');
    body = parsed as Record<string, unknown>;
  } catch {
    return reply(request, { error: 'The request is invalid.' }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return reply(request, { error: 'Sign in again to continue.' }, 401);
  const { data: profile, error: profileError } = await admin.from('admin_profiles')
    .select('role,is_active').eq('user_id', authData.user.id).maybeSingle();
  if (profileError) return reply(request, { error: 'Staff access could not be verified.' }, 503);
  if (profile?.role !== 'admin' || profile.is_active !== true) return reply(request, { error: 'Administrator access is required.' }, 403);

  if (body.action === 'list_audit') {
    const { data, error } = await admin.from('staff_management_audit')
      .select('id,actor_user_id,actor_email,target_user_id,target_email,event_type,old_role,new_role,created_at,retention_hold,retention_hold_reason')
      .order('created_at', { ascending: false }).limit(100);
    if (error) return reply(request, { error: 'The staff audit could not be loaded.' }, 500);
    return reply(request, { audit: data || [] });
  }

  if (body.action === 'preview') {
    const [apps, held, audit, heldAudit] = await Promise.all([
      admin.from('applications').select('id', { count: 'exact', head: true })
        .in('status', ['rejected', 'withdrawn']).lte('final_decision_at', monthsAgo(12)).eq('retention_hold', false),
      admin.from('applications').select('id', { count: 'exact', head: true }).eq('retention_hold', true),
      admin.from('staff_management_audit').select('id', { count: 'exact', head: true })
        .lt('created_at', monthsAgo(24)).eq('retention_hold', false),
      admin.from('staff_management_audit').select('id', { count: 'exact', head: true }).eq('retention_hold', true),
    ]);
    if (apps.error || held.error || audit.error || heldAudit.error) return reply(request, { error: 'The retention preview failed. No records were changed.' }, 500);
    return reply(request, { applicationCount: apps.count || 0, heldApplicationCount: held.count || 0, auditCount: audit.count || 0, heldAuditCount: heldAudit.count || 0, mode: 'preview' });
  }

  if (body.action === 'set_audit_hold' || body.action === 'clear_audit_hold') {
    const id = typeof body.auditId === 'string' && /^[0-9a-f-]{36}$/i.test(body.auditId) ? body.auditId : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!id || (body.action === 'set_audit_hold' && (!reason || reason.length > 500))) return reply(request, { error: 'Provide an audit event and a short legal-hold reason.' }, 400);
    const { error } = await admin.from('staff_management_audit').update({
      retention_hold: body.action === 'set_audit_hold',
      retention_hold_reason: body.action === 'set_audit_hold' ? reason : '',
    }).eq('id', id);
    if (error) return reply(request, { error: 'The audit legal hold could not be changed.' }, 500);
    return reply(request, { updated: true });
  }

  if (body.action === 'set_hold' || body.action === 'clear_hold') {
    const id = typeof body.applicationId === 'string' && /^[0-9a-f-]{36}$/i.test(body.applicationId) ? body.applicationId : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!id || (body.action === 'set_hold' && (!reason || reason.length > 500))) return reply(request, { error: 'Provide an application and a short legal-hold reason.' }, 400);
    const { error } = await admin.from('applications').update({
      retention_hold: body.action === 'set_hold',
      retention_hold_reason: body.action === 'set_hold' ? reason : '',
    }).eq('id', id).is('retention_deletion_started_at', null);
    if (error) return reply(request, { error: 'The legal hold could not be changed. No application data was deleted.' }, 500);
    return reply(request, { updated: true });
  }

  if (body.action !== 'execute' || body.confirmation !== 'DELETE EXPIRED RECORDS') {
    return reply(request, { error: 'Choose preview, or enter the required confirmation to process expired records.' }, 400);
  }

  const { data: claimed, error: claimError } = await admin.rpc('retention_claim_expired_applications', { p_limit: 100 });
  if (claimError) return reply(request, { error: 'Expired applications could not be claimed. No records were changed.' }, 500);

  let applicationsDeleted = 0;
  let applicationsFailed = 0;
  for (const item of claimed || []) {
    const { error: storageError } = await admin.storage.from('private-cvs').remove([item.cv_storage_path]);
    if (storageError) {
      applicationsFailed += 1;
      continue;
    }
    const { error: deleteError } = await admin.from('applications').delete().eq('id', item.id)
      .in('status', ['rejected', 'withdrawn']).eq('retention_hold', false)
      .not('retention_deletion_started_at', 'is', null);
    if (deleteError) applicationsFailed += 1;
    else applicationsDeleted += 1;
  }

  const { error: auditError, count: auditDeleted } = await admin.from('staff_management_audit')
    .delete({ count: 'exact' }).lt('created_at', monthsAgo(24)).eq('retention_hold', false);
  if (auditError) return reply(request, { applicationsDeleted, applicationsFailed, error: 'Application cleanup finished, but audit cleanup failed. Run the review again.' }, 500);
  return reply(request, { applicationsDeleted, applicationsFailed, auditDeleted: auditDeleted || 0, mode: 'execute' });
});
