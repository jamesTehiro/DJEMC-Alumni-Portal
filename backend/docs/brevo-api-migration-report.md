# Brevo API migration report

Audit date: 20 October 2026, Asia/Manila. Repository evidence only: no production infrastructure, environment, database or recipient inbox was accessed or modified. Prior OTP work and the user's frontend edits are preserved.

## Executive summary and baseline

Before changes, the repository already centralized sends in `utils/email.js`. It supported Brevo HTTPS and Nodemailer SMTP, but inferred Brevo from the presence of a key. The local configuration audit selected SMTP; the Render SMTP settings in the request are user-reported and were not inspected remotely. No runtime Resend SDK, `RESEND_API_KEY` reference, Resend endpoint or alternate email adapter was found outside excluded environment files. No environment secrets were printed.

The inspected queue already used transactional claims, leases, finite attempts, explicit 429 retries, stale-message holds and safe errors. Transport work reuses that implementation, not a new queue. The repository queue model defines no provider-message-ID field; the production schema has not been inspected. No database migration is needed for this transport change; the separately prepared OTP migration remains subject to its existing staging/production approval requirements.

## Complete workflow inventory

`selected` below means the one configured provider (SMTP in the audited local process; deployed selection unverified). `helper queue` means existing createNotification -> enqueueEmails -> email_queue_jobs -> emailQueueWorker -> utils/email. All queued templates are plain text. OTP alone has an HTML alternative. The migration target for every existing email is explicit EMAIL_PROVIDER=brevo -> POST https://api.brevo.com/v3/smtp/email over HTTPS/443.

| Event | Trigger / source | Existing template / dynamic fields | Recipient | Channel | Current transport -> target |
| --- | --- | --- | --- | --- | --- |
| Gmail OTP / resend | auth registration-otp routes; services/registrationOtp.js | DJEMC Alumni Registration — Email Verification Code; six digits, five-minute expiry, fixed green/cream HTML and text | Exact validated Gmail/session address | Direct; plaintext OTP never queued | Brevo-only wrapper -> central Brevo API |
| Alumni / employer registration acknowledgment; pending approval email | authController.register | None implemented; browser success notice only | None | No email | None; preserved |
| Alumni approval | registrarController.approveAlumniUser | DJEMC Alumni Account Verified; existing verification text | Approved alumnus's saved email | In-app + helper queue | selected -> Brevo |
| Alumni rejection | registrarController.rejectAlumniUser (existing OTP work) | DJEMC Alumni Registration Not Approved; Registrar review/resubmission and preserved history | Rejected alumnus's saved email | In-app + helper queue | selected -> Brevo |
| Employer approval / rejection | adminController.updateEmployerUserStatus, pending decision transaction | Existing employer approval / additional-proof subjects; organization/name and rejection reason | Pending employer's saved email | Transactional queue; existing in-app notification | selected -> Brevo |
| Other account status transitions | updateAlumniUserStatus; employer suspended/deactivated branches | No email trigger | None | Existing status/audit behavior only | None; preserved |
| New job alert | jobController.createJob | New Job Opportunity; job title and organization; existing fallback wording | Verified alumni matching course; existing all-verified fallback if no match | In-app + helper queue after job transaction | selected -> Brevo |
| Job review | adminController.updateJobApprovalStatus | Job Post Review Update; title and review status | Posting employer | In-app + helper queue | selected -> Brevo |
| Job edits | jobController.updateJob | No separate email trigger | None | Existing update only | None; preserved |
| Job application submission / new applicant | applicationController submission handlers | No confirmation/new-applicant email implemented | None | Existing application records | None; preserved |
| Requirement revision | applicationController.reviewRequirement | Application Revision Required; requirement code and optional notes | Application's alumnus | In-app + helper queue | selected -> Brevo |
| Ordinary application approval / rejection | applicationController.reviewApplication | Existing job-title decision text | Applicant | In-app only, in decision transaction | None; preserved |
| Approval with interview invitation | applicationController.sendInterviewInvitation | Interview Invitation: job title; applicant, organization, venue/place/date/time/contact/what to bring | Saved applicant email | In-app + queue in same transaction; interview-invitation:<id> key | selected -> Brevo |
| Existing interview email retry | applicationController.retryInterviewInvitationEmail | Reuses the original queue record and template | Original recipient | Explicit authorized owner action; no new notification | selected -> Brevo; ambiguous outcomes require review |
| General / alumni-admin announcement | announcementController.createAnnouncement; adminController.createAlumniAnnouncement | New Announcement from DJEMC Admin; existing title text | Existing alumni/year/range selection | In-app + helper queue | selected -> Brevo |
| Alumni / employer warning | adminController.createAlumniWarning/createEmployerWarning | Admin Warning; existing message | Selected account with matching role | In-app + helper queue | selected -> Brevo |
| Alumni profile update request | adminController.requestAlumniProfileUpdate | Existing request subject and message | Selected alumnus, when email exists | In-app + transactional queue; alumni-profile-update:<id> key | selected -> Brevo |
| Password reset | authController.forgotPassword | Reset your password; role, existing reset link and 15-minute expiry | Matching saved alumni/employer address | Queue; generic public response preserved | selected -> Brevo |
| Membership submission / review | membershipController and membership services | No email producer exists | None | Existing membership/audit records only | None; preserved |
| Notification read/delete/profile response | notificationController | No email producer | Owner only | Existing in-app behavior | None; preserved |

## Audit scope and reusable components

Read `utils/email.js`, `emailDiagnostics.js`, `emailQueue.js`, `registrationOtpEmail.js`, `services/registrationOtp.js`, `models/EmailQueueJob.js`, notification model/controller, auth/registrar/admin/job/application/announcement/membership producers and services, their existing protected routes, `server.js` worker startup, queue migrations, package manifests, configuration check/audit scripts, email/queue/workflow/OTP tests, existing transport/notification reports and frontend email-status references. Repository searches identified one runtime Nodemailer import, one SMTP initialization and one sendMail call, all centralized in utils/email.js. Other occurrences are tests or historical diagnostic scripts/docs. No separate interview controller or jobs directory exists; interview email is in applicationController.

The archived investigate_email_notification.js and diagnose_notifications.js contain outdated conclusions and potentially sensitive diagnostics; they were inspected but not executed. Do not use them to prove production delivery. Current safe configuration/audit scripts are the supported diagnostics.

No current email attachment path exists: uploaded application/registration documents and generated PDFs use authenticated portal download routes, not email attachments. The adapter previously supported only to/subject/text and optional html. No attachment feature or additional recipients/triggers are introduced.

## Modified files

| File | Focused change |
| --- | --- |
| utils/email.js | Explicit provider selection; centralized sender/recipient/message validation; configurable bounded timeout; native fetch HTTPS with redirect refusal; safe classification of uncertain outcomes; lazy SMTP initialization |
| utils/emailDiagnostics.js | Safe receipt identifiers and outcome metadata; conservative reconciliation check for failed/legacy jobs |
| workers/emailQueueWorker.js | Capture accepted receipt IDs in safe job-linked logs, including accepted-send/state-write failure; preserve claim/retry/lease/state rules |
| controllers/applicationController.js | Existing authorized interview retry refuses uncertain outcomes; provider acceptance wording no longer claims inbox delivery |
| scripts/checkEmailConfig.js | Clarifies local verification versus API/inbox verification; still sends no email |
| tests/emailTransport.test.js | Explicit Brevo fixtures and valid recipients for the strengthened contract |
| tests/interviewInvitationWorkflow.test.js | Definite 429 failure fixture for existing safe manual retry |
| tests/registrationOtp.test.js | Actual OTP generation/resend through the central adapter to mocked Brevo; all prior protections remain tested |
| tests/brevoApiMigration.test.js (new) | Sender/recipient security, HTTP mapping, timeout, error classification, queue compatibility, receipts, state-write failure and no SMTP fallback |
| tests/brevoWorkflowTransport.test.js (new) | Actual producers -> existing queue -> worker -> central adapter -> mocked Brevo; decisions, targeting, templates, dedupe and uncertain retry guard |
| docs/brevo-transactional-email.md; docs/notification-implementation-report.md; this report | Current configuration guide, historical-report pointer, audit and release evidence |

Paths are relative to backend/. No frontend source, dependency/lock file, database model/migration, JWT, Cloudinary, Firebase or database configuration was changed in this task. Previous OTP, registration, upload and user-owned frontend/cache edits are retained.

## Transport architecture and security

Firebase frontend -> existing authenticated/limited Render business APIs -> existing database notification/outbox -> existing worker -> utils/email.js -> Brevo HTTPS -> recipient inbox. Registration OTP follows its existing direct path through utils/registrationOtpEmail.js to the same adapter, keeping plaintext OTPs out of the persistent queue. No new public email-sending endpoint, second queue, webhook or email event was added.

The existing sendEmail(to, subject, text, {html}) interface is retained. Validated plain mailbox strings and {email,name} arrays map to JSON to, while EMAIL_FROM/EMAIL_FROM_NAME alone control sender. Sender/recipient data is never taken from an arbitrary caller-supplied transport override. Delivery preserves the entered/saved mailbox, plus tags and local-part case; it does not canonicalize Gmail delivery recipients. OTP retains its own stricter normalization/session rules. Unknown recipient properties are excluded. Comma-separated envelope strings, display-address strings, CR/LF/NUL injection, malformed addresses and malformed subject/content are rejected before networking. Invalid historical recipient values remain in the queue for review; no address is guessed or replaced.

Native Node fetch POSTs to the fixed https://api.brevo.com/v3/smtp/email endpoint, authenticates through the api-key header, sends JSON and accepts JSON, matching the [Brevo transactional API reference](https://developers.brevo.com/reference/send-transac-email). It refuses redirects rather than forwarding credentials to a different endpoint. EMAIL_REQUEST_TIMEOUT_MS defaults to 15000; permitted integer range 1000–30000 stays within the existing worker lease budget. The same limit bounds SMTP connect/greeting timeouts if that provider is explicitly used; its existing 30-second socket timeout remains.

Existing plaintext templates remain plaintext, so names, titles, notes, reset links and reasons are not interpreted as HTML. The existing OTP HTML interpolates only server-generated digits; user-controlled message content was not added to HTML. Raw provider error bodies, recipients, API keys, SMTP credentials, OTPs, password/reset tokens and full message contents are not logged. Safe errors retain an allowlisted code, numeric HTTP/SMTP status and an optional deliveryUnknown flag. There is no automatic transport fallback.

The repository EmailQueueJob model has no mapped provider-message-ID field; actual Aiven schema remains uninspected. Accepted IDs are captured from API responses and included in bounded, validated structured logs with jobId, even if persisting acceptance fails. They are NOT stored in an invented last_error success value, and no new model column or migration is introduced. Durable receipt retention depends on approved log retention; a future database receipt field would require a separate additive schema review. API 201/valid messageId and queue sent/sent_at mean provider acceptance, never confirmed inbox arrival.

## Queue and retry compatibility

The same email_queue_jobs records, nullable unique dedupe keys, templates, schedules, max_attempts (default five), status enum and in-app notifications are reused. No pending/history rows were deleted, rewritten or bulk-requeued. Queue claims remain transactional, pending-only, attempt-consuming, FOR UPDATE/SKIP LOCKED and lease-fenced. Missing provider configuration pauses the worker before claiming rows or consuming attempts. Dedupe keys for employer decisions, profile updates and interview invitations are preserved; repeated employer/interview decisions remain guarded. Unkeyed shared-helper events retain their pre-existing dedupe limitations; global event deduplication was not redesigned.

| Outcome | Existing queue handling / final policy |
| --- | --- |
| Valid API acceptance | sent/sent_at, no retry; safe receipt linked to job in logs |
| 400/401/403 and other definite validation/auth rejection | Terminal failed, sanitized status; repair configuration/data before any explicit retry |
| HTTP 429 | Pending only while attempt budget remains; schedule after max(existing 30s backoff, Retry-After seconds/date) |
| Timeout, network failure, HTTP 408/5xx | Failed/unknown; automatic retries disabled to avoid duplicate delivery |
| Malformed or incomplete success response / missing ID | Unknown; do not assume the email was unsent |
| Provider accepted but database sent-state update failed | Leave processing for later stale hold; log receipt; never treat the state error as a fresh send failure |
| Stale processing/crash | Existing EMAIL_AMBIGUOUS hold, not automatic resend |
| Legacy missing/unstructured failure metadata | Retained; explicit interview retry returns 409 EMAIL_REVIEW_REQUIRED until administrator reconciliation |

Definite rejection/configuration/address failures retain the existing owner-authorized explicit interview retry behavior, including resetting that job's attempt budget. Automated retries remain bounded; repeated deliberate manual retries remain an existing operator action. No new user-controlled reconciliation override is accepted. The new guard changes only uncertain failed-job retry behavior, which previously allowed duplicate messages after timeouts. Its compare-and-set also checks the reviewed attempt count and exact last_error so a concurrent newer failure cannot be reset using stale evidence. Existing routes, ownership and role checks are unchanged.

### Reconciliation procedure

1. Identify the queue job privately by jobId; preserve its current payload/history. Use its structured acceptance/state-error receipt if available. Do not dump message bodies or queue rows into logs.
2. Review Brevo transactional logs by receipt, or by the privately reviewed recipient/time if the request returned no ID. Acceptance alone is not inbox delivery; look separately for delivered, bounced, deferred or blocked events.
3. If accepted, do not resend. A reviewed operator correction of the specific queue state may be appropriate only under existing production-data approval rules; no automatic correction script or public endpoint is added.
4. Requeue only after determining the original request was not accepted and correcting the underlying problem, under a separately reviewed authorization. Legacy/unknown errors remain held when evidence is insufficient. No timeout/5xx blind resend is offered.

This favors avoiding duplicates over automatic eventual delivery in uncertain cases. It cannot guarantee exactly-once delivery or automatically reconcile a provider acceptance lost before the receipt reached the server. Brevo batch idempotency is not assumed for these existing single-message requests; the queue was not converted to batch sends.

## Exact Render environment migration checklist

Apply this checklist to separate staging first. Do not change production environment values or deploy as part of this local implementation.

| Variable | Approved target action |
| --- | --- |
| EMAIL_PROVIDER | Set explicitly to brevo; merely adding a key no longer changes provider |
| BREVO_API_KEY | Add a secret REST API key authorized for transactional mail, not the SMTP password; server/worker only |
| EMAIL_FROM | Reuse the existing single sender email and verify it in Brevo; no hardcoded sender address |
| EMAIL_FROM_NAME | DJEMC Alumni Tracking and Job Portal |
| EMAIL_REQUEST_TIMEOUT_MS | Optional 15000 default; integer 1000–30000 |
| SMTP_HOST, SMTP_PORT, SMTP_SECURE, EMAIL_USER (or legacy EMAIL), EMAIL_PASS | Preserve unchanged until the verified migration/rollback plan is approved; ignored when Brevo is selected |
| RESEND_API_KEY | No repository runtime dependency found; leave unchanged during rollout. Confirm other services/dashboard use before separately approving removal |
| EMAIL_WORKER_ENABLED | Preserve existing topology: embedded worker defaults enabled. Set false only if a separately approved worker actually runs |
| EMAIL_QUEUE_* settings | Preserve existing values; backoff, polling, concurrency, batch and lease budgets remain unchanged |
| REGISTRATION_OTP_SECRET | Preserve the existing server-only value across web instances/restarts; prerequisite from the OTP implementation |
| DB_*, JWT_*, Cloudinary, Puppeteer, Firebase, frontend VITE_* | No changes for this transport task; never add a Brevo secret under VITE_* |

BREVO_API_KEY, EMAIL_FROM and EMAIL_FROM_NAME must be present and syntactically valid when Brevo is selected; errors are clear EMAIL_CONFIG failures, not fallback. Configuration diagnostics output presence booleans and nonsecret settings only. The actual Render configuration, sender verification, API account/quotas and log access remain unverified.

An existing deployment relying on the old key-presence auto-selection must receive explicit EMAIL_PROVIDER=brevo during the approved rollout. Deploying only the source without that setting would retain SMTP. The current local audit found SMTP configuration, no local Brevo key/name; local SMTP readiness is not evidence of Brevo readiness.

## Automated validation evidence

All HTTP requests in tests are mocked. New workflow fixtures refuse unexpected real SQL. The full backend suite keeps destructive/live database tests behind their existing opt-in flags; those flags were not enabled for this task. No live email or production database test was run.

| Check | Result |
| --- | --- |
| Before-change focused email/queue/workflow baseline | 23 passed, 0 failed |
| Focused adapter/worker/interview/OTP check at implementation checkpoint | 50 passed, 0 failed |
| New producer -> queue -> Brevo workflow suite | 6 passed, 0 failed |
| Final complete backend suite | 428 passed, 0 failed, 15 skipped (443 total); includes final retry compare-and-set guard |
| Final focused email and OTP suites | 73 passed, 0 failed; includes the concurrent newer-failure retry guard |
| Relevant frontend job/application/registration tests | 44 passed, 0 failed |
| Frontend production build | Passed, VITE_EXIT_CODE=0; existing empty react-chunk warning is non-fatal |
| OTP browser regression | 3 passed, 0 failed; desktop submission/uploads/change Gmail, mobile refresh and expired feedback; mocked external APIs |
| Live Brevo authentication, sender acceptance, logs and inbox receipt | Pending approved test environment/credentials and authorized addresses |

Static checks: git diff --check passed; no Brevo/Resend credential or transport references were found in frontend source or built assets. The safe local configuration check passed for the retained SMTP configuration only; this is not a Brevo readiness claim.

Evidence logs use tmp/brevo-api-*.log. Earlier frontend testing in this session found three unrelated membershipManagement.test.js failures and repository-wide lint failures in unchanged files; this task does not broadly repair membership or frontend code. No newly introduced failures were found in the executed checks. The 15 opt-in database/live-fixture tests stayed skipped. A full frontend suite/lint rerun is not claimed; the 44 relevant tests, three OTP browser tests and production build passed.

Repeat the complete backend run from backend/ with:

```sh
node --test --test-concurrency=4 tests/*.test.js
```

The focused run included emailTransport, brevoApiMigration, brevoWorkflowTransport,
registrationOtp, registrationOtpApi, emailWorkerSafety, emailQueueWorkerRecovery,
emailQueueDeduplication, notificationWorkflows, interviewInvitationWorkflow,
notificationAudit and notificationInterviewDetails (all in tests/, .test.js).
Do not enable the live/destructive database integration flags against production.

Repeat relevant frontend checks from frontend/alumni-portal/:

```sh
node --test tests/jobApplicationSubmission.test.js tests/jobPosting.test.js tests/jobDisplay.test.js tests/feedJobActions.test.js tests/registrationValidation.test.js
npm run build
npm run test:registration-ui
```

Use npm.cmd from Windows PowerShell if its execution policy blocks npm.ps1. The
browser script uses a fresh test profile and mocks/blocks external APIs; it does
not send live email or create real accounts. It needs an installed Chromium/Edge
binary and a current build.

## Deployment readiness and Render Free constraints

The HTTPS path avoids Render Free's blocked SMTP ports 25/465/587. However, Render Free web services spin down after 15 minutes without inbound traffic, can restart, and do not offer Free standalone background workers, shell access or one-off jobs. An embedded child worker does not make sleeping web compute always-on; scheduled/backoff mail can wait until the web service wakes. Aiven persists the queue across these restarts, while uncertain in-flight deliveries are held for review. Cold starts can delay the initial OTP request, and an expired code is never automatically accepted.

These limits are verified in [Render's current Free documentation](https://render.com/docs/free). The smallest reliable always-on option is an approved paid instance for the existing web/embedded-worker process. Alternatively, approve a paid instance of the existing worker with EMAIL_WORKER_ENABLED=false on the web process. Neither change was made. Do not introduce public wakeup/mail endpoints or an unapproved scheduler to conceal the limitation.

Use Node >=22.12.0 as already declared. Existing server startup launches the worker after database readiness. The transport introduces no DDL or Sequelize sync, and the current read-only readiness checks remain. Actual Aiven queue columns, InnoDB/unique dedupe indexes and row-lock support must be verified using existing guarded read-only tooling before release; do not run historical migrations automatically. The prior OTP schema migration is separate and still must pass Aiven staging before production approval.

Before a provider switch, coordinate graceful shutdown/drain of the existing worker, preserve pending rows, and inspect any remaining processing/unknown rows after restart. Configure every active worker and the web process consistently; do not leave an old SMTP worker and a new Brevo worker with different deployment settings. The embedded worker inherits the web environment, while a separately configured worker needs the same reviewed provider variables.

### Approved staging/release sequence

1. Review the source diff and this report. Confirm separate staging database, controlled test accounts and sender verification. Prevent staging recipients from resolving to real alumni/employers; no bulk replay of production pending jobs.
2. Set the target variables only in approved staging. Preserve previous SMTP/Resend settings. Run the backend regression suite locally/CI with mocked HTTP; validate frontend assets normally. No dependency installation/change is required by the transport itself.
3. On a trusted workstation/CI with staging configuration, run `node scripts/checkEmailConfig.js` and optionally `--verify`. For Brevo this validates local settings only and sends no email; it does not authenticate against the API. Render Free does not provide a dashboard shell, so do not assume these commands can be run there interactively.
4. Run the existing guarded configuration/schema audit where authorized: `node scripts/auditNotificationConfig.js --schema --host <expected-staging-host> --database <expected-staging-database>`. It is read-only; never print credentials. Confirm the OTP readiness separately. Existing runtime database TLS settings are outside this transport change and require their prior security review.
5. After staging deployment approval, deploy the reviewed backend and verify one worker is intended, its configuration shows brevo/configured, and no SMTP connection is attempted. Firebase/API routes and JSON response shapes remain compatible; the existing interview retry may now return the documented 409 review response.
6. With explicit test-recipient authorization, send one test OTP/resend and controlled approval, rejection, job-alert and invitation emails through the existing workflows. Record API acceptance/message ID, Brevo logs and actual inbox arrival separately. Check retry limits, in-app notifications, status history and no duplicate event generation. No arbitrary send endpoint was added for testing.
7. Review staging evidence, queue holds, cold-start/worker behavior and rollback plan. Obtain explicit production environment/deployment approval before changing Render or Aiven. Production changes were not performed.
8. After approval, configure the reviewed target variables and deploy the backend through the existing process. Do not run a transport database migration: there is none. No Firebase deployment is required for this backend-only change; a separately approved frontend release may include the earlier OTP work.

No commit, push, Render deployment, Firebase deployment, production environment update, production migration or recipient test send was executed.

## Rollback

Preserve all queue and notification history, statuses, payloads, dedupe keys and any acceptance receipts/logs. Roll back to a reviewed prior Brevo-capable backend that retains the completed OTP protections and safe worker claims/ambiguous holds; keep explicit EMAIL_PROVIDER=brevo and the verified sender/key. Do not restore a worker version that blindly retries stale/permanent failures or run an older startup migration unintentionally. Unknown jobs remain held pending provider-log reconciliation; never bulk-reset failed/processing records.

The SMTP code/dependency and original environment variables are retained for an explicitly approved transport rollback in an environment where SMTP works. Render Free blocks those ports, and the existing registration OTP wrapper intentionally requires Brevo, so switching that deployment to SMTP cannot be presented as a working full-feature rollback. Never bypass Gmail verification to compensate. Keep the prior reviewed Brevo-capable release available instead. No database rollback is needed for this transport-only task; no schema or production records were changed. If the separate OTP migration is later approved/applied, retain its additive schema per its existing rollback instructions.

## Final workflow validation table

| Workflow | Brevo API Integrated | Tests Passed | Live Delivery Verified |
| --- | --- | --- | --- |
| Gmail OTP and resend | Yes, existing direct wrapper -> central adapter | Mocked HTTP plus all OTP policy/atomic-consumption regression checks | Pending |
| Registrar alumni approval / rejection | Yes, existing queue | Actual producers -> queue -> mocked Brevo | Pending |
| Employer approval / rejection | Yes, existing transactional queue/dedupe | Actual producers -> queue -> mocked Brevo; repeated decisions guarded | Pending |
| New job alerts | Yes | Actual producer/targeting -> queue -> mocked Brevo | Pending |
| Job review updates / administrative warnings / announcements | Yes | Existing producer regressions; warnings/announcement through mocked HTTP | Pending |
| Application requirement revision | Yes | Actual producer -> queue -> mocked Brevo; literal plain text preserved | Pending |
| Interview approval/invitation and safe retry | Yes | Actual producer -> queue -> mocked Brevo; unknown retry held, known rejection retry allowed | Pending |
| Profile update request / password reset | Yes, existing queue | Existing template, recipient, transaction and queue regression tests | Pending |
| Registration acknowledgment / pending email | Not implemented; unchanged | Existing registration checks; no new trigger | N/A |
| Application submission/new-applicant/ordinary approval/rejection emails | Not implemented; existing decisions are in-app only | Existing application workflow regressions | N/A |
| Membership emails | No existing email trigger; unchanged | Existing membership backend regressions | N/A |

## Remaining risks and status

Actual Aiven schema/staging and actual Render settings remain unverified. Live REST key authorization, sender verification, quota and inbox delivery require approved controlled testing. Durable message-ID retention is via logs, not the current database schema. Legacy malformed addresses and unknown failed deliveries are held rather than guessed/replayed. Plaintext queue payloads remain sensitive existing data and must retain appropriate database access controls. Render Free cannot guarantee an always-on queue lifecycle, and provider acceptance never guarantees inbox receipt. No claim of production readiness or exactly-once delivery is made.

Local implementation, complete backend regression, targeted email/OTP checks, relevant frontend tests and production assets pass. The existing queue and notification events remain intact, with no transport database migration required. The next step is controlled staging configuration and live delivery validation; production environment changes, deployments, infrastructure changes and prior OTP production migrations remain outside this authorization.

**READY FOR STAGING**
