# Application decision Gmail notifications

Updated November 3, 2026. This report replaces the earlier November 1 implementation notes.

The Employer and Admin Employer Applicant Details actions now queue selection/decline mail for registered Gmail recipients through the existing job-posting email infrastructure. No provider, worker, email credentials, queue schema, registration workflow, application status values, interview scheduling flow or production records were changed for this repair.

## Confirmed cause and reference workflow

Job posting calls `notificationController.createNotification`. It selects Alumni with `account_status=verified`, resolves their registered User email addresses, writes an in-app notification and inserts `pending` jobs through `enqueueEmails`. It does not require an OTP-era `email_verified_at` timestamp.

Decision mail already had an email helper, but imposed an additional valid `email_verified_at` check. The registration migration intentionally left that nullable field NULL on existing accounts. Consequently, an existing verified Gmail account eligible for job-post mail was silently excluded from selection/decline mail. No queue row existed for the worker to deliver. The helper also hid recipient/queue failures from the successful decision response, and an unchanged decision could not recover a missing email row. These defects are confirmed in source and isolated fixtures. No production recipient records, private Render settings or live Brevo delivery were inspected; this is not a claim that a deployed production incident has been verified as resolved.

The working path remains:

| Stage | Existing implementation |
| --- | --- |
| Employer posts job | `frontend/alumni-portal/src/features/dashboard/employer/EmployerPage.jsx`, POST `/jobs` |
| Job creation and verified Alumni targeting | `backend/controllers/jobController.js`, `createJob` |
| Shared in-app notification and registered-recipient lookup | `backend/controllers/notificationController.js`, `createNotification` |
| Queue normalization/insertion | `backend/utils/emailQueue.js`, `enqueueEmails` |
| Durable state and unique deduplication key | `backend/models/EmailQueueJob.js`, table `email_queue_jobs` |
| Polling, reservation, leases, retries and state updates | `backend/workers/emailQueueWorker.js` |
| Existing Brevo API adapter and sender configuration | `backend/utils/email.js` |

Job alerts use the controller's existing plain-text message. Decisions reuse their existing plain-text `buildApplicationDecisionEmail` template, adapted for selection and decline. Both reach the same enqueue helper, table, worker and Brevo `textContent` API request. There is no second email system.

## Decision behavior

Both portals call the shared frontend `saveApplicationDecision` and authenticated PUT `/applications/:id/review`. The administrative alias PUT `/admin/employer/applications/:applicationId/review` also delegates to `reviewApplication`.

Employer ownership, Employer Admin scope, job/cycle matching, archived-state checks, locked compare-and-set, audit creation and transactional status/in-app writes remain enforced. Only the winning pending-to-final transition creates the in-app notification and audit. Stored statuses remain `verified` (displayed as For Interview) and `not_verified` (Declined). Documents, recruitment cycles and the separate scheduled-interview invitation workflow are unchanged.

After a successful decision commit, the existing helper resolves the registered Alumni User and original job owner's EmployerProfile. Verified Alumni with a valid registered Gmail address are eligible, including legacy accounts with NULL `email_verified_at`. Missing accounts, non-Alumni, pending/suspended accounts and invalid/non-Gmail destinations are reported as unavailable. No request-body or application-form email is trusted; account verification data is never changed.

For Interview mail names the applicant, job and company, says the applicant was selected to proceed to the interview stage, and explicitly says the selection notice does not confirm an interview schedule. Decline mail thanks the applicant and respectfully explains that the application was not selected. Both include a Philippine decision date and portal link; neither includes private notes, resumes or attachments.

The existing unique key is `job-application-decision:<applicationId>:<recruitmentCycle>:<status>`. An authorized repeated request returns the existing row state. If no row exists, it can recover a prior enqueue failure or interrupted enqueue; concurrent inserts are fenced by the unique key. It never creates another in-app notification or audit, and never replaces/requeues an existing failed, processing or accepted email. No historical decisions were automatically replayed.

The existing decision and in-app transaction still succeeds independently of later email failures. Recipient/queue failures now produce a sanitized `email.status=failed` and reason in the successful decision response, plus safe operational logs. A database outage may prevent any queue row from being recorded; in that case `enqueue_failed` is an API/log outcome, not a fictitious persisted failed job. A process interruption between decision commit and queue insertion still requires an authorized repeat request or operator reconciliation. Delivery failure does not reverse an application decision.

| Queue state | Decision response snapshot and frontend wording |
| --- | --- |
| `pending` | `queued`: Gmail notification queued for delivery |
| `processing` | `processing`: being processed |
| `sent` | `sent`: accepted by email provider; inbox delivery not confirmed |
| `failed` | `failed`: warning; does not claim successful delivery |
| No row because lookup/enqueue failed | `failed` with safe reason, while retaining the saved decision |

Both Applicant Details modals display the result visibly, including queue failures. The response is a snapshot; no new delivery polling endpoint was introduced. Worker state remains authoritative after enqueueing. Brevo acceptance is not proof of Gmail inbox placement.

## Files changed for this repair

| File | Change |
| --- | --- |
| `backend/controllers/applicationController.js` | Return decision email state and permit authorized recovery of missing queue entries on unchanged decisions |
| `backend/utils/applicationDecisionEmail.js` | Align legacy recipient eligibility, reuse queue deduplication, report queue outcomes, update selection/decline templates |
| `backend/tests/applicationDecisionEmail.test.js` | Both roles/events, legacy recipients, accurate states, recovery, duplicate protection, safe failures and mocked worker/Brevo processing |
| `backend/tests/applicationDecision.test.js` | Isolate queue lookup in existing permission/status fixtures |
| `backend/tests/jobPosting.test.js` | Exercise real shared notification helper and queue for both posting roles and legacy recipients |
| `frontend/alumni-portal/src/features/jobs/utils/applicationDecision.js` | Shared accurate delivery feedback |
| `frontend/alumni-portal/src/features/dashboard/employer/EmployerPage.jsx` | Display decision mail feedback in page and open Applicant Details modal |
| `frontend/alumni-portal/src/features/dashboard/admin-employer/AdminEmployerPage.jsx` | Same feedback using the same shared helper |
| `frontend/alumni-portal/tests/applicationDecision.test.js` | Queue/processing/acceptance/failure message checks |
| `frontend/alumni-portal/tests/applicationStatus.browser.test.js` | Both portals, both actions, desktop/mobile, rapid duplicate clicks, queued/failure feedback |
| `backend/docs/application-decision-emails.md` | This report |

Other working-tree changes predate this task and were preserved. In particular, this repair does not modify the existing email transport, enqueue helper, notification controller, job controller, worker, Alumni/Employer OTP templates, environment files or secrets.

## Validation

All database/controller fixtures and Brevo HTTP requests were mocked. Browser tests served local fixtures and blocked external requests. No actual email was sent and no production database or settings were changed.

| Check | Result |
| --- | --- |
| Focused decision/email/job-post/queue-deduplication/worker-safety tests | 81 passed, 0 failed |
| Broader backend notification, email transport/recovery, OTP, admin registration, interview and archive regressions | 99 passed, 1 pre-existing announcement failure, 11 skipped (including optional real MySQL integration) |
| Independent announcement reproduction | Same existing HTTP 500 versus expected 200 in `notificationWorkflows.test.js`; test and announcement/admin/notification controllers have no diff from HEAD |
| Frontend decision, job-post, job-edit, document-workspace and application-submission units | 53 passed, 0 failed |
| Browser regression | 1 test passed, covering 16 combinations: both portals, both decisions, queued/failure feedback, 1440px/320px, with duplicate clicks |
| Frontend lint | Helper and changed tests pass. Both large page components retain exactly their HEAD baseline: 44 errors and 1 warning in total, no added findings |
| Production Vite build | Passed |
| Scoped git whitespace check | Passed |

From `backend/`, focused verification:

```powershell
node --test tests/applicationDecisionEmail.test.js tests/applicationDecision.test.js tests/jobPosting.test.js tests/emailQueueDeduplication.test.js tests/emailWorkerSafety.test.js
```

From `frontend/alumni-portal/`:

```powershell
node --test tests/applicationDecision.test.js tests/jobPosting.test.js tests/jobPostingEdit.test.js tests/applicantDocumentWorkspace.test.js tests/jobApplicationSubmission.test.js
$env:PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test --test-concurrency=1 tests/applicationStatus.browser.test.js
node node_modules/eslint/bin/eslint.js src/features/jobs/utils/applicationDecision.js tests/applicationDecision.test.js tests/applicationStatus.browser.test.js
node node_modules/vite/bin/vite.js build
```

Test commands in this session also set dummy DB connection variables to a non-service port; they did not use configured production accounts. Logs: `tmp/applicant-decision-focused.log`, `applicant-decision-regression.log`, `applicant-decision-announcement-baseline.log`, `applicant-decision-frontend-unit.log`, `applicant-decision-browser.log`, `applicant-decision-lint.log`, `applicant-decision-helper-lint.log`, `applicant-decision-lint-comparison.json` and `applicant-decision-build.log`. Mobile screenshots: `tmp/applicant-decision-employer-mobile.png` and `tmp/applicant-decision-admin-mobile.png`.

## Deployment requirements and limits

Deploy the reviewed backend and frontend releases only after approval. Neither has been deployed by this task. No new migration, dependency or environment variable was added. Verify the existing `email_queue_jobs` table and its full unique nullable VARCHAR(191) `dedupe_key` index, named `email_queue_jobs_dedupe_key_uq` in the existing migration, before relying on duplicate protection. Existing queue migration files are `20260413-create-email-queue-and-rate-limit-tables.js` and `20261016-repair-email-queue-dedupe-key.js`; neither was applied here.

The API and whichever existing worker runs must use the same database and existing sender settings: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM` (a Brevo-verified sender mailbox) and `EMAIL_FROM_NAME`. Existing DB/TLS and JWT configuration remain necessary. Bootstrap and OTP secrets are not required for decision notifications. No new SMTP or Gmail account configuration is needed for delivery through Brevo.

Local `backend/.env.staging` was inspected only for presence and obvious placeholders. EMAIL_PROVIDER selects Brevo, BREVO_API_KEY and EMAIL_FROM_NAME are present; EMAIL_FROM still matches a placeholder. No credential was logged, changed or validated against Brevo. Supply the intended verified sender privately before using that staging configuration. No local configuration was copied into Render.

The server and worker default to `backend/.env`; `.env.staging` requires explicit selection, for example `node --env-file=.env.staging server.js` or `node --env-file=.env.staging workers/emailQueueWorker.js` when running from `backend/`. Render does not automatically load a file because it is named `.env.staging`: set production variables independently for the API and any separately managed worker. The embedded worker inherits the API environment. Private Render configuration was not accessible and is not claimed to be verified.

Keep the existing embedded worker enabled, or run the existing separate worker using `npm run email-worker` with matching runtime settings. Do not start another worker just for decision emails. Default polling is 2 seconds; inactive services, queue backlog or paused provider configuration delay processing. Existing EMAIL_QUEUE_* settings were not changed.

The existing worker reserves due pending rows, marks processing under a lease, and records sent only after provider acceptance. Definite retryable rejection (such as 429) retries the same row with existing backoff/Retry-After rules. Permanent failures and ambiguous network/timeouts/5xx/crash outcomes remain failed or held for operator review, preventing blind duplicate delivery. Resolve those using the existing operational process; do not reset or replay accepted/ambiguous rows automatically.

After deployment, inspect safe job-ID/status logs and aggregate queue state without exposing addresses, templates or keys. Live inbox delivery and production worker uptime remain unverified until separately approved verification. Do not replay production decisions, send real test messages, change Render settings or modify database records under this task's authorization.
