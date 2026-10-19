# Notification implementation baseline audit

Date: 2026-10-19 (Asia/Manila). This baseline was written before implementation
changes for this task. Findings describe repository code, not verified live Render
settings or Brevo delivery. No production connection, email send or migration was
performed. Pre-existing registration and Firebase cache edits are outside scope.

## Architecture and entry points

`controllers/notificationController.createNotification({userIds,message,subject,
type,interview_id})` deduplicates user IDs, bulk-inserts `notifications`, looks up
the users' email addresses and calls `utils/emailQueue.enqueueEmails`. That helper
bulk-inserts pending `email_queue_jobs`; it swallows failures unless supplied a
transaction. The notification helper also catches errors and returns an empty
array, so business actions may succeed with only partial notification delivery.
Most notifications use plain text; no HTML templates are currently sent.

Three transactional paths bypass the general notification helper: profile-update
requests, employer registration decisions, and interview invitations. They create
queue entries with stable event dedupe keys. Application decisions directly create
in-app notifications without email. Password reset directly enqueues an email.
There are no other production `sendEmail` call sites outside the queue worker.

`models/Notification.js` maps `notifications`: userId, type, interview_id, message,
isRead, timestamps. User and Interview associations live in `models/index.js`.
`models/EmailQueueJob.js` maps `email_queue_jobs`: recipient (`to`), subject,
message, nullable unique dedupe_key, status (pending/processing/sent/failed),
attempts, max_attempts (5), scheduled_at, processing_started_at, sent_at,
last_error and timestamps. Payloads include private messages and reset links;
queue contents must not be dumped into logs.

## Trigger and channel inventory

| Trigger / source function | Recipient | In-app | Email / queue |
| --- | --- | --- | --- |
| Password reset, `authController.forgotPassword` / POST `/api/auth/forgot-password` | Matching account for requested role | No | Queued reset URL, 15-minute expiry; generic HTTP response |
| Initial alumni/employer/admin registration, `authController` | None notified by registration code | No | No welcome/registration-confirmation email wired |
| Alumni approval, `registrarController.approveAlumniUser` | Approved alumnus | Yes | Shared helper, queued |
| Registrar rejection, `rejectAlumniUser` | Rejected alumnus | No notification call | No email call |
| Alumni admin account-status changes, `adminController.updateAlumniUserStatus` | Changed account | No notification call | No email call |
| Pending employer approved/rejected, `adminController.updateEmployerUserStatus` | Employer | Yes, after commit | Queued in decision transaction; `employer-verification:<user>:<status>` |
| Employer suspension/reactivation/deactivation branch | Employer | No notification call | No email call |
| Job created, `jobController.createJob` | Verified alumni matching exact course; if none match, all verified alumni | Yes, job_posting | Shared helper, queued; existing fallback preserved |
| Job review status, `adminController.updateJobApprovalStatus` | Posting employer | Yes | Shared helper, queued |
| Application submission, normal `applicationController` create path | No notification call | No | No email to employer/applicant wired |
| Requirement revision, `reviewRequirement` | Applicant | Yes, application | Shared helper, queued |
| Application approved/declined, `reviewApplication` | Applicant | Yes, transaction | In-app only; do not add email implicitly |
| Interview invitation, application controller invitation handler | Applicant | Yes, interview_id, transaction | Queued in transaction; `interview-invitation:<interview>` |
| Announcement, `announcementController.createAnnouncement` | Alumni, optionally graduation-year/range targeted | Yes | Shared helper, queued |
| Alumni admin announcement, `adminController.createAlumniAnnouncement` | Same year/range targeting | Yes | Shared helper, queued |
| Admin alumni/employer warning, `createAlumniWarning/createEmployerWarning` | Selected account of matching role | Yes, warning | Shared helper, queued |
| Profile update request, `requestAlumniProfileUpdate` | Selected alumnus | Yes, profile_update_request | Queued if email exists; `alumni-profile-update:<request>`; transaction, cooldown and active-request protections |
| Read profile-update notification | Owner alumnus | Mark read; linked request responded plus audit | No email |

Admin triggers are protected by `routes/adminRoutes.js` role and scope middleware;
registrar, job, application, announcement and auth routes retain their existing
authorization/rate limits. Interview handling is in `applicationController.js`,
not a separate interview controller. No dormant HTML template sender, external
cron definition or separate email transport implementation was discovered.

## Existing provider and SMTP inventory

`utils/email.js` is the centralized adapter. Explicit EMAIL_PROVIDER accepts
brevo/smtp; otherwise presence of BREVO_API_KEY selects Brevo, else SMTP. There is
no fallback after a failed send. Brevo already uses native Node fetch to POST
`https://api.brevo.com/v3/smtp/email`, authenticating with the api-key header and
mapping sender, recipients, subject and textContent. It requires BREVO_API_KEY,
EMAIL_FROM, EMAIL_FROM_NAME, validates a returned messageId, and uses a 15-second
request timeout. HTML is unsupported by the three-argument function. All Brevo
HTTP failures, including 429/5xx, have retryable=false; network/timeouts likewise.

SMTP uses Nodemailer, SMTP_HOST (default smtp.gmail.com), SMTP_PORT (465),
SMTP_SECURE, EMAIL_USER or legacy EMAIL, EMAIL_PASS, and optional EMAIL_FROM.
Port 587 requires STARTTLS (`requireTLS`) and secure=false; 465 uses implicit TLS.
Transport is cached by settings and credentials; connect/greeting timeouts are
15 seconds and socket timeout is 30 seconds. Raw SMTP errors have no normalized
retryability. `utils/emailDiagnostics.safeEmailError` whitelists mail codes and
numeric responseCode. `scripts/checkEmailConfig.js --verify` performs SMTP verify
but only local configuration validation for Brevo: it does not verify the API key
or sender with Brevo and sends no email.

Other SMTP-related components: nodemailer in package.json/lockfile;
`tests/emailTransport.test.js`, `tests/verificationEmailFlow.test.js`;
`docs/render-gmail-smtp.md`, `docs/brevo-transactional-email.md`;
`diagnose_notifications.js`, `investigate_email_notification.js`. The older
investigation scripts print recipients/content or raw database errors and contain
hardcoded conclusions contradicted by current code; they are unsuitable for
production diagnostics. Do not execute them as an audit or send test.
Historical SMTP references also occur in `docs/structured-job-posting.md` and
`docs/production-schema-audit.md`; they describe prior work and are not evidence
of the currently selected production provider.

No .env values are reproduced. Render environment settings, sender verification,
Brevo account permissions/quotas and deployed secrets are unverified. Setting only
the Brevo key selects Brevo automatically unless EMAIL_PROVIDER explicitly selects
SMTP; sender email and name must also be present in the worker environment.

## Existing worker lifecycle, retries and confirmed defects

`server.js.startEmailWorker` unconditionally forks `workers/emailQueueWorker.js`
after database readiness, inherits environment/stdio and restarts the child after
5 seconds on exit. Thus `npm start` already starts a worker. `npm run email-worker`
also starts it independently. No Render blueprint/Procfile is present; dashboard
start commands/active processes cannot be verified from checkout. A separately
configured worker alongside web startup would add another processor.

The worker authenticates MySQL, validates mail configuration before claiming jobs,
and pauses without consuming attempts on missing configuration. It polls after
each completed batch (2 seconds default), claims up to 20 jobs transactionally
using FOR UPDATE/SKIP LOCKED and processes slices of 5 concurrently. Reservation
accepts pending OR failed rows with attempts < max_attempts, plus processing rows
older than 5 minutes; it sets processing_started_at but does not consume attempts.
Failure increments attempts and uses fixed 30-second backoff while retryable;
success sets sent_at/status=sent. `sent` means provider accepted, not inbox delivery.

Confirmed defects/risks:

1. Terminal/permanent failures are immediately eligible again because reservation
   includes failed rows with remaining attempts, contradicting retryable=false.
2. A crash after acceptance/before sent persistence can resend the same email.
   Repeated crashes do not consume attempts; stale recovery can repeat forever.
3. Sent-state database errors are caught as delivery failures, potentially
   scheduling another email already accepted by the provider.
4. Status writes are unfenced instance updates: a late worker can overwrite the
   state after another worker reclaimed the row.
5. Zero/invalid queue concurrency or batch/interval settings are unvalidated;
   zero concurrency can hang batch processing.
6. Promise.allSettled outcomes are not inspected, hiding status-persistence errors.
7. Brevo rate-limit responses receive no Retry-After-aware handling. Queue-level
   retry code currently defeats even the adapter's conservative no-retry policy.
8. General notification + queue writes are non-atomic and email enqueue errors
   are swallowed. Failed writes can leave only one channel persisted.
9. Most shared-helper calls have no event identity/dedupe key; repeating a
   business action can create another notification/email. Existing three keyed
   transaction paths and nullable unique key do not solve all event duplication.
10. Notification controller logs/returns raw error messages, which can expose
    SQL/content. Old diagnostics and documentation overstate verified delivery.

## Schema and production checks

`20260413-create-email-queue-and-rate-limit-tables.js` creates an older queue
shape using available_at/reserved_at and no max_attempts/dedupe_key. The current
model uses scheduled_at/processing_started_at/max_attempts/dedupe_key. The
`20261016-repair-email-queue-dedupe-key.js` migration guards/adds the nullable unique
key but does not itself reconcile every old field. `server.js` auto-sync is
disabled in production; runtime model code is not proof of deployed columns.
No production schema inspection or migration has been run for this audit. MySQL
transactional storage and actual row-lock/SKIP LOCKED support require verification.
`config/database.js` is the shared MySQL connection; process environment overrides
the local .env. Production TLS currently disables certificate verification; that
existing database concern is outside this email transport change.

## Frontend

Authenticated GET `/api/notifications` lists the current user's records and joined
Interview data. PUT `/read/:id`, DELETE `/:id`, GET `/:id/interview` enforce owner
checks. `NotificationPage.jsx` loads on mount, computes unread count locally,
marks read, supports undo deletion, and fetches interview details on demand;
profile-update notifications open the profile. `Alumnipage.jsx` fetches unread
counts; `EmployerPage.jsx` loads/filter warnings and displays unread warning count.
These interfaces do not expose provider delivery history or queue status. Existing
UI text implies emails are sent universally, although some events are in-app only
and queued mail can fail. No notification UI redesign is part of this task.

## Tests before changes

`emailTransport.test.js`: SMTP config/cache/TLS, auto Brevo selection/text mapping,
safe auth/network/timeouts/malformed responses. No HTML, explicit SMTP-over-Brevo,
Retry-After or queue-to-provider HTTP flow tests.
`emailQueueWorkerRecovery.test.js`: missing settings pause and stale selection,
but not terminal-failure exclusion, fencing, finite crash budget or sent-state DB
failure. `emailQueueDeduplication.test.js`: nullable keys/transaction/duplicate
propagation and an in-memory retry test. `emailQueueDedupeMigration.test.js`:
guarded additive key migration. `notificationInterviewDetails.test.js`: detail
and ownership. Feature tests cover targeting, profile updates, employer decisions,
application decisions and interview invitations; most isolate controller boundaries.
`verificationEmailFlow.test.js` requires *_test DB and explicit opt-in, but its
missing-SMTP-credentials case does not force SMTP and can reach real Brevo
transport if a key exists. Broad cleanup is unsuitable for the working database.
Do not enable it as a real-send production check.

Planned focused changes: retain existing provider selection and event semantics;
normalize provider failures and 429 backoff; fix terminal selection, crash handling,
lease fencing and status-error visibility; validate worker settings; preserve
history and avoid uncertain automatic resends; add mocked end-to-end/feature tests;
document current startup and configuration, plus safe deployment verification.
No exactly-once guarantee or live sender verification is implied.

Local environment evidence at audit time (presence only, not production): the
local .env had SMTP host/port/user/password and EMAIL_FROM; it had no BREVO_API_KEY,
EMAIL_PROVIDER or EMAIL_FROM_NAME. Its sender did not match the requested sender.
These local findings neither confirm nor contradict the separately configured
Render key. No environment values or files were changed.
