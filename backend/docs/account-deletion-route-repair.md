# Account deletion route and modal repair

**Release decision: NO-GO for enabling permanent production deletion.** Local fixes and mocked regression checks pass. The configured main MySQL 8.4.11 service still lacks the cleanup table/index, isolated MySQL 8.4 staging is unavailable, and the updated backend route revision has not been verified on Render. No production accounts, credentials, schema or settings were changed.

## Production 404 diagnosis and limits of the evidence

Both source paths are correct:

- `GET /api/admin/alumni/users/:userId/deletion-impact`
- `GET /api/admin/employer/users/:userId/deletion-impact`
- Corresponding `DELETE /api/admin/{scope}/users/:userId` with typed confirmation and preview token.

`ADMIN_SCOPE_META` supplies `/admin/alumni/users` or `/admin/employer/users`; the Axios base supplies `/api`. `server.js` mounts the parent router at `/api/admin`. The API client sends the stored valid bearer token for these authenticated requests and rejects missing local sessions before making a protected request. No administrator session was impersonated to test production.

The public Firebase HTML and entry asset were inspected read-only. The deployed bundle's API base is `https://djemc-alumni-backend.onrender.com/api`; the inspected entry was `/assets/index-BAL55n3d.js`. Thus the inspected deployed frontend does not point these requests at Firebase or use a doubled API prefix.

Anonymous requests to the reported Employer preview URL, the corresponding Alumni preview URL, and both list URLs currently return **401 JSON** with the correct Firebase CORS origin. They do not reproduce the reported authenticated HTML 404. An authentication middleware mounted on `/api/admin` can answer before a missing child route, so this is not proof that the deletion handlers are deployed.

The reported HTML 404 is inconsistent with the deletion controller in this checkout: it returns JSON for account-not-found, schema failures and all other handled errors. A missing cleanup table produces **503 JSON**, not an unmatched-route HTML 404. The evidence points to an unmatched serving route/deployment/proxy revision at the time of the failure. **The precise historical deployed cause/revision cannot be confirmed without the full authenticated failure URL/response and timestamp/deployment logs.** This is an explicit verification limit; no successful production preview or deletion is claimed.

A new anonymous GET-only probe checks a nonsecret `X-Account-Deletion-API:v1` marker that is emitted only when a registered deletion route is matched, before authentication. The inspected Render responses do not contain that marker, so the updated route contract remains unverified there. The probe never sends credentials, reads response bodies, or submits DELETE requests.

## Implemented changes

- Extracted the four deletion routes into `backend/routes/accountDeletionRoutes.js`, mounted before the general admin guards/fallback. Every route independently retains authentication, admin role and matching scope checks. The route marker allows a release to prove registration without using a real account/session.
- Added a JSON-only unknown-API-route fallback before static SPA handling. Missing `/api` routes return `404` with `API_ROUTE_NOT_FOUND`, rather than Express or frontend HTML. Existing route errors continue through their normal handlers; an existing missing account retains its controller JSON error.
- Added a scoped frontend deletion API helper. It distinguishes missing route/deployment responses from account-not-found errors, rejects successful HTML and malformed impact payloads before rendering, and keeps confirmation disabled after failure. It preserves authorization, schema and server error notifications.
- Preserved the API error content type for diagnosis. No error body, SQL, bearer token or credential is logged by these additions.
- Removed the requested long consequences/retention paragraphs from both deletion modals, including the Alumni-specific consequences paragraph. The modal retains account name/email/role, a short permanent warning, actual impact counts, concise preserved counts, exact typed DELETE, Cancel and Permanently Delete Account. Backend retention policy was not changed.
- Existing successful-deletion handling removes only the confirmed account from the correct scoped user list and leaves existing deactivate/reactivate/password-reset actions intact.

This does not make an absent deployed backend handler available merely by changing an error message. Deploying the full backend route/controller/service/model files and verifying their route marker remains necessary. Do not deploy only `adminRoutes.js` while omitting its new dependencies.

## Safety reviewed and tested

The real deletion service was exercised against in-memory Sequelize-compatible models and transaction rollback snapshots. These are mocked tests, not a substitute for MySQL transaction/FK acceptance:

- Correct Employer job/application ownership, without deleting applicant Alumni accounts or their saved resumes.
- Alumni applications/resumes removed while employer jobs, unrelated accounts and Registrar master records remain.
- All membership forms, including drafts and submitted forms, preserved and reassigned to protected identities as approved.
- Document revision links and retained interview notifications detached before child/parent deletion.
- Mandatory audit and durable private-file cleanup records in the same transaction.
- Late audit failure and a simulated final FK failure restore accounts, dependencies, identities, audit rows and cleanup records.
- Duplicate deletion requests return account-not-found after the first committed synthetic deletion.
- Unknown incoming dependencies and missing cleanup schema fail closed.
- Policy-disabled deletion remains refused before mutation.
- Cleanup retries failed provider operations with backoff, skips work until due, treats completed jobs as terminal, and retains still-referenced objects. External deletion was mocked; no real storage object was removed.

Existing passwordless/inactive deleted identities remain barred from login and signed-token authorization. Existing authentication/authorization regression tests passed. No FK checks or database constraints were disabled.

## Results

| Check | Result |
| --- | --- |
| Backend deletion/readiness/auth/scope/model regressions | **53 passed, zero failures** |
| Anonymous deployment-probe unit tests | **2 passed** |
| Frontend deletion-response/API/user-search regressions | **14 passed** |
| Both-scope desktop/mobile deletion modal fixture | **3 passed**, including parent test and both scope cases |
| Browser error coverage | HTML 404, JSON account 404, schema 503, scope 403, successful HTML fallback and general preview failures all remain safe; confirmation/deletion disabled |
| Browser lifecycle coverage | Correct preview/role/counts, exact DELETE, duplicate-send guard, failure retaining rows, synthetic success updating the correct list, and existing account actions |
| Requested paragraphs | Absent in both scope fixtures |
| Changed-file ESLint | Passed |
| Vite production build | Passed |

Logs are under `tmp/account-deletion-fix-{backend,frontend,browser,lint,build}.log`; targeted service/route logs are `tmp/account-deletion-workflow-tests.log` and `tmp/account-deletion-route-tests.log`. Tests use fake accounts, providers and transactions; production was used only for anonymous public HTTP checks and metadata-only database reads.

## Database and infrastructure readiness

A fresh read-only check using `backend/.env` found MySQL **8.4.11**, with `account_deletion_files` **absent** and its due index **absent**. Local configuration does not enable `ACCOUNT_DELETION_POLICY`. Storage credential presence was reported, but actual deployed worker configuration, provider permissions and successful cleanup are unverified.

`backend/.env.staging` still targets a local service that returns `ECONNREFUSED`; its cleanup storage credentials are absent. No isolated MySQL 8.4 test service was available. No MariaDB result is treated as equivalent, and no production account/schema was used as a staging fixture. The true database integration harness was not enabled.

The schema and running worker must be ready before permanent deletion can be enabled. Keep the policy unset until the existing approval, backup, genuine MySQL 8.4 staging, schema, worker and monitoring prerequisites are satisfied. The source does not automatically enable deletion or start its cleanup worker.

## Operator verification and deployment checklist

1. Review the complete backend/frontend changes and dependencies; obtain deployment approval separately. Keep `ACCOUNT_DELETION_POLICY` unset on both API and cleanup worker during rollout.
2. Before any approved migration, verify the intended target privately, take a consistent backup/PITR recovery point, and test restore. Preserve separate external-object backups/version retention. Code rollback cannot restore deleted accounts or files.
3. Establish isolated MySQL 8.4 staging and run the guarded database fixture there. Do not point it at the main remote `.env` database or claim success from a skipped test.
4. Apply only the already reviewed additive cleanup migration after backup/staging/approval. Do not replay historical migrations. From `backend`, the check-only command is `node scripts/applyAccountDeletionMigration.js`. The separately approved apply shape is `node scripts/applyAccountDeletionMigration.js --apply --host REVIEWED_HOST --database REVIEWED_DATABASE`. **Apply was not run here.** See the existing readiness guide for CA/config/backup details.
5. Deploy matching backend/frontend revisions containing the complete deletion implementation. Verify read-only route registration:

```sh
# From backend; anonymous GET only, no user-account mutation or response bodies.
node scripts/checkAccountDeletionRoutes.js
# Require routeContractVerified:true, both 401 JSON and versionMarker:v1.
```

6. Verify schema and worker readiness using existing read-only checks in the intended runtime:

```sh
node scripts/applyAccountDeletionMigration.js
node workers/accountDeletionCleanupWorker.js --check
```

For a private local configuration-file metadata check from the repository root, use `node backend/scripts/checkAccountDeletionReadiness.js --env-file backend/.env`. This does not establish Render environment or worker state.

7. Verify authenticated read-only previews in the correct admin scope, using the browser's existing authorized session. Distinguish a JSON missing account from a missing API endpoint; preserve the failure URL, response type and deployment revision if it still fails. Never use a real production account for deletion testing.
8. Only after all readiness gates and explicit approval, configure the retention policy and separately managed cleanup worker. Confirm exact target counts and typed DELETE for each later authorized real deletion. Do not turn on deletion as part of this repair task.

See [the existing production readiness checklist](account-deletion-production-readiness.md) and [the dependency map/approved retention policy](account-deletion.md). No migration, enablement, destructive production operation, deployment or commit was executed.

## Files changed in this repair

Backend: `routes/accountDeletionRoutes.js`, `routes/adminRoutes.js`, `middleware/apiNotFound.js`, `server.js`, `scripts/checkAccountDeletionRoutes.js`.

Frontend: `features/settings/components/AccountDeletionModal.jsx`, `features/settings/utils/accountDeletionApi.js`, and `services/api.js`.

Tests: `backend/tests/helpers/accountDeletionFixture.cjs`, `accountDeletionWorkflow.test.js`, `accountDeletionRoutes.test.js`, `accountDeletionRouteProbe.test.js`, `frontend/alumni-portal/tests/accountDeletionApi.test.js`, and the existing deletion browser fixture. The approved service, retention policy, cleanup worker, schema migration and environment files were not changed by this repair.
