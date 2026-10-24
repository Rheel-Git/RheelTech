type GatewayPayload = { ok?: boolean; confirmationEmailSent?: boolean; error?: string };

export class CareersGatewayError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CareersGatewayError';
    this.status = status;
  }
}

const gatewayUrl = (import.meta.env.VITE_CAREERS_GATEWAY_URL as string | undefined)?.replace(/\/+$/, '');

async function post<T extends GatewayPayload>(path: string, body: BodyInit, json = false): Promise<T> {
  if (!gatewayUrl) throw new CareersGatewayError('The careers gateway is not configured.', 0);

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/${path}`, {
      method: 'POST',
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      body,
    });
  } catch {
    throw new CareersGatewayError('The submission service could not be reached.', 0);
  }

  let payload: T | null = null;
  try {
    payload = await response.json() as T;
  } catch {
    // Treat non-JSON responses as a safe generic gateway failure.
  }
  if (!response.ok || payload?.ok !== true) {
    throw new CareersGatewayError(
      typeof payload?.error === 'string' ? payload.error : 'The submission could not be confirmed.',
      response.status,
    );
  }
  return payload;
}

export function submitCareerApplication(body: FormData): Promise<GatewayPayload> {
  // Leave multipart Content-Type unset so fetch adds the correct boundary.
  return post('submit-application', body);
}

export function submitContactEnquiry(body: Record<string, FormDataEntryValue>): Promise<GatewayPayload> {
  return post('contact-enquiry', JSON.stringify(body), true);
}
