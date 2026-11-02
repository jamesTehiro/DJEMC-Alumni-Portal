# Admin OTP alignment with existing registration

Admin registration uses the existing Alumni registration OTP implementation as its reference. It does not introduce another OTP engine, provider or verification store. This report describes the current checkout; the deployed frontend/backend revision and Render environment remain unverified.

## Actual workflow comparison

| Area | Routed Alumni registration | Routed Employer registration | Admin registration |
| --- | --- | --- | --- |
| Frontend route | `/register` → `AlumniRegisterPage` | `/register/employer` → `EmployerRegisterPage` | `/admin` and `/admin/create` share `AdminPortalPage` |
| OTP engine | `createRegistrationOtp` | No registration OTP invocation in this checkout | Same factory, `purpose:admin-registration` |
| Generator and challenge store | Crypto six-digit codes; keyed HMAC; hashed browser session; `registration_email_verifications` | Not applicable | Same generator, table, locking and verification methods |
| Grant | Email/session-bound `alumni-registration` grant | Not applicable | Same grant implementation with separate Admin purpose/audience/session namespace |
| Expiration and attempts | Code 5 minutes; proof 10 minutes; 5 incorrect attempts | Not applicable | Same constants and enforcement |
| Resend and rate limits | 60-second cooldown; 3 resends per 15 minutes; database-backed IP/email/session limits | Existing registration rate limits | Same OTP/resend/rate-limit implementation |
| Gmail delivery | `registrationOtpEmail` → shared `utils/email` → Brevo HTTPS API; direct delivery | Permit-review/account notification email uses existing notification/queue behavior | Existing `enqueueEmails` → `email_queue_jobs` → `emailQueueWorker` → same `utils/email` Brevo adapter |
| Template | Shared core supplies existing plain text plus HTML | Existing templates unchanged | Shared core supplies the same plain-text verification content with an Admin subject; existing queue sends plain text |
| OTP interface | `useRegistrationOtp` and `RegistrationOtpModal` | No registration code-entry modal | Same hook and modal, with queued-versus-provider-accepted feedback |
| Completion | Consume proof in account transaction; email verified, account pending Registrar approval | Account pending permit review | Consume Admin proof in account transaction; only then create verified Admin |

The request described working Employer OTP. The routed Employer component and backend role branch in this checkout do not implement it: the form posts permits to `/auth/register`, and the controller consumes OTP only for `role==='alumni'`. No Employer OTP was invented or changed to reconcile that difference. Existing Employer registration, uploads, approval and login regressions were tested instead.

## Changes made in this follow-up

- Extracted Admin registration detail validation and reused it before initial OTP send, resend and transactional account creation. Invalid names, Gmail addresses, passwords and scopes cannot generate an Admin code. The shared OTP core still performs Gmail duplicate checks and challenge handling.
- Admin form reuses the existing registration validation hook and warning/success toasts. Added password confirmation, field locking during verification/submission, and the same close-modal/revalidate-form/create-account continuation used by Alumni.
- Existing shared OTP hook gained one backward-compatible request option: Admin can supply per-operation body fields. Name/password go only to Admin send/resend and final account creation; status/verify contain no password. Existing Alumni defaults and behavior remain unchanged.
- Admin automatically checks queued delivery status every 5 seconds while a code is current and the modal is open. Polling stops when sent, failed, verified, expired, closed or an error occurs. Manual status checking remains available. Verification stays disabled until the worker records provider acceptance; queue insertion is not reported as successful delivery.
- Same six-digit input, paste/focus behavior, incorrect/expired-code messages, attempt counter, resend cooldown and verification expiry remain in the shared modal/service. Changing Gmail clears the proof and returns focus to the address field.
- The existing Admin setup secret, configuration protections, delivery checks and three-account constraints remain in place. There is still one Registrar Officer, one Alumni Coordinator and one Employer Manager, with a maximum of three total Admin records including occupied pending/legacy records. `SERIALIZABLE` account creation rechecks all Admin rows, consumes the Admin proof and creates the account in one transaction. Unique scope/email constraints and bounded conflict retries remain.
- Existing verified Admin login, Alumni/Employer backend registration, shared OTP generation, email templates, Brevo provider and queue worker source were not changed in this follow-up.

The delivery transport and sender configuration are shared. The entire delivery path is **not identical**: Alumni retains its working direct Brevo send, while Admin retains the explicitly requested existing queue. Verification rules and input components are shared; Admin purpose binding prevents an Alumni grant from creating an Admin, and Admin-specific scope/limit checks remain additional requirements.

## Files changed in this follow-up

- `backend/services/adminRegistration.js`: one Admin detail validator, reused by creation and OTP handlers.
- `backend/controllers/adminRegistrationController.js`: validate Admin send/resend before invoking the shared core.
- `frontend/alumni-portal/src/features/auth/pages/AdminPortalPage.jsx`: existing registration UI components, password confirmation, modal continuation, loading/focus behavior and automatic queue-status checks.
- `frontend/alumni-portal/src/features/registration/hooks/useRegistrationOtp.js`: optional per-operation request body callback; unchanged Alumni defaults.
- `backend/tests/adminOtpWorkflow.test.js`: Admin handler delegation and validation-before-generation tests.
- `frontend/alumni-portal/tests/adminPortal.browser.test.js`: payload privacy, automatic status checks, validation, duplicate submissions and retained limit/login behavior.
- This report.

No migration, dependency, environment-file edit, credential change, user-account operation, commit or deployment was performed.

## Verification

- Targeted backend regression: **99 passed, zero failures, one skipped** (100 tests). Covers the shared Alumni OTP, queued Admin delivery and provider failures, correct/incorrect/expired codes, resends/limits, configuration isolation, duplicate scopes, fourth-account rejection, atomic proof consumption, existing verified Admin login/JWT/scopes, Employer permit registration/review and Alumni documents.
- The skipped test is an optional MySQL permit-reference storage integration check. No live Aiven or MySQL staging test is claimed; local mocked tests are not database-engine acceptance evidence.
- Frontend API/registration-validation/business-permit unit regressions: **12 passed, zero failures**.
- Changed frontend files pass ESLint. The Vite production build passes.
- Admin Portal browser regression: **4 passed, zero failures** after correcting fixture selectors/readiness waits. Covers full-limit registration hiding, login errors, invalid setup secret, queued delivery, automatic delivery-status updates, incorrect/correct OTP, password confirmation, duplicate submissions, desktop/mobile views and backend limit conflicts. Log: `tmp/admin-otp-consistency-admin-browser.log`.
- Alumni OTP browser regression: **3 passed**, including paste/focus, invalid/expired codes, refresh recovery and mobile layout. Existing Alumni/Employer registration-form browser regression: **3 passed** (the parent test plus both role cases), including document retention and validation.
- The initial combined browser log contains a failed Admin fixture selector that clicked the now-disabled background button; the corrected Admin rerun above is the final result. Other workflow checks passed in that original run and were unchanged.

Logs: `tmp/admin-otp-consistency-backend.log`, `tmp/admin-otp-consistency-frontend.log`, `tmp/admin-otp-consistency-browser.log`, `tmp/admin-otp-consistency-build.log`, and `tmp/admin-otp-consistency-lint.log`. Browser requests and email-provider calls are mocked. Automated tests send no real emails and create no production records.

## Remaining deployment prerequisites

The offline Admin readiness command correctly selects `.env.staging` and returns not ready. Current blockers are placeholder `BREVO_API_KEY`, `EMAIL_FROM`, `REGISTRATION_OTP_SECRET`, and missing `ADMIN_BOOTSTRAP_SECRET`. No value was displayed, replaced or copied into source.

Use the existing intended Brevo REST key, authorized sender and sender name; retain `EMAIL_PROVIDER=brevo`. Configure a stable random OTP signing secret and an explicit staging Admin setup secret privately. A selected staging file cannot borrow a missing Admin setup secret from the main `.env`.

Render must configure these independently: `EMAIL_PROVIDER`, `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `REGISTRATION_OTP_SECRET`, `ADMIN_BOOTSTRAP_SECRET`, plus existing database/JWT/CA settings. The embedded worker inherits API configuration. A separate worker needs matching mail/database settings. Actual Render settings, running worker revision, sender authorization and real inbox delivery remain unverified; no live send was attempted.

Deploy matching Admin frontend/backend versions together: Admin send/resend now includes and validates the registration name/password. Do not weaken backend validation to accept the earlier incomplete Admin payload. Existing Alumni and Employer API contracts are unchanged.

See [Admin OTP deployment configuration](admin-otp-deployment.md) for exact offline commands and Render prerequisites. This task did not deploy, change production configuration, enable account deletion or send real OTP messages.
