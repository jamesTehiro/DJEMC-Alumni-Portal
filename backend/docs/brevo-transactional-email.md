# Brevo transactional email

The existing email queue and notification callers use `utils/email.js` as their
delivery adapter. The adapter submits their current recipient, subject, and
text message to Brevo's HTTPS transactional email endpoint when Brevo is
selected. Notification templates and enqueue triggers remain in their
existing controllers.

## Configuration

Set these server-side environment variables in Render:

- `BREVO_API_KEY`
- `EMAIL_FROM`
- `EMAIL_FROM_NAME`

Set `EMAIL_PROVIDER=brevo` explicitly. Adding a key alone never changes the
provider. Unset EMAIL_PROVIDER retains legacy SMTP, and `EMAIL_PROVIDER=smtp`
selects it explicitly. SMTP still requires `EMAIL_USER` (or legacy `EMAIL`)
and `EMAIL_PASS`; Brevo neither initializes Nodemailer nor uses SMTP ports.
Keep the previous SMTP variables until an approved migration is verified.

Optional `EMAIL_REQUEST_TIMEOUT_MS` defaults to 15000 and accepts integer values
from 1000 through 30000, within the existing queue lease budget. Invalid sender,
recipient, timeout or provider settings fail before a request. Plain mailbox
addresses and `{ email, name }` recipients are supported; comma-separated
envelopes, CR/LF injection and ambiguous display-address strings are rejected.

The API key is sent only in the HTTPS `api-key` header. Diagnostics log the
selected provider and whether configuration fields are present, never their
values or email contents. Explicit HTTP 429 rejections use the queue retry
budget and respect Retry-After. Ambiguous network, timeout, 5xx and malformed
success responses are held as failed for provider-log review. Stale processing
jobs are also held for review, rather than automatically resent. SMTP explicit
temporary rejections and known connection failures can retry; permanent and
ambiguous SMTP failures are held. No failure switches providers automatically.

Reuse the existing EMAIL_FROM and set EMAIL_FROM_NAME to
`DJEMC Alumni Tracking and Job Portal`. Confirm sender/domain verification in
Brevo before claiming production delivery works; local validation cannot prove it.

The existing three-argument sendEmail(to, subject, text) contract is preserved.
An optional fourth argument `{ html }` maps HTML without changing existing text
templates. Current queue records and notification callers remain plain text.

The HTTP adapter refuses redirects so the API key cannot be forwarded elsewhere.
Safe provider message IDs are returned and included in acceptance/state-error
logs alongside queue job IDs. The current queue model has no mapped message-ID field; production schema is
uninspected. No
schema change or database persistence of those identifiers is claimed. Retain
structured logs for reconciliation. Existing `sent`/`sent_at` mean API acceptance.

The existing interview retry endpoint refuses unknown/ambiguous deliveries with
409 EMAIL_REVIEW_REQUIRED. Legacy errors without a definite rejection also need
administrator/provider-log review. Definite rejected requests remain eligible
for the existing explicit retry; automated retries still honor the finite budget.

`npm start` starts an embedded email worker by default. For a separately
configured worker, set EMAIL_WORKER_ENABLED=false on the web service and use
`npm run email-worker` for the worker process. Review held deliveries before any
manual retry; queue status `sent` means provider acceptance, not inbox delivery.

## Deployment check

After staging validation and explicit release approval, configure the variables
and deploy the backend. Run `node scripts/checkEmailConfig.js --verify` in a
trusted environment with the selected configuration. This
validates local Brevo settings only (not the key or sender with Brevo), and sends
no email. Use `node scripts/auditNotificationConfig.js` for sanitized configuration
checks and its `--schema --host <expected_host> --database <expected_name>` mode
for a read-only database audit. Then trigger
an existing notification using a controlled test account and check the queue
job status and Brevo transactional email logs. Do not print or share the API
key while checking the deployment.

Render Free suspends idle web services and blocks SMTP ports. The embedded
worker is not an always-on delivery service while the web service is asleep;
see [Render's Free limitations](https://render.com/docs/free).

See [the current migration report](brevo-api-migration-report.md) for the full
inventory, tests, Render checklist, reconciliation, deployment gates and rollback.
No new public mail endpoint, provider webhook, email queue or database migration
is introduced by this transport change.
