Automatic application decision emails

Implemented November 1, 2026. Approval and decline now enqueue an additional transactional email after the existing authorized application decision and its original in-app notification commit. No frontend files, modal layouts, document workflows, existing templates, email provider, worker or queue were changed.

Files changed:

| File | Purpose |
| --- | --- |
| `backend/controllers/applicationController.js` | Pass a decision-email event only after a new status transition commits. |
| `backend/utils/applicationDecisionEmail.js` | Build the new plain-text templates, check the registered recipient, and use the existing email enqueue helper. |
| `backend/tests/applicationDecisionEmail.test.js` | Mocked decision-to-queue-to-Brevo tests, recipient security, duplicate requests, failed commits, queue/provider failures and template checks. |
| `backend/tests/applicationDecision.test.js` | Add a recipient lookup fixture so existing decision tests never query live accounts. |
| `backend/docs/application-decision-emails.md` | Implementation, validation and deployment report. |

Both Employer and Admin Employer Applicant Details modals already call `saveApplicationDecision` in `frontend/alumni-portal/src/features/jobs/utils/applicationDecision.js`. It calls the existing authenticated `PUT /applications/:id/review` endpoint. The existing administrative alias `PUT /admin/employer/applications/:applicationId/review` also reuses the same controller. The frontend's synchronous submission lock, disabled final decisions, confirmation, response handling and document tools are unchanged.

Approval transitions a pending application to `verified`, displayed as APPROVED. This action does not itself schedule an interview or issue an offer. The approval email therefore says “approved for the next stage of the recruitment process” and “Application Status: Approved.” Decline transitions to `not_verified` and emails “Application Status: Declined.” The subjects are “Job Application Update – Application Approved” and “Job Application Update – [Job Title]”. The separate, existing interview-invitation template and workflow remain unchanged.

Names and the destination address come from the applicant's registered User record. The destination must satisfy the existing Gmail registration validator; the user must have role `alumni`, account status `verified`, and a valid `email_verified_at` timestamp. Missing, invalid, suspended, unverified or legacy recipients without that timestamp are skipped with a sanitized reason while the saved decision and in-app notification remain intact. No frontend or submitted-application email address is trusted. Company identity comes from the posted job's original owner and EmployerProfile, including when an administrator makes the decision.

The templates contain only the applicant name, position, company, decision, Philippine decision date and portal login link. The existing queue sends plain text as Brevo `textContent`; no dynamic HTML, applicant documents, attachments, private notes or rejection reasons are included. Subject controls are stripped and subject length respects the existing queue column. Logs contain event/application/cycle identifiers and sanitized error codes, without addresses, names, message content or credentials. The internal diagnostic labels are `job_application_approved` and `job_application_declined`; the existing in-app notification type `application` and its exact messages are unchanged.

Delivery reuses `utils/emailQueue.js` → `models/EmailQueueJob.js` → `workers/emailQueueWorker.js` → `utils/email.js` and the existing Brevo sender configuration. No Brevo request occurs in the decision handler. A successful enqueue is `pending`, not “Email sent.” Provider acceptance and delivery-state handling remain the worker's responsibility.

The existing locked compare-and-set permits side effects only for the winning pending-to-final transition. An unchanged status returns without enqueueing, and an opposing final decision is rejected. The existing unique queue `dedupe_key` receives `job-application-decision:[application ID]:[recruitment cycle]:[status]`. Duplicate processing cannot insert a second row with that key. Worker retries use the same row and key; they never generate another queue record.

The existing worker normally polls every 2 seconds, uses the queue's default maximum of 5 attempts, and retries eligible definite rejections with its existing minimum 30-second delay and provider Retry-After. These settings can already be configured. Brevo 429 rejection can retry; ambiguous timeouts, network failures, 5xx responses and stale processing deliveries are held for review rather than blindly resent. Permanent failures remain failed. This implementation does not weaken those duplicate-delivery protections. Provider acceptance is not proof of Gmail inbox delivery.

Validation:

| Check | Result |
| --- | --- |
| Focused application-decision, decision-email, queue deduplication and worker safety suites | 56 passed, 0 failed. Includes 27 new decision-email checks. |
| Broader backend notification, Brevo transport, OTP, registration, password-reset, interview and archive regression run | 141 total: 130 passed, 10 existing skipped checks, 1 existing announcement-targeting failure. |
| Independent existing announcement test | Reproduces HTTP 500 instead of expected 200 in `notificationWorkflows.test.js:98`. The test and its announcement/admin/notification implementations are unchanged from HEAD and do not depend on the new decision helper/controller path. No unrelated fix was made. |
| Frontend applicationDecision and applicantDocumentWorkspace suites | 11 passed, 0 failed; both modals retain their controls, callbacks, previews and submission protection. |
| Changed backend JavaScript syntax and git whitespace checks | Passed. |

All email delivery in tests used mocked Brevo requests. No real emails were sent, no production database records were changed, and no migration was run. Test logs are in `tmp/application-decision-email/` (`focused-tests.log`, `backend-tests.log`, `announcement-baseline.log`). The focused command is `node --test tests/applicationDecisionEmail.test.js tests/applicationDecision.test.js tests/emailQueueDeduplication.test.js tests/emailWorkerSafety.test.js` from `backend/`.

Production requirements and limitations:

- Deploy/restart the backend to load the controller and template helper. A frontend deployment is unnecessary for this feature. Nothing was deployed automatically.
- No new dependency, environment variable or schema migration is required. The already implemented `email_verified_at` field and email queue schema, including the unique `dedupe_key` index, must already be present. Production configuration and schema were not inspected or modified.
- Continue using the existing Brevo provider/sender configuration and enabled embedded worker, or the already configured separate email worker. Delivery waits whenever the worker or Render service is inactive; a sleeping web service cannot process its embedded queue until it resumes. No new scheduling or hosting changes were introduced.
- Legacy accounts without verified email timestamps are deliberately skipped. Review their verification through authorized account procedures before expecting email delivery; this task does not backfill verification or change account data.
- If recipient lookup or enqueueing fails after commit, sanitized logs identify the affected application/cycle/event. The decision remains successful. A worker can retry only queue rows that were saved. A process crash between the decision commit and enqueueing, or an enqueue failure, needs operator reconciliation using the existing decision audit and logs; an unchanged decision request deliberately does not enqueue again. No automatic backfill or unsafe resend workflow was added.
- Existing held/failed deliveries require the current operational review process. Live Gmail delivery, Brevo sender acceptance and production worker uptime were not verified with real email.
