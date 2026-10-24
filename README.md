# RheelTech Website

New React, TypeScript and Vite website for Rheel Technology Limited. GitHub Pages hosts the static frontend; Supabase provides careers data, authentication, private CV storage and Edge Functions.

## Local development

1. Install Node.js 22+ and pnpm 11.25.0. The project allows the esbuild package install script so Vite can prepare its platform binary.
2. Run `pnpm install --frozen-lockfile`.
3. Copy `.env.example` to `.env.local` and set the Supabase project URL and public anon/publishable key.
4. Run `pnpm run dev`.

Without Supabase settings, public informational pages work and forms report setup-required; no backend is implied to be operational.

## Supabase setup

Create a Supabase project, then apply the migrations with the Supabase CLI. The application idempotency/email migration must be applied before deploying the updated `submit-application` function. Create the first admin/recruiter by creating an Auth user through the controlled dashboard and inserting its UUID into `admin_profiles` using a trusted SQL editor. Never permit public signup or let users edit this table.

### Staging Edge Function deployment and email secrets

The commands below target only the RheelTech-Staging project (`oyfrihexkaaozsniezxk`). Run them from the repository root after installing and authenticating the Supabase CLI. This checkout currently has no `supabase/config.toml`; run `supabase init` once from the repository root to create the CLI configuration, then review the generated file before continuing. Do not use the production project ref.

1. Create an ignored `supabase/.env.staging` file with these values, using the verified Resend sender and the real recruitment inbox:

   ```dotenv
   RESEND_API_KEY=replace-with-your-resend-api-key
   RESEND_FROM_EMAIL="RheelTech Website <notifications@mail.rheeltech.ng>"
   CONTACT_NOTIFICATION_EMAIL=replace-with-your-contact-inbox
   # Optional; defaults to CONTACT_NOTIFICATION_EMAIL.
   RECRUITMENT_NOTIFICATION_EMAIL=replace-with-your-recruitment-inbox
   ```

   Keep the file private. `.env.*` is Git-ignored. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions at runtime; do not add either to this file, Vercel, or client-side code.

2. Link staging and inspect its migration history before applying anything. The careers schema was previously applied through the Dashboard, so do not run `db push` if the original migration is shown as pending; first reconcile CLI migration history with the actual staging schema. Then apply the new idempotency migration, configure secrets and deploy both functions:

   ```sh
   supabase init
   supabase login
   supabase link --project-ref oyfrihexkaaozsniezxk
   supabase migration list --linked
   supabase db push --linked
   supabase secrets set --env-file supabase/.env.staging --project-ref oyfrihexkaaozsniezxk
   supabase functions deploy contact-enquiry --project-ref oyfrihexkaaozsniezxk
   supabase functions deploy submit-application --project-ref oyfrihexkaaozsniezxk
   ```

   The secrets and function commands explicitly target staging, not production. Only continue with `db push` after confirming the previously applied careers schema is recorded as applied. Deploy after the new migration so the submission function can use the idempotency and email-status columns.

Contact enquiries are sent to `CONTACT_NOTIFICATION_EMAIL`; the visitor address is retained as the reply-to. Career applications are saved first, then the applicant receives a short receipt and the recruitment inbox receives only the candidate name, email, vacancy title and received time. CVs, phone numbers, location, experience and cover letters are not emailed. A missing or failed email does not undo an application; the form reports that the application was received and whether the applicant receipt email was sent. A stable per-form submission key and unique database index make retries reuse the original application.

The submission endpoint still needs its separately planned abuse controls, malware scanning and tighter origin/rate-limit protections before production. The private bucket accepts UUID-named PDF uploads; review existing storage policies and application access controls before production. Email delivery is best effort: if Resend accepts an email but the subsequent delivery-status database update fails, a later retry could send that email again. The unique submission key still prevents a second application record.

## GitHub Pages and domain

1. Create a dedicated RheelTech repository; do not use or modify the Rheel Group repository.
2. Commit `pnpm-lock.yaml` so the Actions `pnpm install --frozen-lockfile` step is reproducible.
3. Set the default branch to `main`; enable GitHub Actions as the Pages source in Settings → Pages.
4. Add the repository custom domain `rheeltech.ng` in Pages settings and complete domain verification.
5. Review GitHub’s current Pages DNS values with the domain provider before changing records. For an apex domain use the four A records GitHub currently specifies and an optional AAAA set; add `www` as a CNAME to the repository Pages hostname only if desired. Do not change existing production DNS until the owner approves.
6. Wait for DNS verification, enable Enforce HTTPS, and test `/`, every public route, refreshes, and the custom domain.
7. In GitHub repository Settings → Secrets and variables → Actions → Variables, configure `PRODUCTION_SUPABASE_URL`, `PRODUCTION_SUPABASE_PUBLISHABLE_KEY`, and `PRODUCTION_CAREERS_GATEWAY_URL` for the production build. The Pages workflow maps these to the `VITE_*` variables and uses `/` as the base path for the apex domain. The Supabase URL, publishable key and gateway URL are public frontend configuration; access control depends on RLS and the gateway signature design. Never put a Supabase service-role/secret key, Resend key, or HMAC secret in build variables.

## Current limitations

The protected `/admin` portal supports vacancy creation and editing, draft/published/closed/archived status, candidate application review, status updates, internal notes, and short-lived signed links to private CVs. These screens rely on the Supabase `admin_profiles`, `jobs`, `applications`, and private `private-cvs` bucket policies; the UI does not grant database access. Contact and careers Edge Functions still need the remaining abuse controls and staging policy tests described above before production. Privacy wording requires legal review. Product marks, founder name/photo, approved screenshots and social share art remain to be supplied.
