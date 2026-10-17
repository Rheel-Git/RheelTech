# RheelTech Website

New React, TypeScript and Vite website for Rheel Technology Limited. GitHub Pages hosts the static frontend; Supabase provides careers data, authentication, private CV storage and Edge Functions.

## Local development

1. Install Node.js 22+ and pnpm 11.25.0. The project allows the esbuild package install script so Vite can prepare its platform binary.
2. Run `pnpm install --frozen-lockfile`.
3. Copy `.env.example` to `.env.local` and set the Supabase project URL and public anon/publishable key.
4. Run `pnpm run dev`.

Without Supabase settings, public informational pages work and forms report setup-required; no backend is implied to be operational.

## Supabase setup

Create a Supabase project, then apply `supabase/migrations/202610160001_careers.sql` with Supabase CLI. Create the first admin/recruiter by creating an Auth user through the controlled dashboard and inserting its UUID into `admin_profiles` using a trusted SQL editor. Never permit public signup or let users edit this table. Deploy `submit-application` and `contact-enquiry` Edge Functions separately. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `CONTACT_NOTIFICATION_EMAIL` as function secrets only. Confirm the Resend sender domain and configure an approved sender before production.

The current submission function validates fields and vacancy status; rate limiting, antivirus scanning, stronger CV ownership proof, notification email for applications and CAPTCHA/honeypot protection remain required before production. The bucket accepts only UUID-named PDF uploads and remains private, but abuse controls must be added before recruitment launches.

## GitHub Pages and domain

1. Create a dedicated RheelTech repository; do not use or modify the Rheel Group repository.
2. Commit `pnpm-lock.yaml` so the Actions `pnpm install --frozen-lockfile` step is reproducible.
3. Set the default branch to `main`; enable GitHub Actions as the Pages source in Settings → Pages.
4. Add the repository custom domain `rheeltech.ng` in Pages settings and complete domain verification.
5. Review GitHub’s current Pages DNS values with the domain provider before changing records. For an apex domain use the four A records GitHub currently specifies and an optional AAAA set; add `www` as a CNAME to the repository Pages hostname only if desired. Do not change existing production DNS until the owner approves.
6. Wait for DNS verification, enable Enforce HTTPS, and test `/`, every public route, refreshes, and the custom domain.
7. Configure the Supabase URL and public key as GitHub Actions repository variables, then pass them as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to the build step if desired. They are public values; security depends on RLS. Never put service-role or email secrets in build variables.

## Current limitations

The admin view has secure Supabase sign-in and setup/error messaging but full job CRUD and application review UI are not yet implemented. Contact and careers Edge Functions are starter workflows, not production-ready: add rate limits and abuse controls, enforce upload ownership, add application mail, validate content server-side, configure a verified sender, and test policies in Supabase. Privacy wording requires legal review. Product marks, founder name/photo, approved screenshots and social share art remain to be supplied.
