# Render Gmail SMTP operation

Render Free web services block outbound ports 25, 465 and 587. Gmail SMTP
therefore requires a paid instance with outbound connectivity, or a separately
implemented HTTPS email provider. Changing credentials or switching between
465 and 587 cannot bypass this restriction.
https://render.com/docs/free

## Render environment

Set these in the backend service's Environment settings; placeholders below
are examples only. Do not commit credentials.

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=<complete Gmail address>
EMAIL_PASS=<Google app password>
EMAIL_FROM=<same Gmail address or an authorized send-as address>
```

The code requires EMAIL_USER (legacy alias EMAIL is supported) and EMAIL_PASS.
SMTP_HOST defaults to smtp.gmail.com, SMTP_PORT to 465, SMTP_SECURE to true
only for port 465, and EMAIL_FROM to EMAIL_USER/EMAIL. Port 587 uses secure:false
and requireTLS:true (STARTTLS); do not set secure:true on 587. App passwords
require Google 2-Step Verification and may be restricted by account policy.
https://support.google.com/mail/answer/185833
https://nodemailer.com/smtp

No additional SMTP variables are required. Existing database settings must
also be available to the worker: DB_HOST, DB_NAME, DB_USER, and, in production,
DB_PASS and DB_PORT. Set FRONTEND_URL to the deployed frontend for reset links
(CLIENT_URL is a fallback). Preserve the app's existing authentication settings.

Optional worker settings (defaults): EMAIL_QUEUE_POLL_MS=2000,
EMAIL_QUEUE_BATCH_SIZE=20, EMAIL_QUEUE_CONCURRENCY=5,
EMAIL_QUEUE_STALE_MS=300000, EMAIL_QUEUE_RETRY_MS=30000.
Use positive integer values. The model defaults max_attempts to 5 per job.

## Worker lifecycle and retry behavior

Use the existing `npm start` from backend (node server.js). Once database
startup succeeds, server.js forks workers/emailQueueWorker.js with inherited
environment and logs. It restarts an exited worker after 5 seconds. Do not
add a second email-worker process just to enable email. The polling timer
now keeps the worker alive even while idle. Free services can still sleep.

Invalid/missing SMTP configuration pauses reservation before jobs or attempts
are changed. Delivery errors increment attempts and schedule pending jobs
after 30 seconds; exhaustion leaves failed jobs. Existing reservation logic
also supports failed jobs below max_attempts and stale processing recovery.
No jobs are reset, requeued, or replayed by this change or diagnostic script.
After fixing settings, pending work can resume automatically; inspect backlog
before redeploying, especially expired reset links or old invitations.

Transactions, row locks, skipLocked and existing dedupe keys remain unchanged.
These prevent ordinary competing reservations but cannot guarantee exactly-once
delivery if SMTP accepts a message and the worker crashes before saving sent.
Do not bulk reset failed/stale jobs. Review SMTP acceptance and job state first;
use the existing authorized per-invitation retry action only for reviewed failures.

## Verify without sending

From the deployed backend shell:

```sh
node scripts/checkEmailConfig.js
node scripts/checkEmailConfig.js --verify
```

The first command reports presence and effective port/security without values
for credentials, sender or host. The second checks SMTP connection/TLS/auth
without sending email or accessing queue rows. It does not establish inbox
delivery or sender authorization. EAUTH/535 indicates authentication failure;
ETIMEDOUT/ECONNECTION/ESOCKET suggests networking or TLS problems. Unknown
errors are deliberately redacted. On a Free instance, resolve the plan
restriction before retrying connectivity tests.

For one controlled end-to-end check, use an existing workflow once with a
test account you control. Observe configuration configured:true, worker started,
processing jobId, then sent (SMTP accepted). Check its queue status/sent_at and
the recipient inbox/spam folder. SMTP acceptance does not guarantee inbox delivery.
Inspect counts without reading personal message content:

```sql
SELECT status, COUNT(*) AS jobs FROM email_queue_jobs GROUP BY status;
SELECT id, status, attempts, max_attempts, scheduled_at, sent_at
FROM email_queue_jobs ORDER BY id DESC LIMIT 20;
```

## Preserved triggers

- Alumni/employer registration: authController.register creates accounts/profiles;
  no registration email is currently queued.
- Registrar alumni approval: createNotification queues the verification email.
- Registrar alumni rejection: status/audit only; no rejection email is implemented.
- Employer approval/rejection: adminController queues the existing decision
  template transactionally with a dedupe key.
- Password reset: authController queues the existing reset-link template.
- Interview invitations: applicationController queues the existing invitation
  transactionally with an interview dedupe key and guarded retry endpoint.

Templates, recipients, routes, permissions and these triggers were not changed.
Production Render settings, service plan, queue state and real delivery must be
verified in Render; local configuration presence is not evidence of production state.
