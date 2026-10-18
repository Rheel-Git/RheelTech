import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSubmitApplicationHandler, MAX_CV_BYTES, MAX_REQUEST_BYTES } from '../supabase/functions/submit-application/core.ts';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_KEY = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'candidate@example.com';
const pdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');

function createFakeRepository({ saveFailure = false, uploadFailure = false } = {}) {
  const state = {
    apps: new Map(), files: new Map(), uploads: [], removals: [], saves: [], emails: [],
    uploadFailure, saveFailure,
  };
  const repository = {
    async getApplicationByKey(key) { return { data: state.apps.get(key) || null }; },
    async getJob(id) { return id === JOB_ID ? { data: { id, title: 'Support Officer' } } : { data: null }; },
    async uploadCv(path, bytes) {
      state.uploads.push(path);
      if (state.uploadFailure) return { status: 'error', error: new Error('storage failed') };
      if (state.files.has(path)) return { status: 'exists' };
      state.files.set(path, new Uint8Array(bytes));
      return { status: 'uploaded' };
    },
    async downloadCv(path) { return { data: state.files.get(path) || null }; },
    async removeCv(path) { state.removals.push(path); state.files.delete(path); return {}; },
    async saveApplication(values) {
      state.saves.push(values);
      if (state.saveFailure) return { data: null, duplicate: false, error: new Error('database failed') };
      if (state.apps.has(values.submission_key)) return { data: null, duplicate: true, error: { code: '23505' } };
      const row = {
        id: `app-${state.apps.size + 1}`,
        ...values,
        created_at: '2026-10-18T12:00:00.000Z',
        confirmation_email_sent: false,
        recruitment_notification_sent: false,
      };
      state.apps.set(values.submission_key, row);
      return { data: row, duplicate: false };
    },
    async setEmailSent(id, kind) {
      const row = [...state.apps.values()].find((app) => app.id === id);
      if (row) row[kind] = true;
      return {};
    },
  };
  return { repository, state };
}

function makeHandler(options = {}) {
  const fake = createFakeRepository(options);
  const logEvents = [];
  const emailResults = options.emailResults || [true, true];
  const deps = {
    env(name) {
      return {
        SUPABASE_URL: 'https://staging.example.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'test-only-placeholder',
        RESEND_API_KEY: 'test-only-placeholder',
        CONTACT_NOTIFICATION_EMAIL: 'recruitment@example.com',
      }[name];
    },
    createRepository: () => fake.repository,
    isValidEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    now: () => '2026-10-18T12:00:00.000Z',
    log: (event) => logEvents.push(event),
    async sendEmail(input) {
      fake.state.emails.push(input);
      return emailResults.shift() ?? false;
    },
  };
  return { handler: createSubmitApplicationHandler(deps), ...fake, logEvents };
}

function request({ fileBytes = pdfBytes, mime = 'application/pdf', filename = 'candidate.pdf', fields = {}, authorization } = {}) {
  const form = new FormData();
  const defaults = {
    job_id: JOB_ID,
    submission_key: SUBMISSION_KEY,
    full_name: 'Candidate One',
    email: EMAIL,
    phone: '+2348000000000',
    location: 'Abuja',
    experience_summary: 'Customer support experience',
    cover_letter: 'I would like to apply.',
    consent: 'true',
  };
  for (const [key, value] of Object.entries({ ...defaults, ...fields })) form.append(key, value);
  form.append('cv', new File([fileBytes], filename, { type: mime }));
  const headers = authorization ? { authorization } : undefined;
  return new Request('https://edge.example.invalid/submit-application', { method: 'POST', body: form, headers });
}

test('rejects fake PDFs, unsupported MIME types, and invalid required fields before upload', async () => {
  for (const req of [
    request({ fileBytes: new TextEncoder().encode('<html>not a pdf</html>') }),
    request({ fileBytes: new TextEncoder().encode('%PDF-1.4\n%%EOF'), mime: 'text/plain' }),
    request({ fields: { consent: 'false' } }),
  ]) {
    const { handler, state } = makeHandler();
    const response = await handler(req);
    assert.equal(response.status, 400);
    assert.equal(state.uploads.length, 0);
    assert.equal(state.saves.length, 0);
  }
});

test('rejects CVs over 5 MB and caps streamed request bodies even without Content-Length', async () => {
  const largeFile = new Uint8Array(MAX_CV_BYTES + 1);
  largeFile.set(pdfBytes);
  const first = makeHandler();
  assert.equal((await first.handler(request({ fileBytes: largeFile }))).status, 400);
  assert.equal(first.state.uploads.length, 0);

  const second = makeHandler();
  const overLimit = new Uint8Array(MAX_REQUEST_BYTES + 1);
  const streamed = new Request('https://edge.example.invalid/submit-application', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=large' },
    body: new ReadableStream({
      start(controller) { controller.enqueue(overLimit); controller.close(); },
    }),
    duplex: 'half',
  });
  const response = await second.handler(streamed);
  assert.equal(response.status, 413);
  assert.equal(second.state.uploads.length, 0);
});

test('accepts a public submission without a user JWT and ignores caller-supplied CV paths', async () => {
  const { handler, state } = makeHandler();
  const req = request({ fields: { cv_storage_path: 'other-candidate.pdf' } });
  const response = await handler(req);
  assert.equal(response.status, 200);
  const row = [...state.apps.values()][0];
  assert.equal(row.cv_storage_path, `${SUBMISSION_KEY}.pdf`);
  assert.notEqual(row.cv_storage_path, 'other-candidate.pdf');
  assert.equal(state.uploads.length, 1);
});

test('saves the application and uploads the PDF before sending non-sensitive notifications', async () => {
  const { handler, state } = makeHandler();
  const response = await handler(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.confirmationEmailSent, true);
  assert.equal(state.saves.length, 1);
  assert.equal(state.files.size, 1);
  assert.equal(state.emails.length, 2);
  assert.match(state.emails[0].subject, /received your application/);
  assert.match(state.emails[1].text, /No CV or cover letter is attached/);
  assert.equal(state.emails[1].replyTo, EMAIL);
});

test('does not create an application when private CV upload fails', async () => {
  const { handler, state } = makeHandler({ uploadFailure: true });
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.equal(state.saves.length, 0);
  assert.equal(state.files.size, 0);
});

test('cleans a newly uploaded CV after database persistence failure', async () => {
  const { handler, state } = makeHandler({ saveFailure: true });
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.equal(state.saves.length, 1);
  assert.equal(state.removals.length, 1);
  assert.equal(state.files.size, 0);
});

test('a same-key retry after a transient database failure re-uploads cleanly without leaving an orphan', async () => {
  const { handler, state } = makeHandler({ saveFailure: true });
  const failed = await handler(request());
  assert.equal(failed.status, 500);
  assert.equal(state.files.size, 0);
  state.saveFailure = false;
  const retried = await handler(request());
  assert.equal(retried.status, 200);
  assert.equal(state.apps.size, 1);
  assert.equal(state.files.size, 1);
  assert.equal(state.uploads.length, 2);
  assert.equal(state.removals.length, 1);
});

test('recovers an upload left by a timed-out request using the same deterministic CV path', async () => {
  const { handler, state } = makeHandler();
  state.files.set(`${SUBMISSION_KEY}.pdf`, new Uint8Array(pdfBytes));
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(state.apps.size, 1);
  assert.equal(state.files.size, 1);
  assert.equal(state.saves.length, 1);
});

test('a retry with the same key reuses its CV and saved application without duplicates', async () => {
  const { handler, state } = makeHandler();
  const first = await handler(request());
  const retry = await handler(request());
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(state.saves.length, 1);
  assert.equal(state.uploads.length, 1);
  assert.equal(state.apps.size, 1);
  assert.equal(state.emails.length, 2);
});

test('email delivery failure does not misreport a saved application as failed', async () => {
  const { handler, state } = makeHandler({ emailResults: [false, false] });
  const response = await handler(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.confirmationEmailSent, false);
  assert.equal(state.apps.size, 1);
});

test('private CV access stays out of the browser and admin download policy remains unchanged', async () => {
  const frontend = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/202610160001_careers.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(frontend, /storage\.from\(['"]private-cvs['"]\)\.upload/);
  assert.match(migration, /create policy "admins read private CVs" on storage\.objects for select to authenticated using\(bucket_id='private-cvs' and public\.is_careers_admin\(\)\)/);
  assert.match(migration, /create policy "applicants upload private PDF CVs" on storage\.objects for insert to anon,authenticated/);
  assert.doesNotMatch(migration, /create policy [^\n]*private CVs[^\n]*for select to anon/i);
});
