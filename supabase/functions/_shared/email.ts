export const DEFAULT_RESEND_FROM_EMAIL =
  'RheelTech Website <notifications@mail.rheeltech.ng>';

export type ResendConfig = { apiKey: string; from: string };

export function getResendConfig(): ResendConfig | null {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const from = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || DEFAULT_RESEND_FROM_EMAIL;
  if (!apiKey) return null;

  const address = from.match(/<([^<>]+)>/)?.[1] ?? from;
  if (!/^[^\s@]+@mail\.rheeltech\.ng$/i.test(address)) return null;
  return { apiKey, from };
}

export function isValidEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

export async function sendResendEmail(input: {
  config: ResendConfig;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.config.from,
        to: [input.to],
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        subject: input.subject,
        text: input.text,
      }),
    });

    if (!response.ok) {
      // Do not log the provider response: it may contain submitted addresses or content.
      console.error(JSON.stringify({ event: 'resend_delivery_failed', status: response.status }));
      return false;
    }
    return true;
  } catch {
    console.error(JSON.stringify({ event: 'resend_delivery_failed', reason: 'network_error' }));
    return false;
  }
}
