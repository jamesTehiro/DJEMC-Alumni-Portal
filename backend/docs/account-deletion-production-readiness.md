# Delete Account production readiness — 2026-11-02

**Decision: NO-GO. Permanent deletion has not been enabled.**

This report supplements [the dependency map and approved retention policy](account-deletion.md). All membership forms, including drafts, are retained under a protected inactive identity. Employer deletion removes only its jobs and dependent applications, not applicant accounts. Alumni deletion removes its private applications/resumes while preserving employer jobs and Registrar master records. Shared content and institutional/audit records are retained.

## Evidence and blockers

| Requirement | Result |
| --- | --- |
| Configured database engine | Read-only queries through `backend/.env` confirmed MySQL **8.4.11**, with verified CA/TLS. No account rows were queried. |
| Isolated MySQL 8.4 staging | **BLOCKED.** `.env.staging` points to an unreachable local service (`ECONNREFUSED`). No native MySQL server or Docker was found. Ubuntu WSL was listed but timed out on inspection. The main remote `.env` was not confirmed isolated and was protected from fixture creation, migrations and deletions. |
| Required cleanup schema on main remote database | **Missing.** `account_deletion_files` and its due index are absent. Check-only migration and worker commands correctly report not ready. |
| Feature disabled | Main local `.env` and current shell do not enable the policy. Worker read-only preflight reports `policyEnabled:false`, `canStart:false`. Source rejects deletion before any DB transaction when policy is unset. **Actual deployed Render environment/revision is unverified.** |
| Worker | Source/configuration checks and simulated provider outcomes pass. Durable retries/crash recovery were previously exercised on MariaDB fixtures; they have **not** been accepted on isolated MySQL 8.4. Actual deployed worker and Cloudinary deletion permissions remain unverified. |
| Protected identity authentication | Login and signed-token tests pass, including a `deleted` identity whose status is accidentally changed to `verified`. Role rejection is explicit. |
| Account relationships and retention | Reviewed source and prior disposable MariaDB evidence support both deletion paths, drafts and shared history. MySQL 8.4 coverage now also explicitly checks submitted membership content and identity login/token rejection, but **has not run**. |
| Full backend regression | 568 passed, 2 failed, 19 skipped (589 tests). Both failures reproduce with committed authentication middleware: Graduate Tracking major API and announcement targeting notification workflow. They are not treated as passing. |
| Focused readiness/auth/model tests | 31 passed, zero failures. Includes interrupted-index repair, schema/type/engine checks, disabled worker, strict provider outcomes, identity authentication, and certificate verification. |
| Frontend regression | 60 passed, 3 failed (63 tests). The three membership-management failures use tests and implementation identical to `HEAD`: status filter, response validation and table headers. Resolve or separately review these baseline failures before release. |
| Deletion browser fixture | 3 passed (both scopes, desktop/mobile, preview failure/policy gating, exact confirmation, duplicate requests, failed row retention and existing account actions). |
| Production build | Vite production build passed. |

No MariaDB result is counted as MySQL 8.4 acceptance. No production migration, account mutation, storage deletion, deployment, commit or enablement was performed.

## Exact change inventory

One additive migration: `migrations/20261102-create-account-deletion-files.js`.

One new InnoDB table: `account_deletion_files`.

| Column | MySQL definition |
| --- | --- |
| id | INT NOT NULL AUTO_INCREMENT PRIMARY KEY |
| reference | TEXT NOT NULL |
| status | VARCHAR(24) NOT NULL DEFAULT 'pending' |
| attempts | INT NOT NULL DEFAULT 0 |
| next_attempt_at | DATETIME NOT NULL |
| last_error | VARCHAR(80) NULL |
| createdAt | DATETIME NOT NULL |
| updatedAt | DATETIME NOT NULL |

One nonunique index: `account_deletion_files_due(status, next_attempt_at)`. No existing table columns, foreign keys, cascade rules, user roles or records are migrated. The explicit runner does not replay historical migrations or update `SequelizeMeta`. It verifies types, nullability, defaults, primary key, engine and the complete nonunique index. Repeating it repairs an interrupted missing-index step without recreating the table; incompatible existing definitions are rejected.

MySQL DDL implicitly commits, so the table-create and index-create steps must not be described as a rollbackable multi-statement transaction. The repeatable preflight/recovery checks are deliberate. See the [MySQL 8.4 implicit commit documentation](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html).

Readiness review also removed duplicate npm script keys, aligned the model index name, added a worker check-only mode and fail-fast storage/schema validation, and enabled CA/server-identity verification for production application, migration and worker database connections. These source changes have not been deployed.

## Configuration inventory

| Configuration | Requirement |
| --- | --- |
| ACCOUNT_DELETION_POLICY | New feature/worker gate. Keep **unset** until all prerequisites and explicit enablement approval exist. Approved value is `retain-memberships-v1`. |
| ACCOUNT_DELETION_PROTECTED_IDS | Optional new comma-separated positive IDs of additional protected accounts. Admin/self/other-role/deleted targets are always rejected. |
| DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS | Existing database credentials, supplied through the deployment secret store. Verify target identity privately before any apply command. |
| NODE_ENV | `production` for deployed backend and worker; `test` for disposable integration fixtures. |
| ENABLE_DB_SYNC | Existing setting must remain false/unset. Never use sync/alter to migrate production. |
| DB_CA_FILE | Optional existing CA-path convention, now used by production application and deletion utilities. Defaults to `backend/cert/ca.pem`. Include the correct Aiven CA in deployment. Certificate/hostname verification stays enabled. |
| MIGRATION_DB_CA_FILE | Existing optional CA-path override for deletion migration/worker utility connections. This runner uses the configured DB_* target, not a second set of MIGRATION_DB_* credentials. |
| JWT_SECRET | Existing backend signing secret, also used for ten-minute actor/target/role/policy-bound preview tokens. |
| OBJECT_STORAGE_PROVIDER | Existing provider setting; only Cloudinary is supported (default `cloudinary`). |
| CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET | Existing server-side secrets required by the cleanup worker. Presence is verified; deployed permissions and real staged deletion remain unverified. Never put these in Vite variables. |
| Frontend | No new secret or feature flag. Retain the existing production API URL configuration. Backend is authoritative. |
| RUN_ACCOUNT_DELETION_DATABASE_TESTS | Test-only opt-in. |
| ACCOUNT_DELETION_REQUIRE_MYSQL84 | Test-only strict engine gate. Set `true` for production acceptance. MariaDB is rejected before fixture schema creation. |
| ACCOUNT_DELETION_TEST_ISOLATED | Test-only acknowledgement required in strict mode; must be `true` only for a confirmed separate disposable service. |
| ACCOUNT_DELETION_TEST_PORT / USER / PASSWORD | Test-only loopback fixture connection (defaults port 3311, user root). Supply secrets securely; never use the production service behind this connection. |

No env file was edited during readiness verification. Never infer Render's effective environment from a local file.

## Worker operation

Use a separately managed process with the same reviewed database and storage namespace as the backend:

```powershell
Set-Location C:\Alumni\backend
npm.cmd run account-deletion-cleanup -- --check
```

`--check` reads configuration and schema only, even when the feature gate is unset; it never reserves jobs or calls a storage delete API. After a reviewed migration and while the gate remains unset, expect `cleanupSchemaReady:true`, `policyEnabled:false`, `canStart:false`. Missing storage configuration or schema prevents processing attempts.

After explicit production approval only, the worker's managed start command is `npm run account-deletion-cleanup`. Do not run it during this investigation. Policy must be approved in both backend and worker environments.

Entries are leased for 15 minutes; expired leases resume after crashes. State writes include lease attempt ownership. Retry delays grow exponentially; ten failed attempts go to manual review. Cloudinary `ok` and `not found` are idempotent success; HTTP/provider errors are retried. Reference scans include retained messages, membership JSON and snapshots. Still-referenced files are retained. Untrusted photo/snapshot ownership and unsupported references require manual review. Local files require the actual shared/persistent upload filesystem; a separate ephemeral Render disk cannot clean another service's files. Verify volume access, or hold legacy local-path entries for manual review. Assess scan duration at staging scale and do not introduce new references to retired objects during cleanup.

Monitor without exposing private references:

```sql
SELECT status, COUNT(*) AS jobs, MAX(attempts) AS max_attempts,
       MIN(next_attempt_at) AS earliest_due
FROM account_deletion_files GROUP BY status;
SELECT id, status, attempts, next_attempt_at, last_error
FROM account_deletion_files
WHERE status IN ('pending','processing','manual_review') ORDER BY id LIMIT 100;
```

## Ordered production checklist and exact commands

All apply/backup/deployment/enablement commands below are **operator instructions, not actions performed in this session**. Replace uppercase placeholders with independently reviewed target information. Check every exit code. Keep secrets out of command history and logs.

1. Confirm a **separate** MySQL 8.4 staging service and a dedicated Cloudinary staging namespace. Create no test users in the main database. Connect a verified isolated server on loopback (or a tunnel to that isolated service), then run:

```powershell
Set-Location C:\Alumni\backend
$env:NODE_ENV='test'
$env:RUN_ACCOUNT_DELETION_DATABASE_TESTS='true'
$env:ACCOUNT_DELETION_REQUIRE_MYSQL84='true'
$env:ACCOUNT_DELETION_TEST_ISOLATED='true'
$env:ACCOUNT_DELETION_TEST_PORT='3312'
# Set ACCOUNT_DELETION_TEST_USER and ACCOUNT_DELETION_TEST_PASSWORD securely.
node --test tests/accountDeletionDatabase.integration.test.js
```

The test uses a new `djemc_account_deletion_*_test` schema, rejects an incorrect engine before creating it, and retains synthetic fixtures for review. It never reads `backend/.env` as a test target. Preserve evidence of VERSION(), migration repeatability, rollback, concurrent delete protection, both role paths, membership drafts/submissions, Registrar retention, identity login/token denial, shared history and retry recovery. Simulated provider failures do not establish actual Cloudinary delete permissions: test only disposable staged uploads separately.

2. Resolve/review the baseline regression failures and rerun tests. Use bounded concurrency:

```powershell
Set-Location C:\Alumni\backend
# Prevent accidental network DB access in mocked regression tests.
$env:DB_HOST='127.0.0.1'; $env:DB_PORT='1'
$env:DB_NAME='account_deletion_no_network_test'
$env:DB_USER='fixture'; $env:DB_PASS='fixture'
Remove-Item Env:RUN_ACCOUNT_DELETION_DATABASE_TESTS -ErrorAction SilentlyContinue
node --test --test-concurrency=2 tests/*.test.js
Set-Location C:\Alumni\frontend\alumni-portal
$env:PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests/accountDeletion.browser.test.js tests/adminUserSearch.test.js tests/messageSendRequest.test.js tests/membershipManagement.test.js tests/membershipApplication.test.js tests/resumeWorkflow.test.js tests/jobApplicationSubmission.test.js tests/applicationDecision.test.js
npm.cmd run build
```

Use a fresh deployment shell afterward; never reuse these deliberately invalid DB overrides for a production command.

3. Before approved production DDL, record the recovery point, verify the Aiven backup/PITR window in Console and restore a backup to a separate service as a recovery drill. Backups/retention are plan-dependent and DDL can wait on a backup lock; consult [Aiven's backup documentation](https://aiven.io/docs/products/mysql/concepts/mysql-backups). Take a consistent application database dump with a MySQL 8.4 client into restricted encrypted storage. An example using a protected client option file (host/port/user/password plus `ssl-mode=VERIFY_IDENTITY` and `ssl-ca`) is:

```powershell
mysqldump --defaults-extra-file="C:\secure\aiven-backup.cnf" --single-transaction --set-gtid-purged=OFF --no-tablespaces --routines --events --triggers --hex-blob --result-file="C:\secure\backups\before-account-deletion.sql" REVIEWED_DATABASE
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; stop release.' }
Get-FileHash -Algorithm SHA256 'C:\secure\backups\before-account-deletion.sql'
```

Verify nonempty output, required privileges and an actual restore; a checksum alone is not recovery proof. Avoid concurrent DDL during the dump. See [Aiven's dump/restore instructions](https://aiven.io/docs/products/mysql/howto/migrate-database-mysqldump). Protect an external object inventory and verify provider restore/version retention separately; SQL backup does not contain file bytes.

4. Confirm the deployed/runtime environment independently, keeping the policy **unset**. In the reviewed backend runtime with its normal DB secrets, run read-only commands:

```powershell
node scripts/checkAccountDeletionReadiness.js
npm.cmd run migrate:account-deletion
npm.cmd run account-deletion-cleanup -- --check
```

For a local file inspection only: `node backend/scripts/checkAccountDeletionReadiness.js --env-file backend/.env`. This does not prove deployed Render state. Require an effective runtime report showing policy disabled, verified MySQL 8.4 and the expected target. Source/app TLS, certificate packaging and both Render service environments must be reviewed.

5. Only after backup, staging acceptance and explicit production migration approval, apply the single additive migration:

```powershell
npm.cmd run migrate:account-deletion -- --apply --host REVIEWED_HOST --database REVIEWED_DATABASE
if ($LASTEXITCODE -ne 0) { throw 'Migration or verification failed; keep deletion disabled.' }
npm.cmd run migrate:account-deletion
npm.cmd run account-deletion-cleanup -- --check
```

Expect a compatible InnoDB table and full two-column nonunique due index. Do not run the historical Sequelize migration set, disable FK checks or change cascades. If interrupted, rerun the check-only command first; the migration can safely add only the missing index to a compatible table. Stop for incompatible definitions rather than dropping anything.

6. Deploy the reviewed source only with separate approval. Keep the feature disabled. Authenticate each admin scope, use **GET** impact previews, and confirm that real database counts and `canDelete:false` appear while the gate is unset. Do not test a production DELETE endpoint, even with a fabricated confirmation. Verify ordinary users and wrong-scope admins remain denied using safe read-only routes. Preserve evidence of unchanged Registrar, membership, resume, notification and messaging behavior.

7. Confirm worker monitoring, least-privilege storage access, backup/restore ownership and on-call recovery procedure. Only with explicit permanent-deletion enablement approval may the deployment configuration set `ACCOUNT_DELETION_POLICY=retain-memberships-v1` and start the managed worker. No enablement is recommended while this report is NO-GO. Each actual account deletion still requires its own reviewed preview and typed confirmation.

## Rollback and recovery limits

Disabling the policy and stopping the cleanup worker prevents further destructive processing; it does not undo committed deletions. Rolling back code does not restore users, applications, resumes, membership ownership references or files. The migration's `down` is intentionally refused; leave the additive table intact. MySQL DDL cannot be reversed with an ordinary transaction rollback.

For an incident, pause writes/workers under the approved incident procedure, restore/PITR into a separate reviewed database first, verify the complete dependency graph, then plan reconciliation/cutover of later legitimate writes. Do not insert a user row alone or replay old cleanup jobs blindly. Completed external deletions need independently verified object backups/provider restoration; database backups cannot recover those bytes. Review pending/processing outbox state before restarting any worker after restore.

Evidence logs are under `C:\Alumni\tmp\account-deletion-readiness-*.log`. They are local test/preflight artifacts, not production deployment approval.
