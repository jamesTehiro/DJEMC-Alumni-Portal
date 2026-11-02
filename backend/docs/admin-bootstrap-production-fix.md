# Admin setup-status production 503 repair

## Observed cause and deployment status

The public production endpoint was read without credentials on 2026-11-02:

```text
GET https://djemc-alumni-backend.onrender.com/api/auth/admin-setup-status
503 application/json
{"msg":"Admin bootstrap is not configured."}
```

This exact response identifies the `ADMIN_BOOTSTRAP_SECRET` configuration rejection in `bootstrapGuard.js`. In the committed version the condition is a missing/blank secret; the earlier local guard also rejected placeholders with that text. The committed `authRoutes.js` mounts the guard on the status GET. The guard checks the secret **before** counting admin accounts; therefore even a database already containing all three admins receives 503. Neither the three-account limit nor Brevo readiness produces that response. The local newer status controller does not emit that text, confirming that its behavior is not yet reflected by the observed production response.

Render's private environment dashboard, running process and deployed revision were not accessible. The application-visible failing setting is the bootstrap secret, but it is not possible here to distinguish an absent dashboard entry, a blank/placeholder value, an unapplied environment change or an older deployment reading a different environment. No secret value was retrieved or printed. The production admin count is supplied by the owner; no production account query/login test was performed.

**Local repair only; production is not claimed fixed.** A reviewed Render backend deployment and frontend Firebase deployment are required. No settings, accounts, passwords, schema, email workflows or production records were changed. No real email was sent, and nothing was committed or deployed.

## Resulting behavior

- `GET /api/auth/admin-setup-status` is a read-only count/scope query, independent of the bootstrap guard and OTP/rate-limit tables. Existing global request limiting still applies. All registration mutations retain their database-backed rate limits, bootstrap authorization and OTP checks.
- A successful database query returns HTTP 200 even when registration configuration is unavailable. `registrationAvailable`, `registrationReason`, `registrationConfigured`, `bootstrapConfigured` and `otpConfigured` distinguish capacity and configuration.
- Three or more admin rows, including legacy or pending rows, report `ADMIN_LIMIT_REACHED`, `setupComplete:true`, `registrationAvailable:false` and no available scopes. Capacity takes precedence over missing registration configuration. No fourth account is allowed.
- With a vacant scope, missing/placeholder bootstrap settings report `ADMIN_BOOTSTRAP_UNAVAILABLE`; incomplete/invalid OTP mail or signing configuration reports `ADMIN_OTP_UNAVAILABLE`; other configuration failures report `ADMIN_REGISTRATION_UNAVAILABLE`. Configuration values and account identifiers are not returned.
- A failed count query returns HTTP 503 with `ADMIN_STATUS_UNAVAILABLE` and `loginAvailable:null`. It does not pretend the database or login was tested successfully.
- On successful count queries, `loginAvailable` indicates whether the existing JWT signing setting is present; it is capability information, not a credential test or guarantee of successful authentication. A valid account/password, existing JWT configuration and database remain required.
- Login remains `POST /api/auth/login`. It does not invoke bootstrap readiness, registration availability or mail delivery. The existing verified-account, password, JWT, current account-state and administrative scope checks remain in place. No login source change was necessary for this repair.
- The frontend displays registration availability separately from login errors, including the older deployed bootstrap error. Login inputs and submit remain usable while status fails, registration is disabled or the limit is reached. Generic backend failures invite a login attempt without promising that an unavailable backend can authenticate.
- Every Admin mutation checks capacity in the guard and creation checks it again under the existing SERIALIZABLE transaction/row lock. A full system rejects creation/OTP operations with 409 `ADMIN_LIMIT_REACHED`; partial setup still rejects missing/incorrect secrets and requires the existing admin-specific verified OTP grant.

## Configuration responsibilities

| Capability | Required configuration |
| --- | --- |
| Existing verified administrator login | Existing production database connection/TLS/schema, stable `JWT_SECRET`; existing optional `JWT_EXPIRES_IN`. Bootstrap/OTP/Brevo settings are not login prerequisites. |
| Read-only admin setup availability | Existing database/User schema; bootstrap and Brevo are not prerequisites. |
| New Admin registration in a vacant scope | `ADMIN_BOOTSTRAP_SECRET`, `REGISTRATION_OTP_SECRET` (stable random material of at least 32 bytes), all four mail settings below, existing database/schema/unique indexes and successful Admin OTP verification. |
| Admin OTP delivery | `EMAIL_PROVIDER=brevo`, existing private `BREVO_API_KEY`, valid Brevo-authorized `EMAIL_FROM`, `EMAIL_FROM_NAME`; existing durable queue and a running compatible email worker. API additionally requires the two registration secrets. |
| Separate email worker | Same four Brevo settings and database target/user as API. It does not need bootstrap or OTP signing secrets merely to deliver. Embedded workers inherit API settings. |

Do not add bootstrap or mail settings merely to restore login to an already complete three-admin portal. Deploy the corrected status behavior; registration can remain unavailable intentionally. Supplying all configuration does not remove capacity limits.

The existing source capture in `adminOtpEnvironment.js` remains unchanged: default local startup loads `backend/.env`; `.env.staging` is selected only by explicit preloading. In production, Admin configuration is pinned to startup runtime values and cannot silently borrow missing fields from a later default `.env` load. No environment files, loaders, shared provider or Alumni/Employer workflows were modified in this repair.

The offline check of the current `.env.staging` selected it correctly but failed on missing `ADMIN_BOOTSTRAP_SECRET` and placeholder `BREVO_API_KEY`, `REGISTRATION_OTP_SECRET` and `EMAIL_FROM`. This is local evidence only; it is not an inspection of Render.

Render does not automatically load this local staging file. Required production values must be set privately on the intended API service and, if separate, worker service or reviewed shared environment group. Preserve existing approved values and never upload/commit staging secrets. A service-specific setting overrides its linked environment group, and saved environment changes only become effective on deployment. See [Render environment variables and secrets](https://render.com/docs/configure-environment-variables).

## Safe deployment verification

1. Review the complete pending Admin implementation and dependencies before deployment; earlier local OTP changes are also uncommitted. Deploying only the route file while omitting required controllers/services will fail. No new migration or environment variable is introduced by this status repair. The status handler itself queries only Users. The existing server startup still validates shared OTP/normalized-email/rate-limit schema, so that schema must already be ready before deploying the complete pending backend. These existing global startup checks were inspected and left unchanged to preserve the shared registration workflows. No migration was applied here.
2. No account deletion, password change or admin recreation is required. Do not change existing JWT keys, mail credentials or unrelated account workflows. Keep permanent account deletion disabled under its separate readiness requirements.
3. Deploy the approved backend to Render and frontend to Firebase. Do not change production environment settings without separate approval. If bootstrap intentionally remains absent, existing verified login must remain usable and registration must remain closed.
4. From an approved Render API shell in `backend`, the existing offline command reports field names/reasons without credentials, database changes or mail:

```sh
node scripts/checkAdminRegistrationReadiness.js --configuration-only
```

Nonzero here means **registration** configuration is not ready; it does not mean existing login is unavailable. If registration is intended in a genuinely vacant scope, configure the missing fields privately and restart/deploy; a running process retains its startup provenance.

5. For a separate worker, the corresponding offline check is:

```sh
node scripts/checkAdminRegistrationReadiness.js --configuration-only --role worker
```

This only checks configuration; it does not establish a running worker or Brevo/inbox acceptance. Do not send an OTP to a production account for testing.

6. Verify the deployed status with this anonymous read-only command (Node 22+):

```sh
node -e "fetch('https://djemc-alumni-backend.onrender.com/api/auth/admin-setup-status').then(async r=>{const d=await r.json();console.log(JSON.stringify({http:r.status,adminCount:d.adminCount,loginAvailable:d.loginAvailable,registrationAvailable:d.registrationAvailable,registrationReason:d.registrationReason}));process.exitCode=r.status===200&&d.adminCount===3&&d.registrationAvailable===false&&d.registrationReason==='ADMIN_LIMIT_REACHED'?0:1}).catch(()=>{console.error('Status verification failed');process.exitCode=1})"
```

Expected for the owner's three existing accounts: HTTP 200, `adminCount:3`, `registrationAvailable:false`, `registrationReason:ADMIN_LIMIT_REACHED`. `loginAvailable:true` requires the existing JWT setting. Preserve the response status/revision if it still fails. Do not use registration/DELETE endpoints as deployment probes.

7. Confirm the login form remains enabled and displays a separate registration notice. Any real administrator sign-in should be performed by its owner. Automated checks below use synthetic accounts and mocked database/email providers; no production credentials or account mutations are needed.

## Files changed for this repair

Backend: `services/adminSetupStatus.js` (new safe capability response), `controllers/adminRegistrationController.js` (status handling), `middleware/bootstrapGuard.js` (capacity precedence/error handling), `routes/authRoutes.js` (public read-only status independent of OTP store).

Frontend: `src/features/auth/pages/AdminPortalPage.jsx`, `src/features/auth/utils/adminSetupStatus.js` (new registration notice helper).

Tests: `backend/tests/adminBootstrapAvailability.test.js`, `frontend/alumni-portal/tests/adminSetupStatus.test.js`, `frontend/alumni-portal/tests/adminPortal.browser.test.js`.

Documentation: this report and the deployment guide pointer. `authController.js`, `adminOtpConfiguration.js`, `adminOtpEnvironment.js`, `server.js` and the shared email/OTP workers were inspected and left unchanged for this repair.

## Validation

Backend regression run: **86 passed, zero failures/skips**, covering missing bootstrap, missing/invalid OTP settings, full capacity, fourth-registration rejection, independent existing admin login/JWT, shared registration OTP, queue delivery protections, Alumni/Employer authentication, scope authorization and CORS. The seven new route/login tests also run independently after their final test-fixture adjustment.

| Check | Final result | Evidence |
| --- | --- | --- |
| Backend Admin/configuration/OTP/auth/scope regressions | 86 passed, zero failures/skips | `tmp/admin-bootstrap-regression.log` |
| New backend route/login tests after final fixture adjustment | 7 passed | `tmp/admin-bootstrap-targeted.log` |
| Frontend notice/API unit tests | 7 passed | `tmp/admin-bootstrap-frontend-unit.log` |
| Admin Portal browser regressions | 5 passed, zero failures | `tmp/admin-bootstrap-admin-browser.log` |
| Existing Alumni OTP browser regressions | All 3 cases passed | `tmp/admin-bootstrap-browser.log` |
| Changed frontend files ESLint | Passed | `tmp/admin-bootstrap-lint.log` |
| Vite production build | Passed, exit 0 | `tmp/admin-bootstrap-build.log` |

Initial browser attempts exposed fixture session leakage, counting CORS preflights as login submissions, and a moving mocked OTP expiration. Those test-fixture defects were corrected; the final Admin browser log above is authoritative. The combined initial browser log still contains the earlier Admin fixture failures alongside the three passing Alumni cases. The application/shared OTP implementation was not changed to make tests pass. The login notice screenshot is `tmp/admin-bootstrap-login.png` and was visually reviewed.

All test accounts/providers are synthetic or mocked; database defaults were forced to a closed loopback port. Production was used only for anonymous status GETs. There are no database integration or real Brevo delivery claims for this repair. No production credentials or email sender values were printed.
