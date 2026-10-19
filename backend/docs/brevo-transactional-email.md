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

When `EMAIL_PROVIDER` is unset, the adapter selects Brevo if `BREVO_API_KEY` is
present; otherwise it retains the existing SMTP behavior. Set
`EMAIL_PROVIDER=brevo` to select Brevo explicitly or `EMAIL_PROVIDER=smtp` to
select SMTP explicitly. SMTP still requires `EMAIL_USER` (or legacy `EMAIL`)
and `EMAIL_PASS`; Brevo does not require SMTP hosts or ports.

The API key is sent only in the HTTPS `api-key` header. Diagnostics log the
selected provider and whether configuration fields are present, never their
values or email contents. Explicit HTTP 429 rejections use the queue retry
budget and respect Retry-After. Ambiguous network, timeout, 5xx and malformed
success responses are held as failed for provider-log review. Stale processing
jobs are also held for review, rather than automatically resent. SMTP explicit
temporary rejections and known connection failures can retry; permanent and
ambiguous SMTP failures are held. No failure switches providers automatically.

The requested sender is EMAIL_FROM=jamestehiro0@gmail.com with
EMAIL_FROM_NAME=DJEMC Alumni Portal. Its verification/acceptance must be confirmed
in Brevo; this checkout cannot establish that. Follow Brevo's sender/domain
verification requirements before claiming production delivery works.

The existing three-argument sendEmail(to, subject, text) contract is preserved.
An optional fourth argument `{ html }` maps HTML without changing existing text
templates. Current queue records and notification callers remain plain text.

`npm start` starts an embedded email worker by default. For a separately
configured worker, set EMAIL_WORKER_ENABLED=false on the web service and use
`npm run email-worker` for the worker process. Review held deliveries before any
manual retry; queue status `sent` means provider acceptance, not inbox delivery.

## Deployment check

After setting the variables, deploy the backend and run
`node scripts/checkEmailConfig.js --verify` in the backend environment. This
validates local Brevo settings only (not the key or sender with Brevo), and sends
no email. Use `node scripts/auditNotificationConfig.js` for sanitized configuration
checks and its `--schema --host <expected_host> --database <expected_name>` mode
for a read-only database audit. Then trigger
an existing notification using a controlled test account and check the queue
job status and Brevo transactional email logs. Do not print or share the API
key while checking the deployment.

See [the full implementation report](notification-implementation-report.md) for
the trigger matrix, tests, worker coordination, deployment and rollback details.
