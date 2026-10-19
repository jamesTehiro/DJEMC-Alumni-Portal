# DJEMC Alumni Portal notification implementation report

Date: 2026-10-19, Asia/Manila. Scope: repository audit, focused backend fixes,
mocked provider tests, local schema metadata and isolated temporary-table MySQL
tests. No real email was sent, production environment changed, production data
modified, production migration executed, deployment performed or commit created.
Pre-existing registration-page and Firebase cache edits were preserved.

## A. Executive summary

The portal already had a centralized Brevo HTTPS adapter and an SMTP compatibility
adapter, a MySQL queue, in-app notifications and an embedded worker started by the
web server. Adding a Brevo key alone did not prove that the sender, queue schema,
deployed worker or delivery was working. The principal defects were queue state
handling and partial notification persistence, rather than lack of an HTTP sender.

The update preserves current templates, subjects, recipients, routes and intended
delivery channels. It makes shared in-app/email creation transactional, honors
explicit provider retry decisions and rate-limit delays, consumes attempt budgets
on reservation, prevents expired lease writes, holds uncertain deliveries for
review, and separates provider acceptance from sent-state database failure.
Brevo remains the selected HTTPS transport when configured; SMTP remains an
explicit option. There is no fallback after a send failure and no exactly-once
delivery claim. No schema change was introduced by these fixes.

## B. Existing implementation and baseline

The [baseline audit](notification-implementation-audit.md) was created before
implementation changes and lists the original code, tables, every trigger, frontend
behavior, configuration, tests and defects. Important paths:

- `controllers/notificationController.js`: shared fan-out and authenticated list,
  detail, read and delete handlers.
- `utils/emailQueue.js`: queued recipients/content; transactional callers propagate
  failures, while password-reset best-effort callers retain their generic response.
- `utils/email.js`: only production sender, called by the worker; native fetch for
  Brevo, Nodemailer for SMTP. No additional dependency was needed.
- `workers/emailQueueWorker.js`: transactional claiming, delivery and state changes.
- `server.js`: forks/restarts the worker; `package.json` has `start` and
  `email-worker` commands and Node >=22.12.0.
- `models/Notification.js` / `notifications`, `models/EmailQueueJob.js` /
  `email_queue_jobs`, and model associations in `models/index.js`.
- Frontend `NotificationPage.jsx`, `Alumnipage.jsx`, `EmployerPage.jsx`: existing
  list/read/delete/interview/profile links and unread counts. Employer dashboard
  intentionally filters warnings; it does not display every notification type.

Notification HTTP routes remain GET `/api/notifications`, GET
`/api/notifications/:id/interview`, PUT `/api/notifications/read/:id`, DELETE
`/api/notifications/:id`. Existing authentication and ownership checks remain.
No email provider secret belongs in Firebase/Vite configuration.

## C. Problems discovered and disposition

| Confirmed issue | Disposition |
| --- | --- |
| Permanent Brevo failures were selected again as `failed` rows with remaining attempts | Only pending rows are dispatchable; failed is terminal until an explicit reviewed retry |
| Stale jobs could resend indefinitely without consuming attempts | Reservation consumes an attempt; stale processing is failed/EMAIL_AMBIGUOUS for review |
| DB failure after provider acceptance could schedule another send | Sent-state writes are outside the send-error catch; leave uncertain processing state and log EMAIL_STATE |
| Late worker could overwrite a reclaimed state | Dispatch checks lease ownership; writes condition on id, processing status, attempt and timestamp |
| Invalid concurrency/interval could hang/spin | Positive integer and batch-timeout lease validation before connecting |
| allSettled rejections were ignored | Every rejected state operation is logged with sanitized codes |
| 429 could not use Retry-After | Explicit rejection retries through the existing queue, with a delay at least the configured base or provider delay |
| Shared notification and email enqueue were non-atomic | Both writes now share one transaction; failed enqueue rolls back the notification fan-out |
| Notification errors could disclose SQL/message data | Generic safe HTTP errors and sanitized operation/code logs |
| Separate worker could run alongside unconditional web worker | EMAIL_WORKER_ENABLED=false disables embedded startup; default preserves existing behavior |
| Documentation claimed Gmail sender verification | Corrected: sender verification/acceptance remains a manual Brevo requirement |
| Old investigation scripts print recipients/content and hardcoded outdated conclusions | Documented as unsafe/obsolete; not executed; use the new metadata-only audit |

Remaining limitations are listed in J. A general business-event idempotency key was
not invented: most shared helper events can still produce another notification
if the underlying business action itself is repeated. Existing event-specific
dedupe keys and business authorization were preserved.

## D. Files changed and reasons

| File under backend/ | Specific change |
| --- | --- |
| `utils/email.js` | Preserve explicit/automatic provider selection; trim automatic key detection; optional fourth `{html}` argument; 429 retry classification/Retry-After; normalized safe SMTP errors; retain existing three-argument text callers |
| `utils/emailDiagnostics.js` | Recognize safe database/state/ambiguity codes without retaining raw errors, recipients, headers or content |
| `utils/emailQueue.js` | Remove verbose debug logging; return bulk-create result; preserve transaction options, nullable keys and transactional error propagation |
| `controllers/notificationController.js` | Transactional shared notification/queue creation; safe error reporting; existing response shapes and owner checks retained |
| `workers/emailQueueWorker.js` | Pending-only finite reservations, stale/unknown holds, attempt counting, conditional lease writes, provider-aware retry delays, separate acceptance-persistence handling, inspected settlement errors, validated limits, graceful signal/disconnect handling |
| `server.js` | Explicit switch to disable embedded worker when a separate worker is used |
| `scripts/auditNotificationConfig.js` (new) | Configuration-only default; optional read-only schema/type/index/engine audit requiring host and database assertions; reports installed dialect locking capability; no email or queue mutations |
| `tests/emailTransport.test.js` | Explicit Brevo/SMTP precedence, HTML/text/named recipients, rate limits/date delays, permanent/ambiguous HTTP and SMTP classifications |
| `tests/emailQueueWorkerRecovery.test.js` | Replace obsolete resend expectation with strong stale-hold/pending-only/attempt-consumption and lock assertions; retain missing-config pause coverage |
| `tests/emailQueueDeduplication.test.js` | Exercise existing dedupe invariant with consumed attempts, lease-conditional state writes and explicit safe retryability |
| `tests/verificationEmailFlow.test.js` | Force SMTP in missing-credentials test so an opt-in test cannot accidentally select a real Brevo sender |
| `tests/emailWorkerSafety.test.js` (new) | Lease ownership, retry delay/budget, terminal errors, post-acceptance DB failure, invalid worker settings |
| `tests/notificationPipeline.integration.test.js` (new) | Actual local MySQL temporary-table transaction/reservation/state flow with mocked HTTPS only; no application-record writes |
| `tests/notificationWorkflows.test.js` (new) | Real controller/helper/queue flow with isolated DB boundaries for resets, approval, warnings, job review, targeting and safe errors |
| `tests/notificationAudit.test.js` (new) | Read-only audit rejects missing/case/type/index/engine differences |
| `docs/brevo-transactional-email.md` | Correct retry, sender verification, worker and diagnostics instructions |
| `docs/notification-implementation-audit.md` (new) | Pre-change baseline |
| `docs/notification-implementation-report.md` (new) | This report and deployment/rollback instructions |

No notification frontend, model, package dependency, environment file or migration
was changed. No existing tests were deleted or assertions weakened; obsolete
worker expectations were replaced by the required safer behavior.

## E. Notification coverage matrix

“Queued” means the event persists work for the worker, not synchronous sending or
confirmed inbox delivery. Source-only findings are distinguished from tests.

| Event / trigger | Recipient | In-app | Email | Queue | Verification |
| --- | --- | --- | --- | --- | --- |
| Initial registration (alumni/employer/admin) | None | No | No welcome/confirmation email wired | No | Source audit; existing registration regressions |
| Password reset POST `/api/auth/forgot-password` | Matching alumni/employer account | No | Existing 15-minute reset link | Yes | notificationWorkflows; security; token hash, recipients and generic unmatched response |
| Registrar alumni approval | Approved alumnus | Yes | Existing approval subject/body | Yes | notificationWorkflows; legacy isolated DB cases skipped by default |
| Registrar rejection / alumni admin status | None notified by these handlers | No | Not wired | No | Source audit; intentionally not expanded |
| Pending employer decision PUT `/api/admin/employer/users/:userId/status` | Employer | Yes | Existing approval/rejection template | Yes, transaction/dedupe key | employerPermitWorkflow; verificationEmailFlow isolated cases skipped |
| Other employer account status transitions | None notified in that branch | No | Not wired | No | Source audit |
| Job creation POST `/api/jobs`, admin employer jobs | Verified course-matching alumni, existing all-verified fallback | Yes | Existing job message | Yes | jobPosting; generic pipeline/MySQL tests |
| Job review PUT `/api/admin/employer/jobs/:jobId/approval` | Employer owner | Yes | Existing job review subject | Yes | notificationWorkflows |
| Application submission | No notification recipient wired | No | Not wired | No | Source audit; existing application regressions |
| Requirement revision | Applicant | Yes | Existing revision message | Yes | Source trace; generic helper integration; application regression suite |
| Application approval/decline PUT `/api/applications/:id/review` | Applicant | Yes | In-app only | No | applicationDecision / application regression tests |
| Interview POST `/api/applications/:id/interview-invitation` | Applicant | Yes, saved Interview snapshot | Existing invitation | Yes, transaction/dedupe key | interviewInvitationWorkflow; jobInterviewDetails; notificationInterviewDetails |
| Interview retry endpoint | Same applicant | Existing record retained | Requeues existing failed row only | Yes, explicit owner action | interviewInvitationWorkflow; manual provider-log review still required for ambiguity |
| Both announcement creation routes | Alumni, optional year/range filter | Yes | Existing title notification | Yes | notificationWorkflows, exact 2023-2026 range assertion |
| Admin warnings for alumni/employer | Selected matching-role user | Yes | Existing warning | Yes | notificationWorkflows; existing role/scoped routes unchanged |
| Admin profile-update request | Selected alumnus | Yes | Existing request if address exists | Yes, transaction/dedupe key | alumniProfileTracking |
| Read profile-update notification | Owner | Read/responded state and audit | No extra email | No | existing profile tracking/security checks |
| Notification list/read/delete/interview details | Authenticated owner | Existing badge/list behavior | No email action | No | security; notificationInterviewDetails; safe-error regression; frontend source audit |

There is no new blanket email conversion for in-app-only events. No worker SMTP
connection or Brevo HTTPS request is allowed to reach a real provider in these tests.

## F. Brevo integration and configuration

The existing centralized adapter POSTs native-fetch JSON to
`https://api.brevo.com/v3/smtp/email`. The API key is sent only in the `api-key`
request header. Sender email/name, recipient strings or named-recipient objects,
subject, textContent and optional htmlContent are mapped. Existing templates are
plain text; no queue schema change was needed for HTML. Success requires a
nonempty messageId. The 15-second timeout covers the request; malformed success,
network/timeouts and uncertain server errors are not treated as accepted.

Set **server-side** configuration in Render, without printing secret values:

```dotenv
EMAIL_PROVIDER=brevo
EMAIL_FROM=jamestehiro0@gmail.com
EMAIL_FROM_NAME=DJEMC Alumni Portal
```

BREVO_API_KEY must be present in the process that actually runs the worker.
Explicit `brevo` is recommended for clarity. If EMAIL_PROVIDER is unset, a nonblank
Brevo key auto-selects it; explicit smtp overrides that key. Explicit SMTP retains
SMTP_HOST/SMTP_PORT/SMTP_SECURE, EMAIL_USER (or EMAIL), EMAIL_PASS and EMAIL_FROM.
No send failure causes a provider switch. SMTP 587 uses STARTTLS and requires
SMTP_SECURE=false; 465 retains implicit TLS.

401/403/400 are terminal until configuration/content is corrected. HTTP 429 is
eligible for bounded queue retry with Retry-After (numeric or HTTP-date), never
less than EMAIL_QUEUE_RETRY_MS. HTTP 408/5xx, network/timeouts, invalid success
responses and SMTP socket uncertainty are held for manual investigation, because
the provider may already have accepted the message. This deliberately favors
duplicate avoidance over automatic uncertain retries. Known SMTP connection
failures and explicit 4xx rejections may retry; permanent auth errors do not.
There is no internal HTTP retry loop or unconditional fallback.

Official references reviewed: [Brevo send API](https://developers.brevo.com/reference/send-transac-email),
[rate limits](https://developers.brevo.com/docs/api-limits),
[batch idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).
The documented batch idempotency contract was not assumed to guarantee all
single-message deliveries indefinitely. Sender verification and actual key
permissions must be checked in Brevo. A configured Gmail address is not proof of
sender acceptance. No live sender/account verification has been performed.

## G. Queue, worker and schema status

Defaults remain poll-after-batch=2000ms, batch=20, concurrency=5, stale=300000ms,
base retry=30000ms, per-job max_attempts=5. Positive integers are required, and the
stale interval must cover `ceil(batch/concurrency)*30000 + 10000` milliseconds.
Attempts now count reservations, including successful sends; existing counters
are not reset or backfilled. Missing provider settings pause all claims without
consuming attempts.

Only pending, due jobs below the attempt budget are claimed under a transaction
and row lock. A failed job stays failed. A stale/null processing lease is held with
EMAIL_AMBIGUOUS; an exhausted pending row becomes failed/EMAIL_EXHAUSTED. Existing
records remain inspectable. A worker validates ownership before sending and fences
state writes by id, processing state, timestamp and attempt. Results from rejected
state operations are logged safely. A failed sent write logs EMAIL_STATE and leaves
processing state for later review, without scheduling another send.

The installed Sequelize MySQL dialect reports skipLocked=false. Although the
query asks for skipLocked, this version relies on FOR UPDATE and transactional
serialization; do not claim emitted SKIP LOCKED SQL. Multiple processors coordinate
through the shared database, but unnecessary duplicated processes add contention.
Leases and dedupe keys are not a cross-provider exactly-once guarantee.

Local metadata audit: both mapped tables exist with no missing/type-different
model columns, both use InnoDB and the nullable unique dedupe index exists. No
schema change is required for these code fixes. Production remains unverified.
Historical migration 20260413 creates available_at/reserved_at and lacks several
current fields; do not replay it blindly or infer readiness from its filename.
The existing guarded dedupe migration addresses the key only. If the new audit
reports missing/current-field or type gaps, stop and prepare/review the specific
legacy-schema migration after a production backup; no automatic schema repair or
production migration is included here.

## H. Tests and actual results

Automated delivery uses mocked Brevo/SMTP transport. The opt-in MySQL test uses
only connection-local TEMPORARY tables on a verified local host and drops only
those temporary tables. No working application records or files are changed.

| Command | Actual result |
| --- | --- |
| Initial targeted email/worker/notification suite | 20 passed, 0 failed |
| `$env:NOTIFICATION_DB_TEST='1'; node --test tests/notificationPipeline.integration.test.js` | 1 passed, 0 failed |
| `node --test tests/notificationAudit.test.js tests/notificationWorkflows.test.js` | 6 passed, 0 failed after correcting enum SQL-type formatting in the audit |
| First `npm.cmd test` run | 392 tests: 378 passed, 14 skipped, 0 failed |
| Final `npm.cmd test` | 398 tests: 384 passed, 14 skipped, 0 failed |
| Frontend `npm.cmd run build` | Passed, exit 0; existing empty React chunk warning |
| `node scripts/auditNotificationConfig.js` | Valid local SMTP configuration; no real sender verification or email sent |
| Local schema-only audit | Both notification models ready; InnoDB and dedupe index present; skipLocked=false |
| `git diff --check` | Passed, exit 0 |

The initial development targeted run had 2 stale-fixture failures when the worker
contract changed; those fixtures were updated with stronger lease/terminal-state
assertions. The new audit test exposed ENUM formatting requiring the dialect's
escape helper; that implementation/test issue was fixed. These were local test
failures, not production exceptions. Default skips include 12 legacy isolated-DB
verification cases plus opt-in database integration cases; they are not reported
as passes. No production-delivery conclusion follows from mocks or schema checks.

## I. Exact Render deployment and verification checklist

1. Review the scoped diff and back up the actual production database before any
   separately reviewed schema repair. Compare production DB_HOST/DB_PORT/DB_NAME
   privately with the real database provider; Render hosting does not identify
   the database provider. Do not change or commit .env files.
2. Confirm the web service uses Root Directory `backend`, Build Command `npm ci`,
   Start Command `npm start`. At repository root, equivalents are `npm --prefix
   backend ci` and `npm --prefix backend start`. Use a supported Node version
   satisfying package.json (>=22.12.0) and verify actual startup version.
3. Set NODE_ENV=production, existing DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS,
   JWT_SECRET and existing application settings. Keep ENABLE_DB_SYNC disabled.
   Configure EMAIL_PROVIDER=brevo, the existing BREVO_API_KEY, EMAIL_FROM and
   EMAIL_FROM_NAME as in F. Confirm sender is registered/accepted in Brevo first.
4. Choose one intended worker arrangement. For the existing embedded setup,
   leave EMAIL_WORKER_ENABLED unset/true; no separate paid worker is required by
   this implementation. The worker inherits the web environment. A sleeping web
   instance cannot continuously process queued mail, so verify service uptime.
5. If a separate Render Background Worker is chosen, Root Directory `backend`,
   Build `npm ci`, Start `npm run email-worker`; set EMAIL_WORKER_ENABLED=false on
   the web service. Copy the same database, provider, sender and queue settings
   to the worker. It does not need a public port. Verify actual Render dashboard
   resources; no blueprint was found. See [Render workers](https://render.com/docs/background-workers)
   and [Node/Express deployment](https://render.com/docs/deploy-node-express-app).
6. Before rollout, avoid mixed old/new consumers: pause/drain existing workers
   under the established deployment procedure. Old worker code still retries
   failed rows and does not honor the new hold policy. Verify old processes have
   stopped before resuming the new worker(s).
7. Run `node scripts/auditNotificationConfig.js` in the worker-equivalent
   environment. For database readiness, use `node scripts/auditNotificationConfig.js
   --schema --host <expected_production_host> --database <expected_production_name>`.
   These flags verify the target; they do not select its connection. Export the
   actual production DB_* values in a temporary local PowerShell session if
   Render Shell is unavailable; the existing process-env-over-.env behavior
   applies. Neither command sends an email or applies a migration. Do not execute
   older root-level notification investigation scripts or dump queue contents.
8. After manual deployment, check sanitized startup logs: correct provider,
   configured=true, worker started, no paused/config/schema errors or repeated
   worker restarts. `checkEmailConfig.js --verify` checks Brevo settings locally
   only; it does not authenticate with Brevo or verify the sender.
9. With controlled test accounts, manually trigger an existing password reset,
   alumni verification, employer decision, warning, targeted announcement and
   interview invitation. Confirm in-app recipients and owner-only read/delete/
   details; existing in-app-only application decisions must stay in-app only.
10. Privately correlate the queue row status and provider acceptance with Brevo
    transactional logs, then verify inbox receipt. Do not copy reset URLs,
    recipient lists, message content, credentials or provider headers into logs
    or reports. Verify exactly one expected recipient/event, refresh persistence,
    and the configured worker arrangement. Do not replay ambiguous failed jobs
    until provider logs establish whether they were accepted.

No live settings, provider send or deployment was changed by this task.

## J. Remaining risks and unverified dependencies

- Actual Render start command, service availability, active worker count,
  deployed commit/Node version, environment values and queue schema require
  dashboard/log verification. No connected Render access was available.
- Brevo key validity, Gmail sender acceptance, quotas, suppression/bounces and
  inbox receipt remain unverified. Provider acceptance is not delivery.
- Ambiguous sends and crash-batch jobs may be held even if never dispatched;
  this is a visible manual-review condition, not automatic loss or duplication.
  The existing invitation retry endpoint remains an explicit owner action;
  operators must reconcile provider logs before retrying uncertain results.
- There is no delivery-webhook ingestion, provider messageId persistence,
  generalized admin queue-reconciliation UI or automatic held-job replay in this
  change. Do not promise exactly-once sending.
- Repeated unkeyed business events can enqueue new messages. Existing profile,
  invitation and employer-decision dedupe keys are retained, not generalized
  without business-event definitions.
- Long queue delays may outlast the existing 15-minute password-reset token TTL.
  Token expiry, templates and business rules were preserved; request a fresh
  reset instead of replaying expired reset messages.
- Shared notification failures still return [] to preserve existing callers'
  best-effort behavior, now with a complete transaction rollback and safe logs.
  Feature actions outside that transaction can still succeed without a notification.
- Old root diagnostic scripts expose private content/raw errors and some contain
  outdated hardcoded findings; use the new audit script instead.
- Existing database TLS disables certificate validation. That separate connection
  concern was documented and not weakened or silently changed here.

## K. Rollback

Pause/drain mail consumers before rollback and preserve a database backup and the
reviewed deployment revision. Prefer configuration-only rollback to explicit
EMAIL_PROVIDER=smtp with valid prior SMTP settings while retaining the hardened
worker and its terminal/lease behavior. No notification or queue records need to
be deleted, reset or migrated. Sender settings must remain appropriate for the
chosen provider; no automatic fallback is introduced.

If code rollback is required, restore only this task's reviewed files, preserving
unrelated work. Do not blindly run the old worker against failed/ambiguous rows:
it would select them again. Keep consumers paused until provider acceptance has
been reconciled and a deliberate per-job plan is approved. The old worker already
pauses on invalid/missing provider settings, which can be used under an explicit
operator-controlled rollback procedure; EMAIL_WORKER_ENABLED is not supported by
the old server version. Never bulk-reset attempts/status or delete history merely
to make the queue look healthy. No destructive schema rollback is required.
