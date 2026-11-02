# Employer registration Gmail verification repair

## Cause

The active `/register/employer` route renders `EmployerRegisterPage.jsx`. Unlike `AlumniRegisterPage.jsx`, it had no `useRegistrationOtp`, OTP modal, email-bound verification session or grant fields. Its submit handler posted the permit and registration details straight to `/auth/register`.

The backend had the same gap: `authController.register` consumed a verification grant only when `role === 'alumni'`. The shared factory supported Alumni/Admin purposes only, and no Employer OTP routes or queue-job guard existed. Therefore an available Gmail passed duplicate checking and immediately created a pending Employer account. This was not a Brevo delivery failure: the Employer flow never requested an OTP.

Older `RegisterEmployerPage.jsx` / `RegisterPage.jsx` files are not the active routed pages. Updating only those files would not repair the actual route. Final account creation now enforces the grant regardless of which client calls it.

## Implemented workflow and preserved behavior

1. The current form validates company information, Gmail, matching passwords, consent and business permits before requesting verification. No permit upload/account creation request is made during the OTP phase.
2. `POST /api/auth/employer-registration-otp/send` checks the existing canonical Gmail lookup against all accounts, including pending/rejected and other roles. Available Gmail proceeds to the shared OTP service.
3. The existing cryptographic OTP factory now also accepts `employer-registration`. Alumni's default session/hash format and email content remain unchanged. Employer sessions and JWT audiences/purposes use their own namespace.
4. The existing Admin queue adapter's generic enqueue/status implementation was extracted into `registrationOtpQueue.js` and reused. Admin keys, configuration checks, exported functions and behavior are preserved. Employer uses its own configuration-bound prefix and does not require `ADMIN_BOOTSTRAP_SECRET`.
5. The existing email worker and central Brevo adapter deliver Employer messages. Queued status is not delivery success. Verification is refused until the matching job is recorded sent after provider acceptance; inbox delivery is not claimed by that state.
6. Incorrect, expired, replaced, already-consumed, wrong-email and wrong-session proofs remain rejected by the shared service. Resend cooldown, attempt limits and database rate limits remain in force. The worker checks Employer jobs for current challenge/configuration before sending; ordinary mail and Admin delivery retain their existing rules. Already accepted email cannot be retracted, but expired/replaced codes cannot authorize registration.
7. The shared modal handles the six-digit code, resend, expiration, failed delivery and successful verification. Employer adds an isolated browser storage key and optional delivery-status polling; Alumni/Admin polling and default behavior are preserved. Company details/passwords/files stay in memory while the OTP dialog is open. Browser storage contains only the email/session, never passwords, files, codes or grants.
8. Final multipart `POST /api/auth/register` includes `role:employer`, `session_token`, `registration_authorization`, company information and the existing `business_permit` fields. The backend consumes the Employer grant in the same transaction that creates the user and persists/reloads permit metadata. Failed persistence rolls back account creation and grant consumption.
9. New Employers remain `account_status:pending`, with `EmployerProfile.verified:false`; successful Gmail verification only sets the new user's email verification time. Existing approval/rejection, protected business-permit access, existing accounts, login and Admin scope/count restrictions are unchanged.

The four new endpoints are `POST /api/auth/employer-registration-otp/{send,resend,verify,status}`. Existing Alumni and Admin routes remain in place. `/api/auth/register` intentionally now rejects Employer clients lacking a valid Employer proof. Legacy clients must complete verification; there is no compatibility bypass.

The existing verification table has one challenge row per canonical email. A later challenge in another session/purpose can replace a pending challenge after the existing cooldown. This never allows cross-purpose grants: Employer and Alumni grants cannot authorize each other's account creation, even for the same email/session token.

## Configuration and deployment requirements

No environment file or credential was changed. No production data was queried or modified, no real mail was sent, and no deployment/commit/migration was performed.

- API: existing database/TLS settings, a stable private `REGISTRATION_OTP_SECRET` of at least 32 bytes, `EMAIL_PROVIDER=brevo`, existing private `BREVO_API_KEY`, a real Brevo-authorized `EMAIL_FROM`, and `EMAIL_FROM_NAME`.
- Email worker: the same four mail settings and database target/user. The separate worker does not need the OTP signing secret or Admin bootstrap secret merely to deliver Employer mail. The existing configuration fingerprint prevents mismatched sender/provider/DB settings from delivering the job.
- The existing worker must actually run. `EMAIL_WORKER_ENABLED=false` disables the embedded worker, so a separately managed worker is then required. A separate Render service does not inherit API settings automatically.
- `.env.staging` is not automatically loaded by Render. Employer retains the existing shared `process.env` loading behavior used by Alumni. Select staging explicitly before startup and provide the complete intended database/mail/signing configuration. Do not upload or commit the local environment file to production.
- The offline, file-only check of the current `.env.staging` finds placeholder `BREVO_API_KEY`, `EMAIL_FROM` and `REGISTRATION_OTP_SECRET`. `EMAIL_PROVIDER=brevo` and a sender display name are present. This does not inspect Render runtime settings; actual Render readiness and live Brevo/inbox delivery remain unverified.
- Existing `registration_email_verifications`, `email_queue_jobs`, rate-limit entries, normalized-email uniqueness and permit storage/schema must already be ready. This repair adds no schema, migration or provider. Do not replay migrations or enable startup synchronization.
- Deploy the compatible worker before exposing the new Employer producer, and update every API replica to enforce Employer grant consumption. Older workers treat Employer jobs as ordinary mail and cannot enforce their expiry guard. Deploy the matching frontend after backend readiness. Do not claim the production flow protected or fixed until all serving revisions are verified.

Existing schema migrations include `20260413-create-email-queue-and-rate-limit-tables.js`, `20261016-repair-email-queue-dedupe-key.js`, and `20261019-add-registration-gmail-otp.js`. Their presence here is not authorization to apply them or evidence that Render's database is ready.

## Validation

`tmp/employer-otp-backend-final.log`: **99 passed, zero failures, one optional MySQL test skipped**. Includes Employer queue/worker/mocked Brevo acceptance/rejection, incorrect/expired/resend/attempt checks, duplicate Gmail, cross-purpose and email/session binding, single-use proof, permit persistence rollback, existing real multipart upload/storage/preview/replacement checks, Alumni OTP, Admin OTP/configuration, existing login/authorization and ordinary email worker regressions. All DB operations are mocked/isolated fixtures; no real database acceptance claim is made from the skipped test.

Frontend results: **12 unit tests passed**, **13 browser tests passed**, changed-file ESLint passed, and the Vite production build passed. Evidence is under `tmp/employer-otp-{frontend-unit,browser,lint,build}.log`. Browser fixtures block external requests and use synthetic permits/accounts. The Employer browser cases exercise queued/sent/failure notifications, duplicate Gmail, invalid/expired/replaced codes, consent, permit retention, scoped request fields, duplicate-submit prevention and desktop/mobile layout. Existing Alumni and Admin browser suites are included.

One initial failing test assertion exposed a local bootstrap secret through assertion diagnostics. The assertion now checks a boolean, the saved initial log was redacted, and the corrected run passes. The earlier tool output cannot be retracted; rotate that secret privately if active. No credential value is recorded in this document and no secret was changed automatically.

## Files changed for this repair

Backend: `controllers/authController.js`, `controllers/registrationOtpController.js`, `routes/authRoutes.js`, `services/registrationOtp.js`, `services/registrationOtpQueue.js` (new), `services/employerOtpQueue.js` (new), `services/adminOtpQueue.js` (shared adapter extraction), `workers/emailQueueWorker.js`.

Frontend: `src/features/registration/pages/EmployerRegisterPage.jsx`, `src/features/registration/hooks/useRegistrationOtp.js`, `src/features/registration/components/RegistrationOtpModal.jsx`. The active Alumni page was not modified.

Tests: `backend/tests/employerRegistrationOtp.test.js` (new), `backend/tests/registrationOtpApi.test.js`, `backend/tests/employerPermitWorkflow.test.js` (verified-proof fixture for upload tests), `frontend/alumni-portal/tests/employerRegistrationOtp.browser.test.js` (new), `frontend/alumni-portal/tests/registrationValidation.browser.test.js` (both routed forms now verify before creation).

Documentation: this report. Environment files, the shared email provider, Admin registration/login/approval controllers and Employer approval controllers were not changed by this repair.
