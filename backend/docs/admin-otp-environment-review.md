# Admin OTP and Brevo environment review — 2026-11-02

> Historical review before configuration hardening. See [Admin OTP deployment configuration](admin-otp-deployment.md) for current behavior: a selected staging file can no longer borrow a missing admin bootstrap secret from `.env`.

This review made no production changes, started no API or queue worker, sent no emails, and opened no database connection. Both local environment files remained unchanged during inspection. The Render runtime and its dashboard settings are unverified.

## Environment loading

| Entry point | Ordinary local configuration |
| --- | --- |
| `npm start` / `node server.js` | `backend/server.js:5` loads `backend/.env` explicitly. |
| `npm run dev` | Nodemon runs the same server entry point and loader. |
| Embedded email worker | `backend/server.js:540` forks `workers/emailQueueWorker.js` with a copy of the API's `process.env`. The worker loads `backend/.env` again without overriding inherited variables. |
| `npm run email-worker` | The independent worker loads `backend/.env`; it inherits the environment of the terminal/service that starts it. |
| Database configuration | `backend/config/database.js:6` also loads `backend/.env` without overrides. |

There is no automatic `.env.staging` selection. Setting `NODE_ENV=staging` does not select that file. Existing process variables take precedence over these dotenv defaults. Explicit Node `--env-file` preloading makes staging values available before the application's ordinary `.env` loaders, which preserve those values. Variables missing from the preloaded file can still be filled from `.env`.

The diagnostic `scripts/checkBrevoStaging.js --env-file <path>` explicitly loads its selected file with `override:true` **in that diagnostic process only**. This does not change the server, another running process, or either file.

## Local findings (no values disclosed)

| Variable | `backend/.env` | `backend/.env.staging` |
| --- | --- | --- |
| `EMAIL_PROVIDER` | Absent: shared adapter defaults to SMTP | Present; selects Brevo |
| `BREVO_API_KEY` | Absent | Present, but recognized as a placeholder by the staging preflight |
| `EMAIL_FROM` | Present | Present; syntactically valid sender address |
| `EMAIL_FROM_NAME` | Absent | Present |
| `REGISTRATION_OTP_SECRET` | Absent | Present and at least 32 bytes, but appears to be a placeholder rather than a random secret |
| `ADMIN_BOOTSTRAP_SECRET` | Present | Absent |

No duplicate definitions of those variables were found in either file. The inspecting shell had none of these variables already set.

Consequences:

- A normal local start does not use the Brevo values in `.env.staging`. The new Admin OTP service requires Brevo and fails closed instead of falling back to SMTP.
- Explicit staging preloading preserves the four Brevo values and OTP secret across all three loaders. The missing admin bootstrap secret would currently fall back to `.env`; staging is therefore not a fully independent admin configuration.
- `checkEmailConfig.js` reports that preloaded staging is syntactically configured. It does not authenticate the key or detect placeholder content. The stricter `checkBrevoStaging.js` correctly reports `ready:false`; it also rejects the configured test Gmail address. These outputs measure different checks and are not evidence of working inbox delivery.
- A valid production OTP secret must be private random material, not merely a string that exceeds the length requirement. No key or secret was replaced during this review.

## Admin OTP requirements and shared email path

`controllers/adminRegistrationController.js` calls the existing `utils/email.js` configuration validator and requires its provider to be `brevo`. `services/adminOtpQueue.js` inserts into the existing `email_queue_jobs` through `enqueueEmails`. The existing queue worker sends through the same `utils/email.js` adapter. No second Brevo client, hardcoded sender or embedded credential was added.

Required API settings are:

- `EMAIL_PROVIDER=brevo` (explicit; adding a key alone does not switch providers).
- `BREVO_API_KEY`: the existing private transactional REST API key.
- `EMAIL_FROM`: the existing single sender address accepted by Brevo.
- `EMAIL_FROM_NAME`: the existing sender display name.
- `REGISTRATION_OTP_SECRET`: at least 32 bytes of private random material, stable across API instances/restarts.
- `ADMIN_BOOTSTRAP_SECRET`: the existing private admin setup secret.
- Existing `JWT_SECRET` and `DB_*` application configuration remain required; OTP verification uses the database, queue and rate-limit tables.

`EMAIL_REQUEST_TIMEOUT_MS` is optional; default is 15000 and supported values are 1000–30000. `EMAIL_QUEUE_POLL_MS`, `EMAIL_QUEUE_BATCH_SIZE`, `EMAIL_QUEUE_CONCURRENCY`, `EMAIL_QUEUE_STALE_MS`, and `EMAIL_QUEUE_RETRY_MS` retain their existing worker defaults and validation.

The embedded worker receives the API's effective values via `env:{...process.env}`. It is started after database readiness unless `EMAIL_WORKER_ENABLED=false`. A separately deployed worker is a different service/process: configure the same four Brevo settings and the same target database there. Queue rows contain content and recipient metadata, not a sender configuration or credentials; a separate worker can otherwise select a different provider. The worker does not use the OTP signing secret to deliver mail, but the API requires it to verify and consume admin grants.

Existing Alumni OTP retains direct delivery via `registrationOtpEmail.js` and the shared Brevo adapter. Employer registration retains permit review and its existing queued notification behavior. Their email transport modules and credential settings were not changed for this review.

## Production / Render

The code does not load `.env.staging` in production. A local ignored file is not a source of Render runtime variables. A separately configured start command or secret-file arrangement could load another file, but no such deployment configuration is available in this workspace and none was changed.

The actual Render service environment, deployed revision, selected worker mode, key authorization, sender verification and queue health cannot be confirmed from local source or the public health endpoint. Do not infer production settings from either local file.

In Render, the API service requires the six Admin OTP/Brevo variables listed above plus the existing database/JWT settings. An embedded worker inherits them. If an independent Render worker is used, it needs the four Brevo variables and matching database configuration in its own service environment, or an explicitly linked environment group. Keep `NODE_ENV=production` and database synchronization disabled. Do not upload the entire staging file: it also contains staging database and development settings.

Render documents service environment variables and linked environment groups at https://render.com/docs/configure-environment-variables . Service-specific settings override matching linked-group values, so check both when comparing independent API/worker services. Changes require separate approval and were not performed.

## Safe verification commands

From `C:\Alumni`, these commands inspect configuration without sending mail, connecting to the database, starting workers, or changing files:

```powershell
node backend/scripts/checkBrevoStaging.js --env-file backend/.env.staging
node --env-file=backend/.env.staging backend/scripts/checkEmailConfig.js
node --env-file=backend/.env.staging backend/scripts/checkRegistrationOtpConfig.js
```

Use a fresh terminal without conflicting existing variables when checking the file. Node's preexisting environment takes precedence over `--env-file`. No `--sender`, `--events` or SMTP `--verify` option was used. No actual API/worker startup command was executed because a running worker could process queued real messages.

In each approved Render service shell, from its backend directory, these existing diagnostics report presence/configuration without mail or database activity:

```sh
node scripts/checkEmailConfig.js
node scripts/checkRegistrationOtpConfig.js
```

The second command is intended for the API/embedded-worker service, where OTP/JWT configuration is needed. These checks validate local process configuration, not API authentication or inbox delivery. They were not run on Render during this review.

## Verification evidence

- Executed each entry point's actual dotenv statement in isolation: all loaded `.env`, all preserved explicit staging preloads and existing runtime overrides, and none selected `.env.staging` solely because `NODE_ENV=staging`.
- Verified file hashes remained unchanged; `.env` and `.env.staging` are Git ignored and untracked. No actual non-placeholder staging key/OTP secret was found in the reviewed changed source. The shared Brevo adapter and Alumni Brevo wrapper have no Git diff.
- `checkBrevoStaging.js --env-file .env.staging`: `ready:false`, no API read/send/database operation. Placeholder key and invalid test Gmail remain blockers.
- Explicit staging `checkEmailConfig.js` and `checkRegistrationOtpConfig.js`: selected Brevo, found all required sender values and a length-valid OTP secret. These are syntax/presence checks only.
- Mocked backend regression: **60 passed, zero failures**, covering email transport, worker safety/recovery, shared OTP, Admin OTP/registration, login/JWT/scope authorization and OTP API behavior. DB connection variables were forced to a loopback closed port, and all transports were mocked. Log: `tmp/admin-env-review-tests.log`.

No production setting, email credential, environment file, user account or mail workflow was changed by this review. No commit or deployment was performed.
