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
values or email contents. Brevo request failures are not automatically
retried because a timeout can occur after Brevo has accepted a message; this
avoids sending duplicates when delivery is uncertain. Existing SMTP queue
retry behavior remains unchanged.

The verified Gmail sender can be used as configured. A custom sender domain
with appropriate SPF/DKIM authentication may improve production deliverability;
no DNS changes are required for this integration.

## Deployment check

After setting the variables, deploy the backend and run
`node scripts/checkEmailConfig.js --verify` in the backend environment. This
validates the selected provider configuration and sends no email. Then trigger
an existing notification using a controlled test account and check the queue
job status and Brevo transactional email logs. Do not print or share the API
key while checking the deployment.
