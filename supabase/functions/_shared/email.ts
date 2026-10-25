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

async function safeResendErrorCode(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return 'unclassified';

  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return 'response_too_large';
      }
      chunks.push(value);
    }
  } catch {
    return 'response_unavailable';
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const code = payload.name ?? payload.code ?? payload.type;
    return typeof code === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(code)
      ? code.toLowerCase()
      : 'unclassified';
  } catch {
    return 'unclassified';
  }
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
      // Log only the HTTP status and a constrained machine-readable provider
      // code. Never log the free-text body, which could contain personal data.
      const providerErrorCode = await safeResendErrorCode(response);
      console.error(JSON.stringify({
        event: 'resend_delivery_failed',
        status: response.status,
        provider_error_code: providerErrorCode,
      }));
      return false;
    }
    return true;
  } catch {
    console.error(JSON.stringify({ event: 'resend_delivery_failed', reason: 'network_error' }));
    return false;
  }
}
