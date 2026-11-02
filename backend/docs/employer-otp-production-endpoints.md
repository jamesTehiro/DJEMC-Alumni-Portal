# Employer OTP production endpoint release

Investigation and local repair: November 3, 2026. No commit, push, deployment, production settings/schema/record change, or real OTP email was performed.

## Root cause and evidence

The deployed Firebase frontend already contains the Employer OTP integration. Its downloaded `/assets/EmployerRegisterPage-PpMnaPGy.js` uses `/auth/employer-registration-otp`; the deployed entry bundle contains `https://djemc-alumni-backend.onrender.com/api`. The public JavaScript scan found no local API URL. The problem is not an obsolete Firebase API base URL.

GitHub `main`'s `backend/routes/authRoutes.js` was inspected through the connected GitHub reader. Its file blob SHA was `e81c540a40939d2b1db276a809674e1e193240f2`. It contains the Alumni routes but none of the four Employer OTP routes. The local working copy adds those four routes; their controller, service and worker dependencies are also local changes. Thus the frontend has been published ahead of the compatible backend source release. The reported production POST 404 `API_ROUTE_NOT_FOUND` is consistent with that missing backend release, not a Brevo delivery failure.

Source: https://github.com/jamesTehiro/DJEMC-Alumni-Portal/blob/main/backend/routes/authRoutes.js

Public artifact evidence: `tmp/employer-otp-production-inspection.json` and `tmp/employer-otp-public-assets/`. No OTP operation was submitted to production. GET requests to both Employer and Alumni status URLs return 404 because these operations are POST-only; those GET responses alone cannot establish whether a POST handler exists. The production POST result is the user's reported evidence. Render's active commit/settings were not privately accessible, so a particular Render deployment SHA is not claimed to be verified.

The required fix is to commit and deploy the COMPLETE compatible backend implementation, including the existing local Employer routes and their service/worker dependencies. A frontend URL workaround cannot add missing server handlers.

## Exact contract and environment trace

All four requests use the existing shared Axios API client:

```text
POST https://djemc-alumni-backend.onrender.com/api/auth/employer-registration-otp/send
POST https://djemc-alumni-backend.onrender.com/api/auth/employer-registration-otp/resend
POST https://djemc-alumni-backend.onrender.com/api/auth/employer-registration-otp/verify
POST https://djemc-alumni-backend.onrender.com/api/auth/employer-registration-otp/status
```

`EmployerRegisterPage` selects `/auth/employer-registration-otp` in `useRegistrationOtp`. The hook appends each operation and uses `api.post`, including restoration and five-second delivery polling. Alumni retains the hook's default `/auth/registration-otp` prefix and existing behavior. The API base supplies `/api`; the page/hook must not append a second `/api`.

The browser generates a 32-byte random session token, stores its email/token pair in Employer-specific sessionStorage, and sends that same token with send, status, resend and verify. Changing the email clears verification. Only the verified Employer proof and matching session authorize the final multipart registration; backend account/profile/permit creation and proof consumption remain transactional. OTP hashes, five-minute expiry, ten-minute grant, five-attempt limit, cooldown/resend limits, cross-purpose binding and rate limiting remain intact.

The Employer service uses the existing registration OTP factory with purpose `employer-registration`, shared queue adapter, queue table, worker and Brevo adapter. The matching worker must reject expired/replaced/mismatched Employer jobs. Alumni and Admin flows remain separate in purpose/session/grant authorization. No second API client or mail provider was added.

Frontend environment inspection found no `.env` or `.env.local`; `.env.production` contains the correct public `VITE_API_BASE_URL`, and `.env.production.local` is absent. Vite development retains its localhost API fallback/proxy. Production uses the compiled VITE setting or the tracked Render default. Environment variables in a running Render backend cannot retroactively change a Firebase JavaScript bundle.

Backend startup mounts `authRoutes` at `/api/auth` in `server.js`, and starts with `npm start` -> `node server.js`. The shared dotenv loader defaults to `backend/.env` while preserving supplied process variables. `.env.staging` is not automatically selected, and Render needs its own runtime settings. No environment file or secret was changed or copied. No environment files should be staged, including the ignored frontend `.env.production`; the tracked fallback is sufficient when building without that file.

## Changes in this endpoint repair

- `frontend/alumni-portal/src/services/apiConfiguration.js` (new): shared production URL validation/default.
- `frontend/alumni-portal/src/services/api.js`: retain the existing client; validate its production base URL.
- `frontend/alumni-portal/vite.config.js`: refuse builds targeting local/IP/Firebase addresses, HTTP, credential/query URLs or an incorrect API prefix.
- `frontend/alumni-portal/src/features/registration/hooks/useRegistrationOtp.js`: Employer-only missing-route notification; preserve it during restored-session checks and avoid a redundant recovery request after a known missing route. Alumni errors and verification rules are unchanged.
- `frontend/alumni-portal/src/features/registration/pages/EmployerRegisterPage.jsx`: show restored-session API errors even while the OTP modal is closed.
- `frontend/alumni-portal/tests/apiConnection.test.js`: production base/method/path/session checks for both roles and invalid production configuration cases.
- `frontend/alumni-portal/tests/employerRegistrationOtp.browser.test.js`: enforce Render origin/POST, token continuity, reload restoration and distinct missing-route messages.
- `frontend/alumni-portal/scripts/checkProductionOtpBuild.mjs` (new): inspect built JavaScript for Render targeting, both OTP prefixes and incorrect API URLs.
- `backend/tests/registrationOtpApi.test.js`: exercise all eight scoped POST routes, session forwarding, GET rejection and rate limits.
- `backend/scripts/checkEmployerOtpRoutes.js` (new): inspect the installed router/handler bindings and server mount, without executing OTP handlers, connecting to the database or sending mail. It prints route names and a validated revision SHA only.
- `backend/docs/employer-otp-production-endpoints.md` (new): this report and separate release commands.

The pre-existing local Employer OTP implementation must ship with these checks. Its complete runtime dependency set is included explicitly in the backend/frontend Git commands below. Other working-tree dashboard, messaging, job/application and User Management changes must remain unstaged.

## Validation

- Backend endpoint/OTP/Employer permit/Admin/CORS/worker regressions: **71 passed, 0 failed** (`tmp/employer-otp-endpoint-backend-final.log`). All database/email operations used fixtures/mocks; no production OTP calls.
- Frontend API/configuration/validation units: **11 passed, 0 failed** (`tmp/employer-otp-endpoint-unit-final.log`). All four operations for both roles use POST, Render and the same session.
- Read-only installed route check: **passed**, all eight Alumni/Employer POST routes and existing middleware/handler bindings (`tmp/employer-otp-endpoint-route-check.log`).
- Changed frontend ESLint checks: **passed** (`tmp/employer-otp-endpoint-lint.log`).
- Production `vite build --mode production`: **passed** (`tmp/employer-otp-endpoint-build.log`).
- Built JavaScript inspection: **passed** (`tmp/employer-otp-endpoint-bundle-check.log`).
- Employer/Alumni/Admin/registration browser regressions: final result pending in `tmp/employer-otp-endpoint-browser.log`. An initial unprivileged browser launch timed out before UI checks; the final run uses local browser permissions and blocked/intercepted external requests.

## Backend Git and Render release commands — only after approval

These commands assume the inspected current branch is still `main`, with no previously staged work. Review the selective diff before committing. Pushing `main` may trigger Render auto-deploy. If branch protection requires a PR, use the normal PR process instead of pushing directly. None of these Git mutations was executed by Codex.

From PowerShell:

```powershell
Set-Location C:\Alumni
if ((git branch --show-current) -ne 'main') { throw 'Review the intended release branch before continuing.' }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw 'Review existing staged changes before selectively staging this release.' }
git add -- backend/controllers/authController.js backend/controllers/registrationOtpController.js backend/routes/authRoutes.js backend/services/registrationOtp.js backend/services/registrationOtpQueue.js backend/services/employerOtpQueue.js backend/services/adminOtpQueue.js backend/workers/emailQueueWorker.js backend/tests/employerRegistrationOtp.test.js backend/tests/registrationOtpApi.test.js backend/tests/employerPermitWorkflow.test.js backend/scripts/checkEmployerOtpRoutes.js backend/docs/employer-registration-otp.md backend/docs/employer-otp-production-endpoints.md
git diff --cached --check
git diff --cached --stat
git commit -m "Deploy Employer Gmail OTP routes and matching queue support"
$employerOtpBackendCommit = git rev-parse HEAD
git push origin main
```

After approval, deploy that backend commit in Render (auto-deploy if enabled, otherwise Manual Deploy / Deploy latest commit). Required service settings: Root Directory `backend`, Build Command `npm ci`, Start Command `npm start`. These are expected settings to confirm, not a claim that Render's private configuration was inspected or changed.

Render must supply the existing DB/TLS settings, JWT secret, stable `REGISTRATION_OTP_SECRET` of at least 32 bytes, `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, real Brevo-authorized `EMAIL_FROM`, and `EMAIL_FROM_NAME`. Keep secrets private. No Admin bootstrap secret is required for Employer OTP. The existing OTP/queue/rate-limit/normalized-email schema must already satisfy startup readiness; this repair requires no new schema or migration and does not authorize applying old migrations or enabling DB sync.

Deploy the compatible worker too. The embedded worker inherits the API environment; if disabled with `EMAIL_WORKER_ENABLED=false`, a separately managed existing email worker must run the matching commit with the same DB/mail configuration. Deploy the matching worker before exposing an Employer producer to prevent an old worker from treating these messages as unguarded ordinary mail. Do not create another queue/worker for this feature.

In the deployed backend's Render Shell, after approval, check the installed release without generating OTPs:

```text
node scripts/checkEmployerOtpRoutes.js
```

Match the reported `sourceRevision` / Render deployment revision with `$employerOtpBackendCommit`. If the script is absent, this is the wrong source release. Confirm the existing worker is running and startup readiness passes. Do not use GET or generic CORS OPTIONS success as proof that POST status is available. Test POST operations on isolated staging with mocks; do not submit send/resend requests against production under this task's authorization.

## Separate frontend Git/build/Firebase release — after compatible backend readiness

Do this only after reviewing/approving the backend deployment and worker. Frontend sources are committed separately; environment files, `.firebase` cache files, `dist`, logs, uploads and `tmp` artifacts are excluded.

```powershell
Set-Location C:\Alumni
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw 'Review existing staged changes first.' }
git add -- frontend/alumni-portal/src/services/api.js frontend/alumni-portal/src/services/apiConfiguration.js frontend/alumni-portal/vite.config.js frontend/alumni-portal/src/features/registration/pages/EmployerRegisterPage.jsx frontend/alumni-portal/src/features/registration/hooks/useRegistrationOtp.js frontend/alumni-portal/src/features/registration/components/RegistrationOtpModal.jsx frontend/alumni-portal/tests/apiConnection.test.js frontend/alumni-portal/tests/employerRegistrationOtp.browser.test.js frontend/alumni-portal/tests/registrationValidation.browser.test.js frontend/alumni-portal/scripts/checkProductionOtpBuild.mjs
git diff --cached --check
git diff --cached --stat
git commit -m "Validate production API targeting and Employer OTP deployment errors"
git push origin main
Set-Location C:\Alumni\frontend\alumni-portal
npm.cmd ci
$env:VITE_API_BASE_URL='https://djemc-alumni-backend.onrender.com/api'
npm.cmd run build -- --mode production
node scripts/checkProductionOtpBuild.mjs
# Execute only after approval and after every command above succeeds:
firebase.cmd deploy --only hosting --project djemc-alumni-portal
```

If the Firebase CLI is unavailable, use the project's established authenticated Firebase CLI installation; no CLI install/login or deployment was performed here. A Git push does not itself publish Firebase unless separately configured CI does so. A frontend-only deploy cannot repair the missing backend routes.

After approved deployment, inspect the public served assets and the installed backend route/revision check again. Live production OTP/inbox delivery remains unverified until separately authorized; do not claim production is fixed solely from the local build or mock tests.
