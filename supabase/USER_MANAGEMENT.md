# Careers staff user management

The `/admin` Users tab is available only to an active `admin_profiles` row with role `admin`. User roles and active status are read from the database, never from editable Auth metadata. Recruitment Managers can still manage vacancies and applications through the existing careers policies, but cannot list, invite, edit, deactivate, reactivate, or remove staff.

The `staff-management` Edge Function verifies the caller's Auth token and database role, then uses Supabase Auth's server-side admin API. The service-role key stays in the Edge Function runtime. The database RPC that changes staff profiles is executable only by `service_role`. Staff access events are recorded in `staff_management_audit`; it contains staff identifiers, emails and role changes, never candidate application content or CV data. Removing an Auth user preserves historical vacancies (`jobs.created_by` becomes null), applications, and audit events.

## Staging deployment

Confirm the selected project is **RheelTech-Staging**, ref `oyfrihexkaaozsniezxk`, before applying the migration or deploying the function. Apply the new migration `20261018142719_user_management.sql`, then deploy `staff-management` with JWT verification enabled. Configure the existing Edge Function mail secrets `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `CONTACT_NOTIFICATION_EMAIL` if invitations should be emailed. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the Edge Function runtime; never put the service-role key in Vite environment variables or browser code.

The function accepts the staging Preview origin and local development origins `http://localhost:4173` and `http://127.0.0.1:4173`. The staging origin is `https://rheeltech-staging-git-vercel-staging-rheel.vercel.app`. Keep the function's `verify_jwt` setting enabled.

After deployment, sign in as the existing staging administrator, open **Users**, invite a disposable staging account as Recruitment Manager, verify its password setup email, and confirm it can manage vacancies/applications but cannot see Users. As administrator, test profile/role editing, deactivate/reactivate, setup-link resend, and a confirmed removal using a disposable account. Verify an attempt to demote/deactivate/remove the last active administrator is rejected and that each action appears in the access audit. Do not use real candidate records for test submissions.
