# Admin OTP deployment configuration

Status: implementation and mocked regression checks pass. **The current `backend/.env.staging` is not configuration-ready. Render runtime settings and actual Brevo acceptance/inbox delivery are unverified.** No service was deployed or enabled, no production configuration/records changed, and no real email was sent.

This guide supersedes the fallback behavior described in the earlier [environment review](admin-otp-environment-review.md). It applies only to Admin OTP. It does not change Alumni OTP, Employer permit review, their templates, or shared provider selection.

## Configuration changes

For the production setup-status 503, independent existing-admin login, and the full three-admin case, see [the Admin bootstrap production repair](admin-bootstrap-production-fix.md). Registration readiness failures do not mean existing login is unavailable.

- `config/adminOtpEnvironment.js` captures the Admin configuration source **before** the existing `.env` loaders run. API, worker and database entry points initialize it first. The shared loaders themselves retain their existing behavior.
- An explicit Node `--env-file` selection (including `--env-file=<path>`) or dotenv preload with `DOTENV_CONFIG_PATH` is recognized. There is no automatic selection of `.env.staging` by its name or by `NODE_ENV=staging`.
- With an explicitly selected file, each protected Admin setting must be declared in that file and available at process startup. A missing `ADMIN_BOOTSTRAP_SECRET` remains missing for Admin OTP even if the main `.env` or an inherited process supplies a value later. This restriction also applies when multiple files are preloaded: the last selected file must declare the protected settings. Existing runtime overrides are retained for declared keys.
- In production (`NODE_ENV=production` or `RENDER=true`), missing Admin settings cannot be supplied by a later `.env` load. Existing verified account login is not gated by this new OTP configuration check.
- Only nonsecret source/missing-key metadata is inherited by the embedded worker. Existing process variables are not rewritten with new credential values. No environment file is rewritten.
- `services/adminOtpConfiguration.js` validates required fields, known placeholders, sender format, Brevo selection, secret length and drift between the selected configuration and effective shared transport/database values. Failures disable Admin creation and return an Admin OTP unavailable response; operator diagnostics identify field names and reasons without values.
- Admin jobs include a 24-character keyed configuration fingerprint in their existing `dedupe_key`. It binds the Brevo account, sender and database target/user; it is not an API key or OTP. The complete key remains within VARCHAR(191); no migration is added.
- The existing worker validates that fingerprint only for Admin OTP jobs. A different worker configuration, an expired/replaced code, or a job from the earlier unstamped Admin implementation is marked failed without delivery. Ordinary email jobs retain their existing behavior. Do not bulk-replay failed jobs; request a fresh Admin code after configuration is corrected.

## Required settings

| Variable | API / embedded-worker service | Separate email worker |
| --- | --- | --- |
| `EMAIL_PROVIDER` | Explicit `brevo` | Same value |
| `BREVO_API_KEY` | Existing private Brevo transactional REST key; no placeholder | Same key |
| `EMAIL_FROM` | Existing sender accepted by Brevo; one real mailbox | Same sender |
| `EMAIL_FROM_NAME` | Existing sender display name | Same name |
| `REGISTRATION_OTP_SECRET` | Private random material of at least 32 bytes, stable across API instances | Not required for delivery |
| `ADMIN_BOOTSTRAP_SECRET` | Private admin setup secret explicitly provided by the selected source | Not required for delivery |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | Existing intended target and credentials | Same target and user; required connection credentials |

Existing application settings such as `JWT_SECRET`, database CA/TLS settings and schema prerequisites remain necessary. Keep production database synchronization disabled. A valid-looking key does not establish API authorization, a verified sender, available quota, or inbox delivery.

`EMAIL_REQUEST_TIMEOUT_MS` is optional (default 15000; supported 1000–30000). Existing `EMAIL_QUEUE_*` worker settings and defaults remain unchanged. If protected settings are absent/empty/placeholder, Admin OTP fails closed while other workflows retain their existing configuration behavior.

## Current staging result

The offline Admin-specific check selected `backend/.env.staging` correctly and exited **1**, with no database connection or email request. It reports:

| Setting | Required action |
| --- | --- |
| `BREVO_API_KEY` | Replace the placeholder privately with the existing intended REST API key. |
| `EMAIL_FROM` | Replace the example sender privately with the existing Brevo-authorized sender. |
| `REGISTRATION_OTP_SECRET` | Replace the placeholder privately with a stable, randomly generated secret of at least 32 bytes. |
| `ADMIN_BOOTSTRAP_SECRET` | Configure a staging admin setup secret explicitly in the selected staging environment. No main `.env` fallback is accepted. |

`EMAIL_PROVIDER=brevo` and `EMAIL_FROM_NAME` are present. No credential or sender setting was changed by this task. The prior general staging mail checker also requires a valid controlled `BREVO_TEST_GMAIL`; this is not a production Admin OTP runtime requirement and no test email was sent.

## Offline checks

From `C:\Alumni`:

```powershell
# Parse only this file; never merge backend/.env. No database/mail activity.
node backend/scripts/checkAdminRegistrationReadiness.js --configuration-only --env-file backend/.env.staging

# Inspect the worker's required configuration independently.
node backend/scripts/checkAdminRegistrationReadiness.js --configuration-only --role worker --env-file backend/.env.staging

# Exercise actual native Node preloading with the same offline checker.
node --env-file=backend/.env.staging backend/scripts/checkAdminRegistrationReadiness.js --configuration-only
```

These commands exit nonzero for missing/placeholder settings. They print booleans and fixed issue labels, not credentials, mailboxes, OTPs or database identifiers. Configuration-only readiness is **not** evidence of database/schema availability, actual worker execution or Brevo delivery.

For deployment startup, preload the selected configuration before the ordinary API or standalone worker entry point. From `backend`, the corresponding command shapes are `node --env-file=.env.staging server.js` and `node --env-file=.env.staging workers/emailQueueWorker.js`. These are documentation only: they were **not executed**, because a running worker could send queued real mail. Review all staging database/JWT settings and queued recipients before any approved startup. The database entry point retains its shared `.env` defaults for existing workflows; Admin OTP refuses protected missing/drifting values.

## Render requirements and verification

`.env.staging` is not automatically loaded by Render or by production startup. Do not upload the entire staging file or commit any `.env` file. Configure the API service's production variables independently, preserving existing approved values. No authenticated Render access was available, so actual values, deployed revision and worker health remain unverified.

- API service: all six Admin mail/secret variables above plus the existing production DB/JWT/CA configuration. Set `NODE_ENV=production` and keep `ENABLE_DB_SYNC` unset/false.
- Embedded worker: the current server forks it with `env:{...process.env}` after database readiness. It receives the API's values and Admin source metadata. `EMAIL_WORKER_ENABLED=false` disables that embedded worker.
- Separate worker: configure the four matching Brevo settings and the same database target/user in its service environment, or link the same reviewed environment group. A separate service does not automatically inherit another service's settings. Ensure an intended worker is actually running if the embedded one is disabled.
- Deploy the reviewed worker with the configuration checks before exposing the updated Admin OTP producer. Mixed earlier worker versions cannot enforce the new Admin checks. Earlier unstamped Admin jobs are intentionally held failed; preserve records and request new codes rather than altering/replaying them.
- Do not manually configure `ADMIN_OTP_SELECTED_ENV_FILE` or `ADMIN_OTP_MISSING_AT_BOOT` on Render; they are nonsecret internal provenance markers generated at startup. Start fresh processes after correcting configuration. Merely filling an absent field in a running process does not restore a configuration pinned at startup.

Render's documented service/environment-group setup is at https://render.com/docs/configure-environment-variables . Service-specific values override matching linked-group values, so compare both API and separate-worker settings privately.

In each approved Render service shell, from `backend`, these commands are offline and safe to run without sending mail:

```sh
# API service (or API with embedded worker)
node scripts/checkAdminRegistrationReadiness.js --configuration-only

# Separate worker service
node scripts/checkAdminRegistrationReadiness.js --configuration-only --role worker
```

They were not run on Render here. After configuration checks pass, schema/aggregate inspection can be run read-only by omitting `--configuration-only`; it opens a database connection and never tests account creation/deletion or mail delivery. No such remote query was needed or run for this task. Independently confirm the existing verification/queue/rate-limit tables and unique email/admin-scope indexes in the intended database. There are no new migrations for this configuration change.

Live API authorization, sender verification and inbox delivery require a separately approved controlled test; none is claimed here. Existing three-admin limits remain enforced, and no existing admin should be removed to test OTP.

## Regression evidence and changed files

The targeted backend run passed **98 tests, zero failures/skips**. It covers Admin OTP configuration/creation, native staging preloading through actual entry-loader code, fallback rejection, inherited worker provenance, queued versus sent status, mocked Brevo acceptance/rejection, stale/replaced codes, configuration mismatches, ordinary queue behavior, shared OTP regressions, login/JWT/scope authorization and CORS. All transports/database operations were mocked or offline, and DB test defaults were forced to a closed loopback port. Log: `tmp/admin-otp-deployment-regression.log`.

Files added or updated for this follow-up:

- `backend/config/adminOtpEnvironment.js` (new Admin-only source/provenance view)
- `backend/services/adminOtpConfiguration.js` (new Admin-only validation/fingerprint)
- `backend/scripts/checkAdminRegistrationReadiness.js` (strict configuration-only and full readiness results)
- `backend/controllers/adminRegistrationController.js`, `backend/middleware/bootstrapGuard.js` (Admin-only gates)
- `backend/services/adminOtpQueue.js`, `backend/workers/emailQueueWorker.js` (Admin-only configuration binding/delivery checks)
- `backend/server.js`, `backend/config/database.js` (initialize Admin provenance before existing dotenv loading)
- `backend/tests/adminOtpConfiguration.test.js`, `backend/tests/adminOtpDelivery.test.js` (new offline/mocked tests)
- This guide and the historical environment-review pointer.

No frontend, shared email provider, shared OTP generation/template, Alumni/Employer workflow, environment file or credential was modified in this follow-up. No commit, deployment, permanent account deletion enablement or production setting change was performed.
