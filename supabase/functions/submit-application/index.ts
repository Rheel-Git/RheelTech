import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getResendConfig, isValidEmail, sendResendEmail } from '../_shared/email.ts';
import { createSubmitApplicationHandler, type ApplicationInsert, type ApplicationRecord } from './core.ts';

function createRepository() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // The service credential remains in the Edge Function runtime. It is never
  // returned to or used by browser code. Storage keeps its existing private policies.
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  return {
    async getApplicationByKey(key: string) {
      const { data, error } = await client.from('applications')
        .select('id,job_id,submission_key,full_name,email,cv_storage_path,created_at,confirmation_email_sent,recruitment_notification_sent')
        .eq('submission_key', key).maybeSingle();
      return { data: data as ApplicationRecord | null, error };
    },
    async getJob(jobId: string, publishedOnly: boolean) {
      let query = client.from('jobs').select('id,title').eq('id', jobId);
      if (publishedOnly) query = query.eq('status', 'published');
      const { data, error } = await query.maybeSingle();
      return { data, error };
    },
    async uploadCv(path: string, bytes: Uint8Array) {
      const { error } = await client.storage.from('private-cvs').upload(path, new Blob([bytes], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (!error) return { status: 'uploaded' as const };
      const description = `${error.message || ''} ${error.statusCode || ''}`;
      if (/already exists|duplicate/i.test(description) || String(error.statusCode) === '409') {
        return { status: 'exists' as const };
      }
      return { status: 'error' as const, error };
    },
    async downloadCv(path: string) {
      const { data, error } = await client.storage.from('private-cvs').download(path);
      return { data: data ? new Uint8Array(await data.arrayBuffer()) : null, error };
    },
    async removeCv(path: string) {
      const { error } = await client.storage.from('private-cvs').remove([path]);
      return { error };
    },
    async saveApplication(values: ApplicationInsert) {
      const { data, error } = await client.from('applications').insert(values)
        .select('id,job_id,submission_key,full_name,email,cv_storage_path,created_at,confirmation_email_sent,recruitment_notification_sent')
        .single();
      return {
        data: data as ApplicationRecord | null,
        duplicate: error?.code === '23505',
        error,
      };
    },
    async setEmailSent(id: string, kind: 'confirmation_email_sent' | 'recruitment_notification_sent') {
      const { error } = await client.from('applications').update({ [kind]: true }).eq('id', id);
      return { error };
    },
  };
}

Deno.serve(createSubmitApplicationHandler({
  env: (name) => Deno.env.get(name),
  createRepository,
  isValidEmail,
  now: () => new Date().toISOString(),
  log: (event) => console.error(JSON.stringify({ event })),
  async sendEmail(input) {
    const config = getResendConfig();
    if (!config) return false;
    return sendResendEmail({ config, ...input });
  },
}));
