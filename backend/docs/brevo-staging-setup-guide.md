# Brevo staging setup guide

This guide prepares a separate local staging configuration. The diagnostic is a local preflight: by default it does not contact Brevo, open a database connection, send mail, or run migrations. Its optional `--sender` and `--events` checks make read-only Brevo API calls. They do not send mail or prove inbox delivery.

## 1. Keep staging separate

The lowest-cost starting point is local staging on your own computer: run the app against a dedicated local MySQL database and use synthetic accounts and records. Keep the live Render service and Aiven database out of this setup. This project uses MySQL, so SQLite is not a drop-in staging database. Do not copy production data into local staging.

If you later need a shared environment, create a separate staging service and a separate staging database with separate credentials and a distinct database name. Do not point staging at the production Aiven host. The diagnostic refuses Aiven-looking hosts and production database names; remote database access also requires `STAGING_DB_ISOLATED=true` as an explicit local confirmation. That flag is a safeguard, not proof that a remote server is safe.

## 2. Prepare the local staging database

Install/use a local MySQL server and create a new empty database and a dedicated user through your normal MySQL administration method. Use a name such as `djemc_alumni_staging`; do not reuse the production database name or credentials. Keep the database on `127.0.0.1` / `localhost`.

The preflight only checks that `DB_HOST`, `DB_NAME`, and `DB_USER` are present and safe. It does not connect or check grants/schema. An empty database is sufficient for configuration diagnostics, but actual app workflows require the reviewed application schema and synthetic fixtures. No migration is run by this guide; use a separately reviewed staging schema procedure before workflow testing.

## 3. Create the staging environment file

From PowerShell in the repository root:

```powershell
Copy-Item backend/docs/brevo-staging.env.example backend/.env.staging
notepad backend/.env.staging
```

Replace every placeholder in `backend/.env.staging`. Set `NODE_ENV=development`, `EMAIL_PROVIDER=brevo`, `DB_HOST=127.0.0.1`, your local staging database name/user/password, and a stable random `REGISTRATION_OTP_SECRET` of at least 32 bytes. Keep this file private. The root `.gitignore` ignores `backend/.env.staging`.

Generate an OTP secret directly into the clipboard without displaying it, paste it into the open Notepad file, then clear the clipboard:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | Set-Clipboard
# Paste into REGISTRATION_OTP_SECRET in Notepad, then clear the clipboard:
Set-Clipboard -Value ''
```

Alternatively, generate and paste a value using an approved password manager. Never paste secrets into PowerShell command arguments or the terminal prompt.

## 4. Prepare Brevo credentials and an authorized Gmail recipient

In the Brevo account, create a replacement REST API key with transactional email access. Do not use the SMTP key/password. Store it only as `BREVO_API_KEY` in `backend/.env.staging`; never put it in source code, a frontend `VITE_*` variable, screenshots, chat, or command arguments. If a key has ever been exposed, revoke it and create another one.

Set `BREVO_TEST_GMAIL` to a Gmail inbox you own or have explicit permission to test. Use only that address for controlled delivery. Set `EMAIL_FROM` to the exact sender mailbox verified in Brevo and `EMAIL_FROM_NAME` to the desired display name. A key and sender address are not evidence that Brevo has activated sender verification.

## 5. Verify the sender in Brevo

Complete Brevo's sender/domain verification flow in the Brevo dashboard. Then, from `C:\Alumni\backend`, optionally make a read-only API check:

```powershell
node scripts/checkBrevoStaging.js --env-file .env.staging --sender
```

This sends an HTTPS `GET` request to list senders. Output reports only whether the configured sender was listed and active; it does not print sender addresses or the API key. A failed check can mean bad credentials, account access limits, or an unverified sender. Dashboard verification still needs to be reviewed there.

## 6. Run local diagnostics and automated tests

From the repository root, confirm Git ignores the secret file:

```powershell
git check-ignore -v backend/.env.staging
```

Run the default configuration preflight. It does not contact Brevo or the database:

```powershell
node backend/scripts/checkBrevoStaging.js --env-file backend/.env.staging
```

Run the staging diagnostic tests and existing Brevo/OTP tests from `backend`:

```powershell
Set-Location backend
node --test tests/brevoStagingDiagnostics.test.js tests/brevoApiMigration.test.js tests/brevoWorkflowTransport.test.js tests/registrationOtp.test.js tests/registrationOtpApi.test.js tests/registrationOtpMigration.test.js
```

The automated email tests use fixtures/mocked HTTP. They do not send email or use the staging database. Review each test summary and confirm zero failures. Do not enable live database integration flags against production.

The diagnostic expects an explicitly selected `EMAIL_PROVIDER=brevo`, a valid sender, a Brevo API key, and local staging database settings. Missing or unsafe values cause a nonzero exit. It never displays credential values. `--sender` and `--events` are optional read-only Brevo API calls; without those flags it makes no network request.

## 7. Test real delivery only after explicit approval

No command in this guide sends email. A real delivery test requires a separate explicit approval, a verified sender, a reviewed isolated staging database/schema, and an authorized Gmail recipient. Use the application's existing OTP or notification workflow after the staging app is deliberately started with the staging environment. Do not build a generic send endpoint or replay production queue records.

After an approved test, distinguish the evidence:

- API acceptance/message ID means Brevo accepted the request.
- Brevo event logs report provider events, not that a person saw the inbox message.
- The mailbox owner confirms actual inbox arrival, including spam folder if relevant.
- In-app notification state and queue status should be reviewed separately.

The optional `--events --message-id "<id>"` command checks Brevo events for the configured test Gmail. It filters output to that mailbox and ID, and explicitly does not claim inbox confirmation.

## 8. Prepare for shared staging and production review

Before shared staging, document the separate host/database name, account grants, TLS requirements, synthetic test data plan, sender verification, and who is authorized to receive tests. Check that staging has no production users, recipients, pending queue replay, or production credentials. Do not run migrations until their target and procedure have a separate review and explicit approval.

After controlled staging checks pass, review logs, OTP expiry/resend cooldown, the existing email queue/retry behavior, and in-app notifications. Preserve existing SMTP settings in production until the production migration has its own approval and rollback plan. This guide does not authorize a Render/Firebase deployment, production Aiven access, production environment changes, or live delivery.
