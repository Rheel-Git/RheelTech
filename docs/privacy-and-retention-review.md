# Privacy notice and retention review

**Status:** Review and implementation complete for this release. The company approved the notice details, business address, retention schedule, Zoho Mail procedure, and transfer-safeguard review. Production schema and the administrator-operated retention function are deployed. The function has not been run to delete records; the monthly process remains manually initiated after aggregate preview and legal-hold review.

**Scope reviewed:** Public website and staff careers portal in `Rheel-Git/RheelTech`; production Supabase project `Rheel-Tech` (`eu-west-1`); deployed Supabase Edge Functions; the production careers gateway configuration described in this repository.

## Current data flows verified

| Flow | Data observed in implementation | Destination/use |
|---|---|---|
| Contact enquiry | Name, email, organisation (optional), enquiry type, message | Sent to the configured contact inbox through the Cloudflare gateway, Supabase Edge Function, and Resend. No contact table was found in the reviewed production schema. |
| Job application | Name, email, phone, location, experience summary, cover letter, PDF CV, consent timestamp | Application details are stored in Supabase `public.applications`; CV is stored in the private `private-cvs` bucket. Recruiters and administrators with active staff access can review records. |
| Application email | Candidate name and email in recruitment notification; candidate confirmation email | Sent through Resend. The implementation does not attach the CV or cover letter. Email-provider logs and recipient mailboxes are separate copies requiring their own retention rules. |
| Staff access | Auth account email; staff role, display name, active/deactivated state; access audit entries with actor and target email | Supabase Auth, `admin_profiles`, and `staff_management_audit`. Audit access is administrator-only. |
| Website delivery | Visitor connection information handled by hosting and gateway providers; Google Fonts is loaded remotely | GitHub Pages serves the public site; the production form gateway is a Cloudflare Worker; CSS imports Google Fonts. The company should periodically confirm each vendor's relevant logging and data terms. |

Production database inspection found RLS enabled on all application tables. The CV bucket is private, limited to PDF files up to 5 MB, and staff-only reads are enforced. The project region is EU Ireland (`eu-west-1`). Supabase's documentation says some operational logs and support processing may occur outside the selected project region. Resend states that email data is stored in the US and email/log data is retained for 30 days on its Free, Pro, and Scale plans. The published notice describes the relevant provider processing; the company should periodically confirm account plan, terms, subprocessors, and transfer safeguards.

## Findings and implemented controls

1. **Privacy notice:** the previous live page was a draft. This release replaces it with the company-approved notice and aligns it with the production data flows and retention schedule.
2. **Administrator-operated cleanup:** the staff portal has a protected retention review. It shows aggregate counts first and requires a typed confirmation to process eligible records. No automatic cron job is configured.
3. **Application/CV deletion:** only rejected or withdrawn applications at least 12 months past the final-decision timestamp qualify. Active, offered, hired, and legally held applications are excluded. CVs are removed through the Supabase Storage API before the application row. The operation is batched and retryable; failed CV removals leave the application for review.
4. **Staff audit deletion:** audit entries older than 24 months qualify unless on legal hold. Administrators can place and clear holds from the audit list.
5. **Contact email:** enquiries are not stored in the careers database. Zoho inbox, forwarding, and archive copies are handled separately under the approved 12-month mailbox procedure.
6. **Provider copies:** backups and provider logs may remain until their documented expiry. They are not represented as immediately erased from all provider systems.
7. **Migration history:** production has a pre-existing migration version whose source file is missing from this repository. The additive retention migration was checked against the live schema before application; recover the missing historical source separately before future schema work.

## Company-approved retention schedule

The company approved these periods on 25 October 2026. They are operational policy choices, not statutory periods. The monthly cleanup is administrator-confirmed; no automatic cron job is configured.

| Category | Approved rule | Expiry anchor |
|---|---|---|
| Unsuccessful/withdrawn application and CV | 12 months | Final recruitment decision for the vacancy |
| Contact enquiry and associated mailbox copies | 12 months | Last substantive response or resolution |
| Staff access audit entries | 24 months | Audit event date |
| Active staff Auth/profile data | While access is needed; review promptly on deactivation | Staff deactivation date |
| Optional future-candidate talent pool | Only under a separate, specific opt-in; set a separate expiry | Opt-in date |
| Supabase backups, Resend logs, hosting/gateway logs | Record the actual provider/plan window and explain residual copies | Provider retention/expiry date |

Successful candidates' records should move to a separately approved employee-record schedule. Legal holds or active disputes should be documented, access-restricted, reviewed periodically, and limited to the data actually needed.

## Operating procedure

1. Provide a monitored privacy contact and a simple intake path for access, correction, objection, restriction, portability, consent withdrawal, and erasure requests. Verify identity proportionately; do not ask for excessive identity documents.
2. Record the request date, request type, systems searched, owner, deadline, outcome, and any legal exception. The public notice should give the applicable complaint route to the NDPC.
3. For monthly expiry review, an administrator opens the Retention area, previews counts, checks legal holds, and types the required confirmation. The edge function removes each private CV through the Supabase Storage API before deleting the application row. It processes up to 100 applications at a time. Failed CV removals leave the application available for review and retry. Routine responses show aggregate counts, not names or CV paths.
4. Handle contact-enquiry copies in the recipient mailbox, forwarding rules, and archives under a separate mailbox procedure.
5. Apply deletion decisions after a backup restore so expired records are not silently reintroduced. Document provider backup expiry and any unavoidable residual copies.
6. Keep a monthly record of preview and completion counts in the internal processing log without copying applicant details.
7. For an erasure request, verify identity proportionately, assess legal holds and exceptions, then have an administrator use the same deletion path after approval. Handle inbox copies and provider backups separately.

## Confirmed decisions and ongoing checks

- **Confirmed by the company:** business address; purpose-specific lawful bases reviewed with the adviser; operational retention periods and legal-hold handling; Zoho Mail as the receiving provider, including 12-month retention of mailbox, forwarding, and archive copies; international-transfer safeguards reviewed with the adviser; no analytics or non-essential tracking.
- **Ongoing internal checks:** periodically verify provider backup, email-log, and gateway-log expiry settings; review Zoho mailbox procedures; keep processor and international-transfer records current.
- The application consent checkbox does not, by itself, establish the lawful basis for every processing purpose.

## Sources

- [Nigeria Data Protection Act, 2023 (official NDPC copy)](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf)
- [NDP Act General Application and Implementation Directive 2025 (official NDPC copy)](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf)
- [Supabase Data Residency and Transfers FAQ](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq)
- [Supabase database backup documentation](https://supabase.com/docs/guides/platform/backups)
- [Resend security and retention information](https://resend.com/security)


## Publication

The approved public notice is in [privacy-notice-draft.md](privacy-notice-draft.md) and is published on the website Privacy page. The staff portal includes the retention review and legal-hold controls. The administrator should retain a monthly aggregate completion record.

- [Supabase Storage object deletion guidance](https://supabase.com/docs/guides/storage/management/delete-objects)
