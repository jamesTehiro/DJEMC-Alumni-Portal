# Aiven messaging preflight from Windows PowerShell — 2026-10-21

The owner reports a successful Workbench production backup and has declined separate staging. Preserve the existing migration implementation. Run only read-only identity/schema checks, show the actual plan, then stop for apply approval. Earlier MariaDB tests do not establish MySQL 8.4.11 execution, and a successful export does not establish a successful restore. Those validation gaps remain disclosed.

Saved Workbench settings inspected without printing credentials:

| Setting | Saved value |
| --- | --- |
| Host | `djemc-alumni-db-jamestehiro0-4145.e.aivencloud.com` |
| Client-facing port | `12414` |
| Database | `defaultdb` |
| CA | `C:\Alumni\backend\cert\ca.pem` (exists) |
| Server version | Prior owner result: 8.4.11; fresh authenticated check still required |

No private production env file was found in the previously agreed locations; the project's `.env` / `.env.staging` still target localhost. Workbench's saved password is not printed or extracted by this workflow. To let the agent execute preflight, provide the path to a private production env file with the existing DB_* settings and `MIGRATION_DB_CA_FILE`, never its contents. Alternatively run the secure-prompt commands below yourself and share only the sanitized output. These commands reuse the saved target and CA and never write a credential file.

## Read-only preflight

Use a clean PowerShell terminal. Enter the same database username/password as the confirmed Workbench production connection at the prompts. Password input is masked and is not part of command history. The environment overrides exist only for the duration of the block and are restored afterward. The script uses verified TLS, fixed target checks and SELECT-only SQL; the existing repair script receives no `--apply`.

```powershell
Set-Location C:\Alumni\backend
$ErrorActionPreference = 'Stop'
$targetHost = 'djemc-alumni-db-jamestehiro0-4145.e.aivencloud.com'
$targetDatabase = 'defaultdb'
$targetPort = '12414'
$caFile = 'C:\Alumni\backend\cert\ca.pem'
if (-not (Test-Path -LiteralPath $caFile -PathType Leaf)) { throw 'Aiven CA file is missing' }
$environmentNames = @('NODE_ENV','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASS','MIGRATION_DB_CA_FILE')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$productionUser = Read-Host 'Existing production Workbench database username'
$protectedPassword = Read-Host 'Existing production database password' -AsSecureString
$productionCredential = [System.Management.Automation.PSCredential]::new($productionUser, $protectedPassword)
try {
    $env:NODE_ENV = 'production'
    $env:DB_HOST = $targetHost
    $env:DB_PORT = $targetPort
    $env:DB_NAME = $targetDatabase
    $env:DB_USER = $productionUser
    $env:DB_PASS = $productionCredential.GetNetworkCredential().Password
    $env:MIGRATION_DB_CA_FILE = $caFile
    @'
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const host = 'djemc-alumni-db-jamestehiro0-4145.e.aivencloud.com';
const database = 'defaultdb';
let connection;
(async () => {
  try {
    if (process.env.DB_HOST !== host || process.env.DB_NAME !== database || process.env.DB_PORT !== '12414') throw new Error('Target mismatch');
    connection = await mysql.createConnection({
      host, port: 12414, database, user: process.env.DB_USER, password: process.env.DB_PASS,
      connectTimeout: 15000,
      ssl: { ca: fs.readFileSync(process.env.MIGRATION_DB_CA_FILE, 'utf8'), rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' }
    });
    const [[identity]] = await connection.query('SELECT DATABASE() AS database_name, VERSION() AS mysql_version');
    console.log(JSON.stringify({ mode: 'read-only', host, port: 12414, database: identity.database_name, mysqlVersion: identity.mysql_version }));
    if (identity.database_name !== database || !/^8\.4\.11(?:\D|$)/.test(identity.mysql_version)) throw new Error('Review database/server version');
    const queries = fs.readFileSync('scripts/messagingMigrationPreflight.sql', 'utf8').replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean);
    for (const [index, sql] of queries.entries()) {
      if (!/^SELECT\s/i.test(sql)) throw new Error('Unexpected preflight statement');
      const [rows] = await connection.query(sql);
      console.log(JSON.stringify({ preflightSection: index + 1, rows }));
    }
  } catch (error) {
    const allowed = new Set(['ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR','ER_TABLEACCESS_DENIED_ERROR','ER_BAD_DB_ERROR','ER_NO_SUCH_TABLE','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID']);
    console.error(JSON.stringify({ preflight: 'failed', code: allowed.has(error.code) ? error.code : null, productionWrites: false }));
    process.exitCode = 1;
  } finally { if (connection) await connection.end(); }
})();
'@ | node
    if ($LASTEXITCODE -ne 0) { throw 'Read-only production identity/schema check failed; stop' }
    node scripts/repairMessagingStorage.js --production-plan --database "$targetDatabase" --host "$targetHost"
    if ($LASTEXITCODE -ne 0) { throw 'Read-only production plan failed; stop' }
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
    Remove-Variable productionCredential, protectedPassword -ErrorAction SilentlyContinue
}
```

The preflight outputs only target identity, schema/index/FK metadata, counts and aggregate reference lengths. It does not select message contents, filenames, attachment references, credentials or uploaded bytes. The expected first-time plan, based on the earlier production diagnostic rather than a new execution, is:

```json
{"mode":"check-only","changes":[{"action":"widen","table":"messages","column":"file_url"},{"action":"widen","table":"employermessages","column":"attachment"},{"action":"create_ledger","table":"message_send_requests"}]}
```

Confirm actual output, not this example. Exact original counts were 34 and 3; legitimate subsequent sends may have changed the baseline. If the target/version differs, the preflight fails, or the plan has additional changes, stop and review. The production-plan guard rejects planned changes outside these three targets. The migration's internal widening checks can also refuse unsupported column definitions; no reference columns may be indexed, generated or have unsupported defaults.

## Production command for review only

**STOP after preflight. No production apply is approved yet.** With a private production environment file whose values match the authenticated preflight, the exact command for review is:

```powershell
Set-Location C:\Alumni\backend
$migrationEnv = Read-Host 'Absolute path to the private production environment file'
node --env-file="$migrationEnv" scripts/repairMessagingStorage.js --production-plan --apply --database defaultdb --host djemc-alumni-db-jamestehiro0-4145.e.aivencloud.com --lock-wait-seconds 15
```

If using the secure-prompt environment instead of a file, the same reviewed apply command is:

```powershell
node scripts/repairMessagingStorage.js --production-plan --apply --database defaultdb --host djemc-alumni-db-jamestehiro0-4145.e.aivencloud.com --lock-wait-seconds 15
```

The latter command requires the reviewed production variables to be loaded again, inside a fresh copy of the secure-prompt try/finally block, after approval. The read-only block above restores those variables when it finishes; do not run a bare apply command afterward and assume production credentials are still loaded. The private-file alternative requires a clean terminal without conflicting DB_* / NODE_ENV variables. Do not put either command into Render's build/start configuration.

Before approval, confirm the Workbench backup covers all affected tables and dependency records, retain its private recovery location, and agree a short maintenance window. Widening can rebuild the two tables and block messaging writes; 15 seconds limits metadata-lock waiting, not total operation time. The three DDL statements commit independently. Keep TEXT/ledger data on a code rollback, inspect a remaining plan after partial failure, and require separate approval for backup restoration/cutover. See the [main checklist's postflight and recovery steps](messaging-production-migration.md#6-read-only-production-postflight-and-recovery-decision).

Current status: saved target/CA confirmed; authenticated production identity/version/plan pending a usable private configuration or the owner's sanitized command output. Owner-reported backup success is recorded, not represented as an agent-verified restore. Production apply remains pending explicit approval.
