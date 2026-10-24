import { getResendConfig, isValidEmail, sendResendEmail } from '../_shared/email.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: cors });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Enter a valid enquiry.' }, 400);
    }
  } catch {
    return json({ error: 'Enter a valid enquiry.' }, 400);
  }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const enquiryType = typeof body.enquiry_type === 'string' ? body.enquiry_type.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const organisation = typeof body.organisation === 'string' ? body.organisation.trim() : '';

  if (!fullName || fullName.length > 200 || !isValidEmail(email) || !enquiryType || enquiryType.length > 120 || !message || message.length > 10000 || organisation.length > 200) {
    return json({ error: 'Check the required fields and try again.' }, 400);
  }

  const to = Deno.env.get('CONTACT_NOTIFICATION_EMAIL')?.trim() ?? '';
  const config = getResendConfig();
  if (!config || !isValidEmail(to)) {
    console.error(JSON.stringify({ event: 'contact_email_not_configured' }));
    return json({ error: 'The enquiry email service is not configured. Please email hello@rheeltech.ng.' }, 503);
  }

  const sent = await sendResendEmail({
    config,
    to,
    replyTo: email,
    subject: `Website enquiry: ${enquiryType.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()}`,
    text: [
      `Name: ${fullName}`,
      `Email: ${email}`,
      `Organisation: ${organisation || '—'}`,
      `Type: ${enquiryType}`,
      '',
      message,
    ].join('\n'),
  });

  if (!sent) return json({ error: 'We could not send your enquiry. Please try again later or email hello@rheeltech.ng.' }, 502);
  return json({ ok: true });
});
