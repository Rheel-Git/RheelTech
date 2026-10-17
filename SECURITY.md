# Security notes

- Keep only the Supabase public anon/publishable key in the browser; never ship service-role or mail-provider secrets.
- Applications are not granted to anon; CV bucket is private; administrator access depends on the trusted `admin_profiles` table.
- Do not enable public administrator registration. Provision accounts and roles out of band.
- Before launch, test anonymous, applicant, authenticated non-admin, and admin access paths; the current migration intentionally blocks browser-side applicant uploads until a signed upload workflow is built.
- Add server-side rate limiting, request abuse controls, CV upload ownership verification and malware scanning before enabling applications.
- Review and test Edge Functions and RLS policies in a non-production Supabase project before deployment.
