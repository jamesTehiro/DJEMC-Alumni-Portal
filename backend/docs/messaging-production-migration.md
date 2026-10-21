# Messaging production migration review — 2026-10-20

**Current direction (2026-10-21): production read-only preflight, then stop for explicit apply approval.** The owner reports a successful, error-free Workbench production backup and has declined a separate staging server. Exact MySQL 8.4.11 execution and backup restoration remain unverified; the owner has chosen to proceed to preflight with those validation gaps. The staging steps below are retained as the earlier recommended validation procedure, not a new permission requirement. Neither the backup report nor the staging decision authorizes production writes. No production apply, commit, push, deployment or Render/Firebase change has been performed by this agent.

The saved Workbench target inspected on 2026-10-21 is `djemc-alumni-db-jamestehiro0-4145.e.aivencloud.com:12414`, schema `defaultdb`, CA file `C:\Alumni\backend\cert\ca.pem`. These are saved settings, not an authenticated production preflight result. Project `.env` files still point to localhost; the private production env file/password must be supplied before the agent can run the remote preflight. See [the PowerShell preflight instructions](messaging-aiven-powershell-preflight.md). Production remains **NO-GO for execution pending successful current preflight and explicit owner approval**.

## Evidence and limits

Setup follow-up: see [Windows staging and private-backup setup](messaging-staging-setup-windows.md) for the latest local inspection and unexecuted setup steps. The owner confirmed that independent staging, private export/staging files and encrypted backup storage are not configured, and requested confirmation before **any** database write, including disposable initialization/restore/migration. The earlier 37-test evidence below remains unchanged; no production-backed staging result is implied.

The owner reported Aiven MySQL **8.4.11**, **34 exact `messages` rows** (~0.06 MB) and **3 exact `employermessages` rows** (~0.05 MB). Use 34, not the information_schema estimate of 31. Recheck immediately before migration; subsequent legitimate messages can change these numbers.

The six existing migration-work files were inspected and retained:

- `migrations/20261018-repair-messaging-storage.js`
- `scripts/repairMessagingStorage.js`
- `scripts/messagingMigrationPreflight.sql`
- `tests/messagingSchema.test.js`
- `tests/messagingProductionPlan.test.js`
- `tests/messagingProductionMigration.integration.test.js`

The resumed verification ran 37 selected tests: 37 passed, zero failed, zero skipped. The database tests actually used disposable schemas on **MariaDB 10.4.32**, not Aiven or the normal application schema. Coverage includes complete fixture-row comparisons, attachment metadata and long-reference round trips, existing indexes, six foreign keys, interrupted second ALTER recovery, idempotency, transaction rollback, retry deduplication, authenticated multipart routes for all four roles, access/deletion restrictions, upload validation and diagnostic startup recovery. SQL capture now also asserts that the complete migration issues exactly the three approved DDL statements and no application DML. A CLI isolation test verifies CA/hostname validation before connection and sanitized error output.

**An actual MySQL 8.4.11 execution/restore drill remains unverified.** No usable local MySQL 8.4 server or Docker runtime was available; the attempted Oracle server archive download timed out incomplete. The installed Workbench client is 8.0.43, which is not an 8.4.11 server. The version-guard unit fixture accepts 8.4.11, and the SQL was checked against the MySQL 8.4 manual. These checks do not substitute for executing against that engine. Complete the isolated 8.4.11 restore/migration drill below before production approval.

The eight SELECT statements in the preflight SQL were also executed successfully against the local MariaDB server without displaying application data. All ten PowerShell command blocks below passed syntax parsing; that is not evidence that a production backup/restore has run.

Reproduce the local test run from `C:\Alumni\backend` using only the existing local database environment:

```powershell
$env:MESSAGING_MIGRATION_DB_TEST = '1'
$env:MESSAGING_DB_TEST = '1'
node --test --test-concurrency=1 tests/messagingProductionMigration.integration.test.js tests/messagingMigration.integration.test.js tests/messagePersistence.integration.test.js tests/messagingSchema.test.js tests/messagingProductionPlan.test.js tests/chatAttachmentMigration.test.js tests/productionMessagingDiagnostic.test.js tests/messagingRoutes.test.js tests/messagingReliability.test.js tests/messageDeletionPermissions.test.js tests/chatAttachmentAccess.test.js
if ($LASTEXITCODE -ne 0) { throw 'Messaging validation failed' }
Remove-Item Env:MESSAGING_MIGRATION_DB_TEST, Env:MESSAGING_DB_TEST
```

Do not run those integration tests with production credentials. Their local-host checks are additional safeguards, not instructions to repoint the application environment.

## Reviewed schema and scope

Run the repair script with **`--production-plan`**, including for dry runs. The general repair mode can add other missing messaging metadata; the production plan rejects such additions. Its only permitted actions are:

| Target | Result |
| --- | --- |
| `messages.file_url` | `TEXT`, retaining current charset, collation, nullability and comment |
| `employermessages.attachment` | `TEXT`, retaining current charset, collation, nullability and comment |
| `message_send_requests` | New InnoDB retry ledger with the columns/indexes below |

Existing TEXT/MEDIUMTEXT/LONGTEXT references are left as they are. Unexpected defaults, unsupported definitions, indexed reference columns or ambiguous table mappings require review. No existing table, row, conversation, participant, index, attachment reference or provider object is deliberately deleted or rewritten by application DML. Table rebuilds physically copy existing rows. No `sequelize.sync({ alter: true })` is involved.

The ledger matches `models/MessageSendRequest.js` and `services/messagePersistence.js`:

| Column | Definition |
| --- | --- |
| `id` | signed INT, NOT NULL, AUTO_INCREMENT, PRIMARY KEY |
| `sender_id`, `conversation_id`, `message_id` | signed INT, NOT NULL |
| `channel` | VARCHAR(20), NOT NULL |
| `request_key`, `payload_hash` | VARCHAR(64), NOT NULL |
| `createdAt`, `updatedAt` | DATETIME, NOT NULL |

The new table uses `utf8mb4` / `utf8mb4_bin` for case-sensitive request identifiers. Unique index **`message_send_requests_identity(sender_id, channel, conversation_id, request_key)`** is included in the same CREATE TABLE as the primary key. No foreign keys are added to the ledger: its conversation/message identifiers belong to two different message channels. Existing foreign keys remain intact. The composite key is within MySQL 8.4 InnoDB index-size limits.

The operation can resume from a reviewed partial state; an already complete schema produces an empty plan with no DDL. An incompatible existing ledger is refused rather than repaired automatically. Production apply checks the configured host and actual selected database, InnoDB engines and server major version, then uses one pinned connection for an advisory lock, session lock-wait timeout and DDL. Re-inspection occurs after acquiring the lock. The advisory lock coordinates this runner only: prohibit other schema tools/DDL during the window.

## Application behavior retained

Alumni, Employer and Admin Alumni continue using the existing authenticated unified messaging routes (`POST /api/messages/:conversationId`, including legacy room delegation) and the `unified` persistence channel. Admin Employer retains its existing forum permissions and employer/admin direct route `POST /api/admin-employer/messages`, using the `admin_employer` channel. No route/controller/model/storage behavior was replaced in this validation.

Authentication, participant checks, private attachment download authorization, content-signature/type checks, existing `MAX_UPLOAD_MB` limit (default 10 MB), notifications, summaries, unread state and transaction/retry behavior remain in their current functions. The migration changes schema capacity and adds the retry ledger. It does not repair already truncated references or recover missing Cloudinary/local files. Database backups contain references/metadata, not the external attachment bytes.

## Interruption and rollback risks

Changing VARCHAR/CHAR to TEXT requires a table rebuild and prevents concurrent DML during the change on MySQL 8.4. Upload requests and text-message sends that write these tables can wait, fail or time out; reads can also wait at metadata-lock transitions. Pause messaging writes, let in-flight transactions finish and announce a short maintenance window. The 37-row/~0.11 MB baseline suggests little copying, but it does not predict metadata-lock waits or guarantee a duration. Do not force `ALGORITHM=INSTANT` or `LOCK=NONE`. [MySQL 8.4 DDL support](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)

The runner sets `lock_wait_timeout` to 15 seconds on its DDL connection and restores it afterward. This bounds metadata-lock acquisition waits, not total migration duration or every application wait. Privilege errors, connection loss, storage exhaustion, competing DDL or unexpected definitions can stop the run. Do not kill application/database sessions blindly; inspect sanitized schema status and the remaining dry-run plan first.

The two ALTERs and CREATE commit independently. A successful first ALTER remains if the second fails. MySQL's atomic handling of individual supported DDL statements does not make this three-statement operation one transaction. SQL ROLLBACK cannot undo the whole migration. [MySQL implicit commits](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)

Prefer finishing a safe partial migration after resolving its cause. On code rollback, **retain TEXT columns and retry records**; both down migrations deliberately refuse destructive rollback. Narrowing back to VARCHAR can truncate newly accepted references. Restoring a pre-migration backup can lose everything written after its snapshot across the restored schema. A production restore/cutover requires a separate approved recovery decision and reconciliation of later writes.

## 1. Prepare credentials, tooling and a private evidence directory

The remaining production commands below are **prepared instructions, not executed actions**. They run locally without Render Shell access. Use a clean PowerShell session, Node >=22.12 and matching MySQL **8.4** `mysql.exe` / `mysqldump.exe` clients. Obtain the Aiven hostname, port, database, username and CA certificate from the service's Connection information. Passwords are entered at the client prompt, never placed in command arguments or logs. Keep backups/CA/env files outside the repository on restricted, encrypted storage. Do not paste backups or restore errors containing data into Render Logs or chat.

```powershell
Set-Location C:\Alumni\backend
$mysqlBin = Read-Host 'Directory containing the MySQL 8.4 client executables'
$mysql = Join-Path $mysqlBin 'mysql.exe'
$mysqldump = Join-Path $mysqlBin 'mysqldump.exe'
& $mysql --version
& $mysqldump --version
# Confirm both report 8.4 before continuing.
$targetHost = Read-Host 'Reviewed production Aiven hostname'
$targetPort = Read-Host 'Reviewed production Aiven port'
$targetUser = Read-Host 'Production backup/migration database username'
$targetDatabase = Read-Host 'Reviewed production database name'
$caFile = Read-Host 'Absolute path to the production Aiven CA certificate'
$privateDirectory = Read-Host 'Existing encrypted/private directory OUTSIDE C:\Alumni (avoid spaces)'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $privateDirectory "djemc-before-messaging-$stamp.sql"
$sourceDataFile = Join-Path $privateDirectory "messaging-data-before-$stamp.sql"
$sourceConnection = @("--host=$targetHost", "--port=$targetPort", "--user=$targetUser",
    '--password', '--ssl-mode=VERIFY_IDENTITY', "--ssl-ca=$caFile")
$preflightSource = 'SOURCE C:/Alumni/backend/scripts/messagingMigrationPreflight.sql'
```

Use a database account with the required SELECT/schema-inspection privileges for preflight/backup; apply additionally needs ALTER on the two existing tables and CREATE for the ledger. Backing up views, triggers, routines and events also needs their inspection privileges. If permissions fail, stop; do not use `--force` to produce a partial backup. Verify the database name/port match the backend's Render DB variables without sharing their values.

## 2. Read-only preflight

```powershell
& $mysql @sourceConnection "--database=$targetDatabase" --batch --execute=$preflightSource
if ($LASTEXITCODE -ne 0) { throw 'Read-only schema preflight failed' }
```

The checked-in SQL contains SELECT statements only. Save the schema/index/FK/count/aggregate results privately as the baseline. Confirm version 8.4.11, canonical table names, all messaging tables InnoDB, both reference definitions, and the current exact counts. The final aggregate query exposes only counts and lengths, not references, filenames or contents. These aggregates supplement the backup; matching lengths are not proof of identical contents.

An operator with sufficient privileges can additionally inspect blocker counts without selecting query text:

```sql
SELECT OBJECT_NAME, LOCK_TYPE, LOCK_STATUS, COUNT(*) AS lock_count
FROM performance_schema.metadata_locks
WHERE OBJECT_SCHEMA=DATABASE()
  AND OBJECT_NAME IN ('messages','employermessages')
GROUP BY OBJECT_NAME, LOCK_TYPE, LOCK_STATUS;
SELECT COUNT(*) AS open_transactions FROM information_schema.INNODB_TRX;
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND ENGINE <> 'InnoDB';
```

If these visibility permissions are unavailable, arrange a DBA check rather than assuming there are no blockers. A full-schema consistent transactional dump also requires other tables to be InnoDB, or a separately approved backup strategy for nontransactional tables. Avoid concurrent DDL during any dump.

Prepare an external environment file, for example `C:\Private\DJEMC\production-messaging.env`, containing ONLY the relevant reviewed connection settings (use real values privately):

```dotenv
NODE_ENV=production
DB_HOST=REVIEWED_AIVEN_HOST
DB_PORT=REVIEWED_AIVEN_PORT
DB_NAME=REVIEWED_DATABASE
DB_USER=REVIEWED_USER
DB_PASS="PRIVATE_PASSWORD"
MIGRATION_DB_CA_FILE=C:/Private/DJEMC/ca.pem
```

Do not edit the project's `.env`. Node's existing environment variables take priority over `--env-file`, so use a clean terminal with no conflicting NODE_ENV/DB_* variables. The migration CLI requires the CA and enforces certificate verification for this remote production plan; it does not change the backend's general connection configuration.

```powershell
$migrationEnv = Read-Host 'Absolute path to the private production-messaging.env file'
node --env-file="$migrationEnv" scripts/repairMessagingStorage.js --production-plan --database "$targetDatabase" --host "$targetHost"
if ($LASTEXITCODE -ne 0) { throw 'Read-only production-plan check failed' }
```

Expected initial actions: widen `messages.file_url`, widen `employermessages.attachment`, create `message_send_requests`. A reviewed partial run may have fewer actions; any additional action or failure is a stop condition. No `--apply` means no schema writes. Do not use application startup or the temporary diagnostic hook to apply a migration.

## 3. Take and verify a backup

Before the final backup, agree the maintenance window and prevent messaging writes through **all four roles**, jobs and other clients; drain in-flight requests. For full-schema recovery without losing unrelated later writes, either quiesce all relevant application writers or plan reconciliation/PITR explicitly. Pausing only messaging does not freeze the rest of the portal.

First inspect Aiven Console > service > Backups: verify the latest recoverable backup/time and the retention actually available on this service plan. Record those details privately. Aiven recovery can create an independent service using **Fork & restore**; this was not initiated here. Do not assume a free plan has a usable backup merely because a Backups page exists. [Aiven backup retention](https://aiven.io/docs/products/mysql/concepts/mysql-backups), [Aiven fork and restore](https://aiven.io/docs/products/mysql/howto/fork-service)

Take a full application-schema logical backup (not MySQL system schemas):

```powershell
if (Test-Path -LiteralPath $backupFile) { throw 'Choose a new backup filename' }
& $mysqldump @sourceConnection --single-transaction --quick --routines --events --triggers --set-gtid-purged=OFF --no-tablespaces --hex-blob --default-character-set=utf8mb4 --column-statistics=0 "--result-file=$backupFile" "$targetDatabase"
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not migrate' }
if ((Get-Item -LiteralPath $backupFile).Length -eq 0) { throw 'Empty backup; do not migrate' }
$backupHash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash
$backupHash | Set-Content -LiteralPath "$backupFile.sha256" -Encoding ASCII
```

This follows Aiven's logical-backup approach with verified TLS. `--result-file` avoids PowerShell redirection encoding problems. A nonempty file/hash only proves an artifact exists; **successful restore verification is mandatory**. The dump does not include service settings, MySQL accounts/grants or provider attachment bytes. Keep the same client version/options for the comparisons below. [Aiven logical backup/restore](https://aiven.io/docs/products/mysql/howto/migrate-database-mysqldump), [MySQL mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)

Create a deterministic private data-only snapshot of the five existing messaging tables, while writers remain paused. These files contain private contents: never display/share them. Primary/unique keys must give stable ordering on all five tables; confirm in the preflight.

```powershell
$messagingTables = @('messages', 'employermessages', 'conversations', 'employerconversations', 'conversationparticipants')
function Save-MessagingDataSnapshot {
    param([string[]]$Connection, [string]$Database, [string]$Destination)
    & $mysqldump @Connection --single-transaction --quick --no-create-info --skip-triggers --skip-comments --skip-add-locks --skip-disable-keys --skip-extended-insert --complete-insert --order-by-primary --set-gtid-purged=OFF --no-tablespaces --hex-blob --default-character-set=utf8mb4 --column-statistics=0 "--result-file=$Destination" $Database @messagingTables
    if ($LASTEXITCODE -ne 0) { throw 'Private messaging data snapshot failed' }
    return (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
}
$sourceDataHash = Save-MessagingDataSnapshot -Connection $sourceConnection -Database $targetDatabase -Destination $sourceDataFile
```

## 4. Mandatory isolated restore and MySQL 8.4.11 drill

Use an independent disposable **MySQL 8.4.11 server**, not another schema on the production service. Keep its event scheduler OFF and all application/notification/email workers disconnected; protect the restored personal data. Configure its TLS certificate and a distinct account confined to this disposable schema. Restore into the same schema name on that separate server to retain any database-qualified routine/view references. Inspect the dump privately for DEFINER/privilege dependencies and cross-schema objects first; resolve them deliberately rather than silently omitting objects or rewriting the production backup.

These instructions have been checked against the documented SQL-format restore mechanism. **They have not been executed against a production backup or an 8.4.11 server here.** [MySQL SQL-format restore](https://dev.mysql.com/doc/refman/8.4/en/reloading-sql-format-dumps.html)

```powershell
$restoreHost = Read-Host 'Independent disposable MySQL 8.4.11 hostname'
if ($restoreHost -eq $targetHost) { throw 'Restore server must be separate from production' }
$restorePort = Read-Host 'Disposable server port'
$restoreUser = Read-Host 'Disposable restore username (never the production account)'
$restoreCa = Read-Host 'Absolute path to the disposable server CA certificate'
$restoreDatabase = $targetDatabase
if ($restoreDatabase -notmatch '^[A-Za-z0-9_]+$') { throw 'Have a DBA review this schema identifier' }
$restoreConnection = @("--host=$restoreHost", "--port=$restorePort", "--user=$restoreUser",
    '--password', '--ssl-mode=VERIFY_IDENTITY', "--ssl-ca=$restoreCa")
& $mysql @restoreConnection --batch --execute='SELECT VERSION(), @@GLOBAL.event_scheduler;'
if ($LASTEXITCODE -ne 0) { throw 'Disposable identity check failed' }
# STOP unless the result confirms MySQL 8.4.11 and event_scheduler OFF/DISABLED.
# The isolated schema must be NEW and EMPTY; CREATE without IF NOT EXISTS prevents reuse.
$schemaCharset = Read-Host 'Original database DEFAULT_CHARACTER_SET_NAME from preflight'
$schemaCollation = Read-Host 'Original database DEFAULT_COLLATION_NAME from preflight'
if ($schemaCharset -notmatch '^[A-Za-z0-9_]+$' -or $schemaCollation -notmatch '^[A-Za-z0-9_]+$') { throw 'Invalid schema character-set metadata' }
$createSchema = 'CREATE DATABASE `{0}` CHARACTER SET {1} COLLATE {2}' -f $restoreDatabase, $schemaCharset, $schemaCollation
& $mysql @restoreConnection --execute=$createSchema
if ($LASTEXITCODE -ne 0) { throw 'Disposable schema creation failed; do not reuse an existing schema' }
if ((Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash -ne $backupHash) { throw 'Backup hash mismatch' }
$restoreLog = Join-Path $privateDirectory "restore-$stamp.out"
$restoreError = Join-Path $privateDirectory "restore-$stamp.err"
$restoreSource = 'SOURCE ' + $backupFile.Replace('\', '/')
& $mysql @restoreConnection "--database=$restoreDatabase" --batch --execute=$restoreSource 1> $restoreLog 2> $restoreError
if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $restoreError).Length -gt 0) { throw 'Restore needs private review; do not migrate production' }
# Review the private restore logs for ANY SQL error even if the client returned zero.
& $mysql @restoreConnection "--database=$restoreDatabase" --batch --execute=$preflightSource
if ($LASTEXITCODE -ne 0) { throw 'Restored schema verification failed' }
$restoredDataFile = Join-Path $privateDirectory "messaging-data-restored-$stamp.sql"
$restoredDataHash = Save-MessagingDataSnapshot -Connection $restoreConnection -Database $restoreDatabase -Destination $restoredDataFile
if ($restoredDataHash -ne $sourceDataHash) { throw 'Restored messaging contents differ; investigate before proceeding' }
```

Compare the full restored schema inventory, routines/events/triggers and all table counts with the backup baseline as well. A valid messaging comparison alone does not prove a full-portal recovery. Fix any object/DEFINER or privilege failure and repeat into another fresh isolated instance/schema. Do not run the portal against restored production data or enable restored scheduled events during verification.

Prepare a **separate** private env file for the disposable server, with its own DB_* values and CA path. Use a separate clean terminal if environment values conflict. The following applies only to that independent disposable target:

```powershell
$stagingEnv = Read-Host 'Absolute path to the private DISPOSABLE-server env file'
node --env-file="$stagingEnv" scripts/repairMessagingStorage.js --production-plan --database "$restoreDatabase" --host "$restoreHost"
if ($LASTEXITCODE -ne 0) { throw 'Disposable dry run failed' }
node --env-file="$stagingEnv" scripts/repairMessagingStorage.js --production-plan --apply --database "$restoreDatabase" --host "$restoreHost" --lock-wait-seconds 15
if ($LASTEXITCODE -ne 0) { throw 'Disposable migration failed' }
node --env-file="$stagingEnv" scripts/repairMessagingStorage.js --production-plan --apply --database "$restoreDatabase" --host "$restoreHost" --lock-wait-seconds 15
if ($LASTEXITCODE -ne 0) { throw 'Disposable idempotency rerun failed' }
node --env-file="$stagingEnv" scripts/repairMessagingStorage.js --production-plan --database "$restoreDatabase" --host "$restoreHost"
if ($LASTEXITCODE -ne 0) { throw 'Disposable postflight failed' }
# Require changes: [] and compare the SQL preflight output before/after.
& $mysql @restoreConnection "--database=$restoreDatabase" --batch --execute=$preflightSource
if ($LASTEXITCODE -ne 0) { throw 'Disposable postflight SQL failed' }
$stagingAfter = Join-Path $privateDirectory "messaging-data-staging-after-$stamp.sql"
$stagingAfterHash = Save-MessagingDataSnapshot -Connection $restoreConnection -Database $restoreDatabase -Destination $stagingAfter
if ($stagingAfterHash -ne $restoredDataHash) { throw 'Disposable migration changed existing messaging contents' }
```

Also rerun the disposable-fixture integration tests against a separate local 8.4.11 instance when available, using local-only test credentials. Record the actual server version, client versions, successful restore, hashes, exact row counts, unchanged indexes/FKs, zero remaining actions and elapsed time. This closes the engine-specific test gap; elapsed time is still not a production SLA.

If the drill takes long enough for production to change, take a fresh final backup/data snapshot and refresh the preflight at the approved maintenance window. Repeat restore verification for the final backup artifact before apply; the earlier drill does not verify a different backup. Do not rely on a stale 34/3 baseline.

## 5. Approval gate and exact production command

Required before any production write:

- Recommended validation gap, waived as a prerequisite by the owner on 2026-10-21: isolated MySQL 8.4.11 restore/migration/content comparison has not run.
- Backup status: owner reports a successful Workbench backup without errors. Restore verification/artifact checks have not been performed by the agent. Confirm the backup covers the affected schema and dependencies, its private location and the recovery plan before approving apply; do not describe it as restore-tested.
- A current read-only production plan containing only the reviewed remaining actions; matching host/database/port/CA; adequate privileges, free storage and no competing DDL.
- An agreed maintenance window, all messaging writers paused, drained transactions and an operator ready to run postflight/recovery.
- **Explicit owner approval of the production apply command.** Approval has not been given.

After all gates pass, from `C:\Alumni\backend` with the production variables from sections 1–2 (NOT the staging env file), the exact command for review is:

```powershell
node --env-file="$migrationEnv" scripts/repairMessagingStorage.js --production-plan --apply --database "$targetDatabase" --host "$targetHost" --lock-wait-seconds 15
if ($LASTEXITCODE -ne 0) { throw 'Production migration stopped; keep writes paused and inspect the remaining read-only plan' }
```

Do not put this command in Render's build/start command. No deploy or Firebase change is needed to execute this schema-only command locally. Do not use a broad sequelize migration runner that might apply unrelated pending migrations.

## 6. Read-only production postflight and recovery decision

Keep writers paused until preservation checks finish:

```powershell
node --env-file="$migrationEnv" scripts/repairMessagingStorage.js --production-plan --database "$targetDatabase" --host "$targetHost"
if ($LASTEXITCODE -ne 0) { throw 'Production read-only postflight failed' }
# Require mode: check-only and changes: [].
& $mysql @sourceConnection "--database=$targetDatabase" --batch --execute=$preflightSource
if ($LASTEXITCODE -ne 0) { throw 'Production schema/count verification failed' }
& $mysql @sourceConnection "--database=$targetDatabase" --batch --execute='SELECT COUNT(*) AS retry_ledger_rows FROM message_send_requests;'
if ($LASTEXITCODE -ne 0) { throw 'Retry ledger verification failed' }
$productionAfter = Join-Path $privateDirectory "messaging-data-production-after-$stamp.sql"
$productionAfterHash = Save-MessagingDataSnapshot -Connection $sourceConnection -Database $targetDatabase -Destination $productionAfter
if ($productionAfterHash -ne $sourceDataHash) { throw 'Existing messaging contents differ; keep writes paused and investigate' }
```

Before accepting sends, confirm both reference columns are TEXT (or retained larger TEXT), original column attributes/indexes/FKs are unchanged, and exact message counts equal the latest baseline (34 + 3 only if still current). Confirm the new ledger's types, primary key, unique identity index and InnoDB engine from the preflight. Its count should be zero before writers resume. Hash comparison covers all existing message/conversation/participant values; new ledger rows are intentionally separate.

After preservation checks pass, perform authorized controlled sends/downloads for Alumni, Employer, Admin Alumni and Admin Employer using existing UI functions: text, image and document; reload history, replay one client request ID and confirm one saved message; verify notifications/unread behavior where applicable. Check existing authorized attachments, rejection of unauthorized downloads and oversize uploads. These smoke tests create approved test records, so run them only under the production approval and expect counts/ledger entries to increase afterward.

If a step fails, preserve sanitized schema/exit-code evidence, keep affected writes paused, and run only the read-only remaining plan. Resolve the cause and review a safe rerun; do not narrow columns or drop the ledger. For actual data loss/corruption, restore the verified backup into an independent recovery service using the section 4 restore procedure, or choose Aiven Backups > Fork & restore at the approved recovery time. Verify recovery there before any cutover. Changing Render credentials to a recovered service, reconciling writes after the backup, or overwriting production requires a separate explicit approval. Nothing here authorizes an in-place restore over live Aiven.

**Outstanding:** fresh authenticated production preflight and explicit maintenance/apply approval. Exact-engine staging and backup restoration remain disclosed validation gaps; the owner has declined the separate staging setup. No production write is authorized by these instructions alone.
