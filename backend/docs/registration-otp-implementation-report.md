# Alumni Gmail OTP implementation and deployment report

Prepared 20 October 2026 for the DJEMC Alumni Tracking and Job Portal. Local implementation is complete. Aiven schema inspection and Aiven staging validation await secure access; production modification and deployment require explicit approval. No production database migration, real OTP delivery, GitHub push, Render deployment or Firebase deployment was performed.

## Implemented behavior

Alumni completes the existing form and privacy consent, then selects Verify Gmail & Continue. The backend validates Gmail eligibility and sends a six-digit code through the existing Brevo API adapter. Successful OTP entry returns a signed registration authorization valid for ten minutes. Create Account submits the original fields and selected document with that authorization and the matching browser registration session.

The backend locks the verification row and consumes authorization in the same transaction that creates the pending user and alumni profile. A failed user/profile save rolls everything back. Verification does not approve the account, assign an official alumni record, issue a login token or change role permissions.

The existing success notification and pending Registrar queue remain. Official-record matching, proof review and approval continue through the existing Registrar handlers. The rejection handler previously retained history but sent no rejection notification; it now uses the existing notification/queue service to notify the same account. Rejected registrations retain their profiles and history and are directed to the Registrar for reconsideration using the existing review/approval path. They are never deleted, merged or silently recreated.

New alumni must use @gmail.com. Addresses are trimmed and lowercased. Gmail dots and +tags, and legacy @googlemail.com equivalents, share one database uniqueness key. Delivery always uses the exact validated, trimmed/lowercased Gmail address entered, never a rewritten canonical mailbox. Non-Gmail Employer/Admin flows remain available; their new ORM email writes receive the same trim/lowercase normalization and shared database uniqueness protection.

## Files inspected and services reused

Inspected the registration page, form validation hook, registration route/controller, User/AlumniProfile/AlumniRecord/EmployerProfile and related models, database configuration, historical migrations, existing schema audit tools, upload middleware, file access handlers, Registrar pending/approval/rejection handlers, notification controller, email queue and worker, Brevo/Nodemailer adapter, rate-limit store, login/JWT/role/admin-scope middleware, server startup/CORS, frontend API settings, Firebase hosting settings and relevant regression tests.

Reused `utils/email.js` (existing Brevo HTTPS transactional API and verified sender), `utils/rateLimitStore.js` and `rate_limit_entries`, `notificationController.createNotification`, the existing email queue for approval/rejection notifications, the current multipart upload/storage engines, registration transaction/profile creation, registration validation/privacy/success components and Registrar official-record matching. No new email provider or Gmail SMTP credentials were introduced.

## Created files

Paths below are relative to the repository root.

| Files | Purpose |
| --- | --- |
| backend/utils/registrationEmail.js | Shared backend normalization, strict Gmail validation and canonical SQL expression |
| backend/utils/registrationOtpEmail.js | Reuses the existing Brevo adapter; rejects accidental provider switching for OTP |
| backend/services/registrationOtp.js | Secure generation, keyed hashing, session binding, attempts, resend budget, authorization and consumption |
| backend/controllers/registrationOtpController.js | Consistent OTP APIs and persistent IP/email/session rate limits |
| backend/models/RegistrationEmailVerification.js | Explicit lowercase verification table mapping |
| backend/migrations/20261019-add-registration-gmail-otp.js | Additive, duplicate-audited migration; destructive down disabled |
| backend/config/registrationMigrationDatabase.js | Dedicated migration connection; remote certificate verification |
| backend/scripts/applyRegistrationOtpMigration.js | Read-only default, explicit target/apply/production guards |
| backend/scripts/checkRegistrationOtpConfig.js | Configuration presence checks without printing secrets or sending mail |
| backend/tests/registrationOtp.test.js | OTP policy, provider failure, session, expiry, concurrency and rollback tests |
| backend/tests/registrationOtpApi.test.js | Rate-limit identities, fail-closed behavior, error privacy and read-only startup |
| backend/tests/registrationOtpMigration.test.js | Duplicate refusal, schema/reuse guards, additive SQL and idempotence |
| backend/tests/registrationMigrationConnection.test.js | Dedicated credentials, verified TLS and approval/target guards |
| backend/tests/registrationOtpDatabase.integration.test.js | Opt-in fresh local database integration; real locks, unique constraints, account and Registrar flows |
| frontend/alumni-portal/src/utils/registrationEmail.js | Matching frontend Gmail validation |
| frontend/alumni-portal/src/hooks/useRegistrationOtp.js | OTP requests, authoritative status recovery, countdowns and session persistence |
| frontend/alumni-portal/src/components/RegistrationOtpModal.jsx | Responsive, accessible six-digit OTP modal |
| frontend/alumni-portal/tests/registrationOtpUi.test.mjs | Isolated desktop/mobile browser checks with blocked external requests |
| backend/docs/registration-otp-database-review.md; this report | Exact SQL, review findings, deployment and rollback instructions |

## Modified files

| Files | Change |
| --- | --- |
| backend/models/User.js; models/index.js | Nullable email_verified_at, normalized new email writes and new verification model registration |
| backend/controllers/authController.js; routes/authRoutes.js | OTP endpoints; signed authorization required for final alumni registration; pending status retained; rejected alumni denied login |
| backend/controllers/registrarController.js | Existing notification pipeline now sends rejection notification without deleting history |
| backend/middleware/requestLogger.js | Redacts auth query strings |
| backend/middleware/uploadMiddleware.js | Cleans up only the failed request's newly uploaded proof; successful uploads remain unchanged |
| backend/server.js; utils/databaseReadiness.js | Startup performs read-only readiness checks; removes prior automatic employer migration and optional-table creation; refuses startup synchronization |
| backend/tests/authDatabaseFlow.test.js; registrationYearAndSearch.test.js; secureFiles.test.js; modelTableMappings.test.js | Existing fixtures updated for the OTP contract and new model |
| frontend/alumni-portal/src/pages/AlumniRegisterPage.jsx; pages/AuthPage.css | Existing form preserved; Gmail verification and modal integration; green/cream responsive styles |
| frontend/alumni-portal/src/services/api.js | Preserves API error code and retry delay for OTP feedback |
| frontend/alumni-portal/package.json | Adds test:registration-ui script; no dependency changes |
| frontend/alumni-portal/tests/registrationValidation.browser.test.js; tests/businessPermits.browser.test.js | Existing registration fixture includes mocked OTP before final registration; stable consent selectors and modal transition waits |

The pre-existing modified Firebase hosting cache and the concurrent EmployerRegisterPage.jsx consent-heading edit are outside this change and were preserved. Do not include `.env`, private certificates, generated browser profiles, test artifacts or that cache in the feature commit.

## Database changes and evidence

The available working database is MariaDB 10.4.32, not Aiven MySQL. Its users.email already has full unique indexes, with zero collision groups under raw database comparison, trim/lowercase and canonical Gmail comparison. Existing redundant raw email indexes were preserved. The working portal database was not migrated.

The opt-in integration harness created new local `djemc_otp_*_test` databases, populated only synthetic fixtures and applied the migration there. Original fixture users, profiles, employers and official records retained their original values. Fresh test databases and partial fixtures from earlier failed checks were retained; no destructive SQL cleanup was executed.

Proposed production additions, conditional on the actual Aiven audit:

- Nullable `users.email_verified_at DATETIME DEFAULT NULL`, with no legacy-user backfill or login requirement.
- Virtual generated `users.normalized_email VARCHAR(255)` and full unique index `users_normalized_email_uq` across roles/statuses.
- `registration_email_verifications`: email_key primary key, delivery email, unique session_hash, nullable otp_hash, status, millisecond-precision expires_at/sent_at, verified_at, consumed_at, consumed_by_user_id, bounded JSON resend_history, failed_attempts, createdAt and updatedAt. The optional user reference preserves verification history with ON DELETE SET NULL.

The migration audits duplicates before its first DDL, reuses compatible existing email_verified_at, refuses conflicting verification fields/tables for manual reuse review, preserves raw email indexes and refuses incompatible definitions/key types/engines. It never updates existing account values, grants roles, resets IDs, recreates users or synchronizes models. The ordinary timestamp column is added before indexing the virtual column to support MariaDB's INSTANT restrictions.

Exact SQL and schema-retaining rollback steps are in [registration-otp-database-review.md](registration-otp-database-review.md). INSTANT/INPLACE requirements have no copying fallback. DDL may still need metadata locks; measure this on Aiven staging. MySQL DDL implicitly commits, so transaction ROLLBACK is not a schema rollback.

## API endpoints

All endpoints are POST; credentials are in request bodies, never URLs. OTP responses use Cache-Control: no-store.

| Endpoint | Request / result |
| --- | --- |
| /api/auth/registration-otp/send | email, session_token; creates or reuses active challenge without duplicate mail |
| /api/auth/registration-otp/resend | email, session_token; explicit replacement subject to cooldown and rolling budget |
| /api/auth/registration-otp/verify | email, session_token, six-digit otp; returns signed registration_authorization on success |
| /api/auth/registration-otp/status | email, session_token; recovers the same valid authorization after refresh; never returns an OTP |
| /api/auth/register | Existing multipart fields/files plus session_token and registration_authorization for alumni; creates pending account |

## Security and UI

- crypto.randomInt creates six digits. OTP hashes are HMAC-SHA256 using a server-only secret; session identifiers contain 256 random bits and only their SHA-256 hashes are stored.
- Five-minute expiry; five incorrect/malformed attempts per issued code; 60-second cooldown; at most three replacement sends in any rolling 15 minutes, including across new browser sessions and provider failures.
- Additional database-backed per-hour limits: send IP 20/email 10/session 10; verify IP 60/email 30/session 30; status IP 180/session 120; final registration IP 30/email 10/session 10. Shared counters survive Render restarts and multiple instances. New limit checks fail closed. req.ip uses the configured Express proxy boundary rather than an arbitrary forwarded header.
- Signed ten-minute authorization checks algorithm, audience, issuer, purpose, exact delivery email, session and verified timestamp. It is invalidated by replacement or consumption and cannot serve as a portal login JWT.
- Row locks serialize verification attempts, resends and consumption. Account uniqueness is enforced by a full generated-column unique index, including simultaneous pending registrations and aliases across roles.
- OTP mail uses the existing Brevo API and verified sender, with the requested text and a green/cream HTML template. It is sent directly rather than storing plaintext OTPs in delayed queue jobs. Brevo acceptance alone never verifies Gmail. Failures invalidate the code; rate-limit Retry-After is honored without automatic ambiguous retries or provider fallback.
- The modal has six inputs with automatic focus, arrow/backspace behavior, paste/autofill support, countdown, disabled/loading controls, incorrect/expired/attempt-limit feedback, resend controls, Change Gmail and verification success. Existing form values and selected files remain while the modal opens/closes.
- A full refresh retains only email and random session in sessionStorage. The server recovers verification. Passwords, form details, OTPs, authorization tokens and files are not persisted in browser storage; the user re-enters/reselects them.

## Executed validation

| Check | Result |
| --- | --- |
| Full backend regression: node --test --test-concurrency=4 tests/*.test.js | 410 passed, 0 failed, 15 skipped (425 total, final run) |
| Final OTP service + real local database integration | 19 passed, 0 failed; actual concurrent inserts, attempts, rolling resends, transactional rollback, legacy login and Registrar notifications |
| Migration/connection safety tests after final reuse guard | 9 passed, 0 failed |
| Frontend production build | Final build passed, VITE_EXIT_CODE=0; production assets regenerated from current source. Existing empty react-chunk warning remains non-fatal. |
| Changed frontend files targeted ESLint | Passed, exit 0, including final browser fixtures and cleanup |
| Whole-repository frontend ESLint | Recorded run: 126 errors / 11 warnings. Existing process imports in two affected browser tests were then fixed; unrelated files were not broadly refactored. This is not a clean repository-wide lint result. |
| Existing frontend regression suite | Full recorded run: 160 passed / 7 failed (167 total). Three membershipManagement.test.js failures concern unchanged membership query/validation/column expectations. Registration failures were corrected; targeted combined browser run finished with 6 passed / 1 earlier multipart-inspection fixture failure. Alumni/employer validation and employer multi-file/admin review passed; the remaining OTP fixture issue was corrected and verified by the separate 3/3 OTP run. Three membership failures remain unresolved in unchanged files. |
| New isolated OTP browser tests | 3 passed, 0 failed; process exited 0. Desktop final submission/paste/change Gmail/preserved upload, mobile/refresh and expired-code feedback |
| Local deployment configuration check | Correctly refused readiness: OTP secret, Brevo key, explicit database port and dedicated migration settings are absent; no secrets were generated or written |
| Production Aiven schema / Aiven staging migration | Not executed: secure access not supplied |
| Real Brevo inbox delivery; deployed Firebase-to-Render smoke tests | Not executed; provider calls mocked during tests |

Requested-scenario coverage (all mail delivery simulated unless stated):

| Scenario | Executed evidence |
| --- | --- |
| New Gmail; already registered; pending; rejected resubmission | Service tests plus real local pending/alias constraints and Registrar/history tests; existing rejected records remain for Registrar review |
| Correct / incorrect / malformed / expired OTP | Service tests; real database concurrent attempts; browser incorrect, successful and expired feedback |
| Resend / repeated initial requests / multiple resends | Service and real database tests for 60-second cooldown, three rolling resends and one initial email under concurrency |
| Concurrent duplicate final registrations | Actual local transactions, row locks and unique constraint; only one account/profile and consumption can commit |
| Gmail changed after verification | Service rejects mismatched delivery email/session/grant; browser clears verification and preserves original form/upload |
| Browser refresh | Browser recovers server authorization using only saved email/session; password and file selection are cleared |
| Provider failure (existing Brevo API) | Simulated failure/Retry-After invalidates code; no automatic resend, queue plaintext or provider fallback |
| Existing users without OTP fields | Additive migration preserves original fixtures and leaves timestamp NULL; legacy approved login succeeds |
| Registrar approval/rejection and notifications | Real local synthetic official-record matching/status/history; existing notification jobs inspected, no messages sent |
| Registration file uploads and mobile layout | Desktop multipart fields/document captured; existing multi-permit/admin-view regression passes; 390px OTP screenshot and 375px registration layout checks pass |

Final `git diff --check` passed. No dependencies were added.

To repeat local checks, run the backend test command above, then from frontend/alumni-portal run `npm run build` and `npm run test:registration-ui`. The opt-in database harness requires `RUN_OTP_DATABASE_TESTS=true` and refuses nonlocal or production targets; use only a local test account able to create fresh fixture databases. Never point that harness at Aiven.

Logs/artifacts are under `tmp/registration-otp-*`. Screenshots include `registration-otp-mobile.png` and `registration-otp-desktop.png`. Browser test startup required running the isolated headless tests outside the sandbox; it used new profiles and mocked APIs, not the user's browser session. The in-app Browser connection failed during setup, so no in-app browser verification is claimed.

## Render environment and migration permissions

Keep existing DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, JWT_SECRET, EMAIL_FROM, EMAIL_FROM_NAME and BREVO_API_KEY values. Existing Brevo uses its HTTPS API, not Gmail SMTP. Set EMAIL_PROVIDER=brevo if it is not already explicitly set. Add REGISTRATION_OTP_SECRET with at least 32 bytes of secure random material, kept stable across instances/deploys. Never use a VITE_ prefix for any secret.

Keep NODE_ENV=production and ENABLE_DB_SYNC unset/false. Configure TRUST_PROXY_HOPS for the actual trusted Render proxy chain; absent/mistaken settings can group clients under one IP or make IP limiting unsafe. CORS_ORIGINS must include the actual Firebase origin. Source configuration already allows https://djemc-alumni-portal.web.app with JSON/Authorization POST requests.

The one-off migration runner uses MIGRATION_DB_HOST, MIGRATION_DB_PORT, MIGRATION_DB_NAME, MIGRATION_DB_USER, MIGRATION_DB_PASS and optionally MIGRATION_DB_CA_FILE (or DB_CA_FILE). Apply mode never falls back to runtime credentials. Use a separate account limited to SELECT/schema inspection, the specific users ALTER/INDEX operations, CREATE for the new verification table and required REFERENCES permission. A read-only account is sufficient for check mode. Verify actual grants with the database administrator; do not put migration credentials on frontend or long-lived web/worker services.

Remote migration connections always verify TLS certificates. The existing runtime database connection retains its earlier SSL settings, including rejectUnauthorized=false; review its Aiven CA/certificate verification before production sign-off. This task did not silently replace those existing connection settings.

Check configuration names/presence safely with `node scripts/checkRegistrationOtpConfig.js`; it sends no mail and prints booleans, never secret values. Actual Render settings, sender verification and Aiven connectivity cannot be confirmed from this workspace.

## Staging and production commands

From backend/, after securely configuring the selected dedicated credentials:

```sh
# Read-only production/staging audit; no --apply
node scripts/applyRegistrationOtpMigration.js --environment staging --host <expected-host> --database <expected-database>

# Confirmed separate staging only
node scripts/applyRegistrationOtpMigration.js --apply --environment staging --host <staging-host> --database <staging-database>

# PRODUCTION: only after Aiven audit, backup, successful staging and explicit approval
node scripts/applyRegistrationOtpMigration.js --apply --environment production --production-approved --host <aiven-production-host> --database <production-database>
```

The production flag is an additional command guard, not a substitute for the user's approval. Do not run the complete historical migration directory. This specific command creates the OTP table when executed; merely generating this file does not modify a database.

Required sequence: inspect actual Aiven schemas/indexes and duplicate counts read-only; review any existing verification fields/tables for reuse; confirm an Aiven recovery point; run the exact migration and application checks on separate Aiven staging; review original-record preservation and locking; obtain explicit production migration/deployment approval; apply the additive production migration; deploy the reviewed backend to Render; deploy the frontend to Firebase; perform controlled OTP inbox, registration, pending-login, Registrar and upload smoke tests; monitor errors.

Existing accounts remain compatible with the additive schema while the prior backend is running. The new backend verifies the OTP schema and existing employer permit document field read-only before serving. If an older production schema lacks business_permit_documents or shared rate-limit indexes, review its separate migration first; the OTP command does not run unrelated repairs. Old cached registration pages will be required to refresh after OTP enforcement is deployed.

From frontend/alumni-portal/, with VITE_API_BASE_URL=https://djemc-alumni-backend.onrender.com/api:

```sh
npm ci
npm run build
# After deployment approval and Firebase project confirmation only:
firebase deploy --only hosting
```

## GitHub preparation and rollback

No commit/push was performed. From the repository root, review `git diff --check`, `git diff` and `git status --short`, then stage only the created/modified source, tests and reports listed above. Exclude credentials, certificates, tmp/, uploads and the pre-existing Firebase cache modification.

```sh
git switch -c feature/alumni-gmail-otp
git add <reviewed-source-test-and-report-paths>
git diff --cached --check
git diff --cached --stat
git commit -m "Add secure alumni Gmail OTP verification"
# Only when authorized; confirm this branch will not trigger an unapproved deployment:
git push -u origin feature/alumni-gmail-otp
```

Rollback restores the previously reviewed backend/frontend release while retaining email_verified_at, the generated email key/index and the verification table/history. No destructive down migration or database-wide restore is part of routine rollback. Check the prior backend's startup first: it previously auto-ran an unrelated employer migration and must not be allowed to mutate production unexpectedly. Retained canonical uniqueness remains enforced even with the prior app. Physical removal of new schema objects requires a separate reviewed authorization.

## Production readiness and remaining steps

Local security, migration and compatibility checks are implemented. Production release is not yet approved or verified. Required external work is the real Aiven read-only audit, duplicate resolution if necessary, dedicated migration permissions/TLS, Aiven staging execution, controlled Brevo delivery confirmation, verification of Render environment/proxy/CORS settings and explicit approval of the concrete migration and releases. Pending remote work must not be described as completed deployment.
