# Privacy notice and retention review

**Status:** Internal review draft. The business address, proposed lawful bases, retention schedule, transfer-safeguard review, and Zoho Mail retention settings have been confirmed by the company for the draft. Deletion implementation and its dry-run remain open. This document is not the public privacy notice and does not authorize deletion or automated purging of production records.

**Scope reviewed:** Public website and staff careers portal in `Rheel-Git/RheelTech`; production Supabase project `Rheel-Tech` (`eu-west-1`); deployed Supabase Edge Functions; the production careers gateway configuration described in this repository.

## Current data flows verified

| Flow | Data observed in implementation | Destination/use |
|---|---|---|
| Contact enquiry | Name, email, organisation (optional), enquiry type, message | Sent to the configured contact inbox through the Cloudflare gateway, Supabase Edge Function, and Resend. No contact table was found in the reviewed production schema. |
| Job application | Name, email, phone, location, experience summary, cover letter, PDF CV, consent timestamp | Application details are stored in Supabase `public.applications`; CV is stored in the private `private-cvs` bucket. Recruiters and administrators with active staff access can review records. |
| Application email | Candidate name and email in recruitment notification; candidate confirmation email | Sent through Resend. The implementation does not attach the CV or cover letter. Email-provider logs and recipient mailboxes are separate copies requiring their own retention rules. |
| Staff access | Auth account email; staff role, display name, active/deactivated state; access audit entries with actor and target email | Supabase Auth, `admin_profiles`, and `staff_management_audit`. Audit access is administrator-only. |
| Website delivery | Visitor connection information handled by hosting and gateway providers; Google Fonts is loaded remotely | GitHub Pages serves the public site; the production form gateway is a Cloudflare Worker; CSS imports Google Fonts. Confirm each vendor's relevant logging and data terms. |

Production database inspection found RLS enabled on all application tables. The CV bucket is private, limited to PDF files up to 5 MB, and staff-only reads are enforced. The project region is EU Ireland (`eu-west-1`). Supabase's documentation says some operational logs and support processing may occur outside the selected project region. Resend states that email data is stored in the US and email/log data is retained for 30 days on its Free, Pro, and Scale plans. Confirm the actual account plan, terms, subprocessors, and transfer safeguards before putting these statements in the public notice.

## Findings to close

1. **The live privacy page is labelled a draft.** It says legal review is required and says retention and deletion procedures are not yet set. Replace that language only after the notice details below are approved.
2. **No production retention process was found.** No `pg_cron` extension or job is installed, and the three deployed functions do not include a retention-cleanup function.
3. **Staff cannot erase applications through the current portal/database policy path.** The production application policies allow staff reads/updates but no staff DELETE. Storage policies block direct staff deletes of private CV objects. A database-only deletion would also leave the CV object, because the CV path is stored as text rather than a foreign key.
4. **Staff audit data has no retention rule.** It stores actor and target email addresses.
5. **Contact enquiries live in email.** The application database does not provide a deletion point for contact enquiries; include the company mailbox and any forwarding/archive copies in the process.
6. **Cloudflare gateway logging is unverified.** The gateway implementation itself is not included in the repository, so confirm that request bodies and headers are not logged and establish its log retention period.
7. **Production/repository migration drift exists.** Production reports migration `20261019195750_careers_security_reconciliation`, but the matching SQL file was not present in the repository tree when reviewed. Reconcile this before adding a retention migration or scheduled cleanup.

## Company-approved draft retention schedule

The company approved these periods for drafting on 25 October 2026. They are operational policy choices, not statutory periods. Do not activate cleanup until the deletion mechanism, exceptions, provider copies, and legal review are complete.

| Category | Approved draft rule | Expiry anchor |
|---|---|---|
| Unsuccessful/withdrawn application and CV | 12 months | Final recruitment decision for the vacancy |
| Contact enquiry and associated mailbox copies | 12 months | Last substantive response or resolution |
| Staff access audit entries | 24 months | Audit event date |
| Active staff Auth/profile data | While access is needed; review promptly on deactivation | Staff deactivation date |
| Optional future-candidate talent pool | Only under a separate, specific opt-in; set a separate expiry | Opt-in date |
| Supabase backups, Resend logs, hosting/gateway logs | Record the actual provider/plan window and explain residual copies | Provider retention/expiry date |

Successful candidates' records should move to a separately approved employee-record schedule. Legal holds or active disputes should be documented, access-restricted, reviewed periodically, and limited to the data actually needed.

## Deletion and data-request process to implement

1. Provide a monitored privacy contact and a simple intake path for access, correction, objection, restriction, portability, consent withdrawal, and erasure requests. Verify identity proportionately; do not ask for excessive identity documents.
2. Record the request date, request type, systems searched, owner, deadline, outcome, and any legal exception. The public notice should give the applicable complaint route to the NDPC.
3. For scheduled expiry or an approved erasure request, locate the application, delete its private CV object through the Supabase Storage API, then delete or irreversibly de-identify the application record. Never delete Storage object metadata directly with SQL; that can orphan the underlying file. Make the job retryable and idempotent; if file deletion fails, retain the record for retry and raise an administrator alert. Preserve only a minimal, non-identifying completion audit.
4. Handle contact-enquiry copies in the recipient mailbox, forwarding rules, and archives under a separate mailbox procedure.
5. Apply deletion decisions after a backup restore so expired records are not silently reintroduced. Document provider backup expiry and any unavoidable residual copies.
6. Keep a dry-run report and require an operator to review affected record counts before the first production cleanup. Do not expose names, email addresses, CV paths, or other applicant details in routine job logs.
7. Add an admin-visible deletion/request workflow and a protected scheduled cleanup mechanism only after periods, access controls, failure handling, and backup behavior are approved.

## Public notice decisions still required

- The supplied business address is **Plot 473, Constitution Avenue, Abuja, FCT, Nigeria**.
- Approved lawful basis by purpose (contact enquiries, recruitment, staff account administration, security/audit), confirmed by the company's adviser. The required application checkbox alone should not be assumed to settle every processing purpose.
- Retention periods are approved for drafting: 12 months for unsuccessful/withdrawn applications and CVs, 12 months for contact enquiries, and 24 months for staff audit entries. Confirm how exceptions/legal holds work.
- Complete processor list and roles, including the company mailbox, GitHub Pages, Cloudflare, Supabase, Resend, and Google Fonts (or decision to self-host the fonts).
- Zoho Mail is the receiving inbox provider; company confirms 12-month retention also covers forwarding/archive copies.
- Company confirms international-transfer grounds and safeguards were reviewed with its adviser for the EU-hosted Supabase project, Resend's US processing/storage, Zoho Mail, and any other out-of-country processing.
- Data-subject rights, privacy contact, complaint route to NDPC, and any relevant automated decision-making statement.
- Company confirms no analytics or non-essential tracking are enabled. Retain the gateway logging and provider backup/log windows in the internal processing record.

## Sources

- [Nigeria Data Protection Act, 2023 (official NDPC copy)](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf)
- [NDP Act General Application and Implementation Directive 2025 (official NDPC copy)](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf)
- [Supabase Data Residency and Transfers FAQ](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq)
- [Supabase database backup documentation](https://supabase.com/docs/guides/platform/backups)
- [Resend security and retention information](https://resend.com/security)


## Draft notice

A separate publication candidate is in [privacy-notice-draft.md](privacy-notice-draft.md). It remains internal until its checklist is closed and the notice accurately describes an implemented deletion process.

- [Supabase Storage object deletion guidance](https://supabase.com/docs/guides/storage/management/delete-objects)
