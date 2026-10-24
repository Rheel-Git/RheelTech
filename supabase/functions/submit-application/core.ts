export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_CV_BYTES + 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ApplicationRecord = {
  id: string;
  job_id: string;
  submission_key: string;
  full_name: string;
  email: string;
  cv_storage_path: string;
  created_at: string;
  confirmation_email_sent: boolean;
  recruitment_notification_sent: boolean;
};

export type ApplicationInsert = {
  job_id: string;
  submission_key: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  experience_summary: string;
  cover_letter: string;
  cv_storage_path: string;
  consent_at: string;
};

export type SubmissionDependencies = {
  env(name: string): string | undefined;
  createRepository(): ApplicationRepository;
  sendEmail(input: { to: string; replyTo?: string; subject: string; text: string }): Promise<boolean>;
  isValidEmail(value: string): boolean;
  now(): string;
  log(event: string): void;
};

export type ApplicationRepository = {
  getApplicationByKey(key: string): Promise<{ data: ApplicationRecord | null; error?: unknown }>;
  getJob(jobId: string, publishedOnly: boolean): Promise<{ data: { id: string; title: string } | null; error?: unknown }>;
  uploadCv(path: string, bytes: Uint8Array): Promise<{ status: 'uploaded' | 'exists' | 'error'; error?: unknown }>;
  downloadCv(path: string): Promise<{ data: Uint8Array | null; error?: unknown }>;
  removeCv(path: string): Promise<{ error?: unknown }>;
  saveApplication(values: ApplicationInsert): Promise<{ data: ApplicationRecord | null; duplicate: boolean; error?: unknown }>;
  setEmailSent(id: string, kind: 'confirmation_email_sent' | 'recruitment_notification_sent'): Promise<{ error?: unknown }>;
};

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers });
}

function field(form: FormData, name: string, maxLength: number): string | null {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== 'string') return null;
  const value = values[0].trim();
  return value.length > 0 && value.length <= maxLength ? value : null;
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const headerLength = request.headers.get('content-length');
  if (headerLength !== null) {
    if (!/^\d+$/.test(headerLength) || Number(headerLength) > MAX_REQUEST_BYTES) return null;
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function hasPdfStructure(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const header = new TextDecoder().decode(bytes.subarray(0, 8));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(header)) return false;

  // A header alone is easy to spoof. Require a catalog/object marker and EOF
  // trailer near the end. This is structural screening, not a full PDF parser
  // or malware scan; see the review notes for that limitation.
  const text = new TextDecoder('windows-1252').decode(bytes);
  const tail = text.slice(-1024);
  return /\/Type\s*\/Catalog\b/.test(text)
    && /\b(?:\d+\s+\d+\s+obj|xref)\b/.test(text)
    && /%%EOF\s*$/.test(tail.trimEnd());
}

async function parseSubmission(request: Request): Promise<
  | { ok: true; body: Uint8Array; form: FormData }
  | { ok: false; status: number; error: string }
> {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) {
    return { ok: false, status: 400, error: 'Submit the application form and PDF CV together.' };
  }
  const body = await readBoundedBody(request);
  if (!body) return { ok: false, status: 413, error: 'The application request is too large. CVs must be 5 MB or smaller.' };

  try {
    const boundedRequest = new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    return { ok: true, body, form: await boundedRequest.formData() };
  } catch {
    return { ok: false, status: 400, error: 'Check the application details and PDF CV, then try again.' };
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function markEmail(
  deps: SubmissionDependencies,
  repository: ApplicationRepository,
  application: ApplicationRecord,
  jobTitle: string,
): Promise<boolean> {
  const emailConfigured = Boolean(deps.env('RESEND_API_KEY')?.trim());
  const from = deps.env('RESEND_FROM_EMAIL')?.trim();
  if (!emailConfigured || (from && !/@mail\.rheeltech\.ng\s*>?$/i.test(from))) {
    deps.log('application_email_not_configured');
    return false;
  }

  let confirmationSent = application.confirmation_email_sent;
  if (!confirmationSent) {
    try {
      confirmationSent = await deps.sendEmail({
        to: application.email,
        subject: `We received your application for ${jobTitle}`,
        text: [
          `Hello ${application.full_name},`, '',
          `Thank you for applying for ${jobTitle} at RheelTech. We have received your application.`,
          'Our recruitment team will review it and contact you if there is an update.', '',
          'Rheel Technology Limited',
        ].join('\n'),
      });
    } catch {
      confirmationSent = false;
    }
    if (confirmationSent) {
      try {
        const { error } = await repository.setEmailSent(application.id, 'confirmation_email_sent');
        if (error) deps.log('application_confirmation_status_save_failed');
      } catch {
        deps.log('application_confirmation_status_save_failed');
      }
    }
  }

  const recruitmentInbox = deps.env('RECRUITMENT_NOTIFICATION_EMAIL')?.trim()
    || deps.env('CONTACT_NOTIFICATION_EMAIL')?.trim() || '';
  if (!application.recruitment_notification_sent) {
    if (!deps.isValidEmail(recruitmentInbox)) {
      deps.log('recruitment_email_not_configured');
    } else {
      let recruitmentSent = false;
      try {
        recruitmentSent = await deps.sendEmail({
          to: recruitmentInbox,
          replyTo: application.email,
          subject: `New application: ${jobTitle}`,
          text: [
            `A new application was received for ${jobTitle}.`, '',
            `Candidate: ${application.full_name}`,
            `Email: ${application.email}`,
            `Received: ${application.created_at}`, '',
            'Sign in to the RheelTech careers portal to review the application and access the CV.',
            'No CV or cover letter is attached to this notification.',
          ].join('\n'),
        });
      } catch {
        recruitmentSent = false;
      }
      if (recruitmentSent) {
        try {
          const { error } = await repository.setEmailSent(application.id, 'recruitment_notification_sent');
          if (error) deps.log('recruitment_notification_status_save_failed');
        } catch {
          deps.log('recruitment_notification_status_save_failed');
        }
      }
    }
  }
  return confirmationSent;
}

export function createSubmitApplicationHandler(deps: SubmissionDependencies) {
  return async (request: Request): Promise<Response> => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors);

    const parsed = await parseSubmission(request);
    if (parsed.ok === false) return json({ error: parsed.error }, parsed.status, cors);
    const { form } = parsed;
    const jobId = field(form, 'job_id', 36);
    const submissionKey = field(form, 'submission_key', 36);
    const fullName = field(form, 'full_name', 200);
    const email = field(form, 'email', 320);
    const phone = field(form, 'phone', 80);
    const location = field(form, 'location', 200);
    const experience = field(form, 'experience_summary', 10000);
    const coverLetter = field(form, 'cover_letter', 12000);
    const consent = field(form, 'consent', 5);
    const fileValues = form.getAll('cv');
    const file = fileValues.length === 1 && fileValues[0] instanceof File ? fileValues[0] : null;

    if (!jobId || !UUID.test(jobId) || !submissionKey || !UUID.test(submissionKey)
      || !fullName || !email || !deps.isValidEmail(email) || !phone || !location
      || !experience || !coverLetter || consent !== 'true' || !file
      || file.size === 0 || file.size > MAX_CV_BYTES
      || file.type.toLowerCase() !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      return json({ error: 'Check the required fields, consent and PDF CV (5 MB maximum), then try again.' }, 400, cors);
    }

    const cvBytes = new Uint8Array(await file.arrayBuffer());
    if (cvBytes.byteLength !== file.size || !hasPdfStructure(cvBytes)) {
      return json({ error: 'The CV must be a valid PDF file. Please choose another file.' }, 400, cors);
    }

    if (!deps.env('SUPABASE_URL') || !deps.env('SUPABASE_SERVICE_ROLE_KEY')) {
      deps.log('application_database_not_configured');
      return json({ error: 'The application service is temporarily unavailable.' }, 503, cors);
    }

    const repository = deps.createRepository();
    try {
      const { data: prior, error: priorError } = await repository.getApplicationByKey(submissionKey);
      if (priorError) throw priorError;

      let application = prior;
      let jobTitle: string;
      if (application) {
        if (application.job_id !== jobId || application.email.toLowerCase() !== email.toLowerCase()) {
          return json({ error: 'This submission could not be matched. Please contact RheelTech for help.' }, 409, cors);
        }
        const { data: existingJob, error } = await repository.getJob(jobId, false);
        if (error || !existingJob) throw error || new Error('Vacancy unavailable');
        jobTitle = existingJob.title;
      } else {
        const { data: job, error } = await repository.getJob(jobId, true);
        if (error) throw error;
        if (!job) return json({ error: 'This vacancy is no longer accepting applications.' }, 404, cors);
        jobTitle = job.title;

        const cvPath = `${submissionKey}.pdf`;
        const upload = await repository.uploadCv(cvPath, cvBytes);
        const createdUpload = upload.status === 'uploaded';
        if (upload.status === 'error') throw upload.error || new Error('CV upload failed');
        if (upload.status === 'exists') {
          const { data: existingBytes, error: downloadError } = await repository.downloadCv(cvPath);
          if (downloadError || !existingBytes || !sameBytes(cvBytes, existingBytes)) {
            return json({ error: 'This submission could not be matched. Please start a new application or contact RheelTech for help.' }, 409, cors);
          }
        }

        const save = await repository.saveApplication({
          job_id: jobId,
          submission_key: submissionKey,
          full_name: fullName,
          email,
          phone,
          location,
          experience_summary: experience,
          cover_letter: coverLetter,
          cv_storage_path: cvPath,
          consent_at: deps.now(),
        });

        if (save.duplicate) {
          const { data: raced, error } = await repository.getApplicationByKey(submissionKey);
          if (error || !raced) {
            if (createdUpload) {
              const { data: savedByRetry } = await repository.getApplicationByKey(submissionKey);
              if (!savedByRetry) {
                const { error: cleanupError } = await repository.removeCv(cvPath);
                if (cleanupError) deps.log('application_cv_cleanup_failed');
              }
            }
            throw error || save.error || new Error('Idempotency record unavailable');
          }
          application = raced;
        } else if (save.error || !save.data) {
          // Remove a newly-created file when persistence failed. If the object
          // was reused, retain it: another retry may be saving that same key.
          if (createdUpload) {
            const { data: savedByRetry } = await repository.getApplicationByKey(submissionKey);
            if (!savedByRetry) {
              const { error: cleanupError } = await repository.removeCv(cvPath);
              if (cleanupError) deps.log('application_cv_cleanup_failed');
            }
          }
          throw save.error || new Error('Application persistence failed');
        } else {
          application = save.data;
        }
      }

      if (!application || application.job_id !== jobId || application.email.toLowerCase() !== email.toLowerCase()) {
        return json({ error: 'This submission could not be matched. Please contact RheelTech for help.' }, 409, cors);
      }

      const confirmationEmailSent = await markEmail(deps, repository, application, jobTitle);
      return json({ ok: true, confirmationEmailSent }, 200, cors);
    } catch {
      deps.log('application_processing_failed');
      return json({ error: 'We could not save your application. Please retry using the same form session.' }, 500, cors);
    }
  };
}
