# Windows setup for the messaging staging drill

Inspection date: 2026-10-20. This supplements [the existing migration checklist](messaging-production-migration.md); it does not replace the approved three-target plan.

**Current decision: NO-GO. Setup instructions only. The owner explicitly requested confirmation before any database operation that writes data, including disposable initialization, user/schema creation, password changes, restoration and staging migration. None of those operations was executed.** Production export credentials and an encrypted backup location are not configured, so no production export or restore was attempted.

## What is actually available

| Component | Inspection result |
| --- | --- |
| Running local database | XAMPP `C:\xampp\mysql\bin\mysqld.exe`; existing development server is MariaDB 10.4.32 |
| MySQL clients | Workbench's `mysql.exe` and `mysqldump.exe` report 8.0.43 |
| MySQL 8.4.11 server | No usable installation found |
| Docker / Podman | No executable found in PATH; Docker Desktop installation path absent |
| Ubuntu WSL | Present, but executable checks found no usable MySQL/container runtime; a systemd user-session startup warning occurred |
| Official 8.4.11 Windows ZIP | Partial file at `C:\Alumni\tmp\mysql-8.4.11-winx64.zip`: 81,462,715 of 281,191,914 bytes after a bounded resume attempt; unusable until complete and verified |
| OpenSSL | Git includes `C:\Program Files\Git\usr\bin\openssl.exe` |
| Proposed local staging port | No listener found on TCP 33084 at inspection time; recheck before starting |
| Existing project env files | `.env` and `.env.staging` point to localhost; neither is a confirmed isolated MySQL 8.4.11 environment |
| Private production/staging files | Not configured, as confirmed by the owner; no production connection was made |
| Windows edition | `EditionID=CoreSingleLanguage` (Home Single Language); this does not establish encryption status |
| Encryption | Tools are installed, but `manage-bde -status C:` could not inspect the protected resource without administrator rights; status remains unverified |

The earlier 37 passing tests remain MariaDB/unit/route evidence. No exact-MySQL staging tests were run in this setup-only continuation. The 34 + 3 production message counts are the owner's prior baseline, not a fresh export or a verified restored copy.

## 1. Confirm an encrypted location before storing secrets or data

On Windows, open **Settings > Privacy & security > Device encryption** as an administrator. Confirm that encryption is enabled for the drive that will hold **both backups and the staging data directory**, and that its recovery key is safely backed up privately. Do not send the recovery key to Codex or put it in the repository. Device Encryption can be available on Windows Home; the separate EFS file/folder checkbox is unavailable on Home. A folder ACL alone is not encryption. [Microsoft Device Encryption](https://support.microsoft.com/en-us/windows/security/encryption/device-encryption-in-windows), [Microsoft file/folder encryption](https://support.microsoft.com/en-us/windows/security/encryption/how-to-encrypt-a-file-or-folder)

If the page is missing or the drive is not encrypted, stop here. Check System Information's Device Encryption Support as administrator and choose an approved encrypted storage volume/container before saving production credentials or data. Do not substitute an ordinary ZIP archive, a plain Downloads folder, or `.gitignore` for encrypted storage. No encryption setting was changed by this agent.

The proposed folder is `%USERPROFILE%\DJEMC-Private`, outside `C:\Alumni` and outside synced Desktop/Documents folders. Use it only after the containing drive is verified encrypted. If using another encrypted volume, change `$privateRoot` consistently in every step.

These filesystem-only commands are prepared for the owner; they have not been executed:

```powershell
$ErrorActionPreference = 'Stop'
$privateRoot = Join-Path $env:USERPROFILE 'DJEMC-Private'
if (Test-Path -LiteralPath $privateRoot) { throw 'Review the existing directory and its permissions before reusing it' }
New-Item -ItemType Directory -Path $privateRoot | Out-Null
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $privateRoot /inheritance:r /grant:r "*${currentSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Private directory permissions were not established' }
foreach ($name in @('backups','env','certificates','tools','staging','logs')) {
    New-Item -ItemType Directory -Path (Join-Path $privateRoot $name) | Out-Null
}
& icacls.exe $privateRoot
```

These permissions give the current Windows account, SYSTEM and local Administrators access. The files are plaintext while accessed by an authorized logged-in account; drive encryption protects them at rest. Keep them out of Git, cloud sync and shared folders. Protect staging data/logs to the same standard as the backup.

## 2. Choose one independent staging server

**Recommended on this machine: a portable local MySQL 8.4.11 server**, with its own executable, encrypted data directory and loopback-only port 33084. It avoids installing Docker or provisioning a paid cloud service. XAMPP's files, port and application configuration stay untouched. The incomplete download must be finished first.

Alternatively use a separately provisioned Aiven service. Provisioning must wait for the owner's confirmation and any service-cost approval. In Aiven Console create a distinctly named service, such as `djemc-messaging-staging`, or use Backups > Fork & restore if available and approved. A fork contains production data immediately: check that the fork has no application workers/integrations and scheduled events cannot run. A fresh empty service is easier to isolate for a logical-restore drill. Record its service identity, separate hostname, user and CA certificate; do not change the production service or Render's variables. Verify **the actual `SELECT VERSION()` result is 8.4.11**, since the UI's MySQL major-version label does not establish its patch version. If 8.4.11 cannot be provisioned, use the exact portable archive. [Aiven service forking](https://aiven.io/docs/products/mysql/howto/fork-service)

For the Aiven option, skip local server initialization below. A local administrator must confirm the staging service's event scheduler is OFF before restoring events, and that its server UUID differs from production. Use the separate service's own CA and credentials for the staging env file.

## 3. Prepare the exact local MySQL tools

This step downloads/extracts tools only; it must not initialize or start a server. The official archive and checksum endpoint were reachable during inspection. The checksum below was retrieved from Oracle's HTTPS endpoint, not calculated from the partial file. [Oracle Windows archive installation](https://dev.mysql.com/doc/refman/8.4/en/windows-install-archive.html)

```powershell
$archive = 'C:\Alumni\tmp\mysql-8.4.11-winx64.zip'
$archiveUrl = 'https://cdn.mysql.com/archives/mysql-8.4/mysql-8.4.11-winx64.zip'
curl.exe --fail --show-error --location --continue-at - --retry 3 --output $archive $archiveUrl
if ($LASTEXITCODE -ne 0) { throw 'Download incomplete; do not extract or run it' }
if ((Get-Item -LiteralPath $archive).Length -ne 281191914) { throw 'Archive size mismatch' }
$expectedMd5 = '2e833921898a9a030ea6bfe81bd811bc'
if ((Get-FileHash -LiteralPath $archive -Algorithm MD5).Hash.ToLowerInvariant() -ne $expectedMd5) { throw 'Oracle archive checksum mismatch' }
$toolsDirectory = Join-Path $privateRoot 'tools'
Expand-Archive -LiteralPath $archive -DestinationPath $toolsDirectory
$mysqlBin = Join-Path $toolsDirectory 'mysql-8.4.11-winx64\bin'
$mysqld = Join-Path $mysqlBin 'mysqld.exe'
$mysql = Join-Path $mysqlBin 'mysql.exe'
$mysqldump = Join-Path $mysqlBin 'mysqldump.exe'
& $mysqld --no-defaults --version
& $mysql --no-defaults --version
& $mysqldump --no-defaults --version
```

Require all three to report 8.4.11. Check Oracle's package-signature guidance if authenticity verification beyond the HTTPS-sourced checksum is required. A checksum is not a database test. If Windows reports a missing Visual C++ runtime, resolve the prerequisite using Oracle/Microsoft's official installation guidance; do not borrow DLLs or XAMPP's server executable. Do not install a Windows service or add the new binary folder to global PATH.

## 4. Prepare local TLS and a separate server configuration

This section prepares files only, under the encrypted private directory. It does not start or initialize a database. Keep the CA private key and server key private. Use a distinct staging CA; never copy a production private key or disable the migration CLI's verification.

MySQL-generated default certificates do not provide suitable hostname identity verification. The proposed certificate contains both `localhost` and `127.0.0.1`; production continues to use Aiven's own CA/hostname. [MySQL TLS verification](https://dev.mysql.com/doc/refman/8.4/en/using-encrypted-connections.html), [MySQL OpenSSL certificate procedure](https://dev.mysql.com/doc/refman/8.4/en/creating-ssl-files-using-openssl.html)

```powershell
$openssl = 'C:\Program Files\Git\usr\bin\openssl.exe'
$tlsDirectory = Join-Path $privateRoot 'certificates\local-staging'
if (Test-Path -LiteralPath $tlsDirectory) { throw 'Review existing staging certificates instead of overwriting them' }
New-Item -ItemType Directory -Path $tlsDirectory | Out-Null
$stageCa = Join-Path $tlsDirectory 'ca.pem'
$stageCaKey = Join-Path $tlsDirectory 'ca-key.pem'
$stageKey = Join-Path $tlsDirectory 'server-key.pem'
$stageCsr = Join-Path $tlsDirectory 'server.csr'
$stageCert = Join-Path $tlsDirectory 'server-cert.pem'
$stageExt = Join-Path $tlsDirectory 'server-ext.cnf'
@'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
'@ | Set-Content -LiteralPath $stageExt -Encoding ASCII
& $openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 -subj '/CN=DJEMC-Local-Staging-CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout $stageCaKey -out $stageCa
if ($LASTEXITCODE -ne 0) { throw 'Staging CA generation failed' }
& $openssl req -new -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' -keyout $stageKey -out $stageCsr
if ($LASTEXITCODE -ne 0) { throw 'Staging server certificate request failed' }
& $openssl x509 -req -in $stageCsr -CA $stageCa -CAkey $stageCaKey -CAcreateserial -out $stageCert -days 30 -sha256 -extfile $stageExt
if ($LASTEXITCODE -ne 0) { throw 'Staging certificate signing failed' }
& $openssl verify -CAfile $stageCa $stageCert
if ($LASTEXITCODE -ne 0) { throw 'Staging certificate verification failed' }
```

Prepare a new configuration pointing exclusively to the private staging directory:

```powershell
$stageRoot = Join-Path $privateRoot 'staging'
$stageData = Join-Path $stageRoot 'data'
if (Test-Path -LiteralPath $stageData) { throw 'Use a new empty staging data path; never reuse XAMPP data' }
$stageIni = Join-Path $stageRoot 'my.ini'
$stageLog = Join-Path $privateRoot 'logs\mysql-staging.err'
$serverBase = (Split-Path $mysqlBin -Parent).Replace('\','/')
$dataPath = $stageData.Replace('\','/')
$logPath = $stageLog.Replace('\','/')
$caPath = $stageCa.Replace('\','/')
$certPath = $stageCert.Replace('\','/')
$keyPath = $stageKey.Replace('\','/')
@"
[mysqld]
basedir="$serverBase"
datadir="$dataPath"
port=33084
bind-address=127.0.0.1
mysqlx=0
event_scheduler=OFF
local_infile=OFF
require_secure_transport=ON
ssl_ca="$caPath"
ssl_cert="$certPath"
ssl_key="$keyPath"
log_error="$logPath"
"@ | Set-Content -LiteralPath $stageIni -Encoding ASCII
```

Use a path representable in this ASCII configuration or explicitly choose a compatible configuration encoding before use. Recheck port 33084 availability before starting. All existing XAMPP configuration and data paths must differ from `$stageIni`, `$stageData` and `$mysqld`.

**STOP: the following commands initialize/start a database and must wait for the owner's confirmation. They have not been executed.**

```powershell
& $mysqld "--defaults-file=$stageIni" --initialize
if ($LASTEXITCODE -ne 0) { throw 'Staging initialization failed; inspect the private log without sharing passwords' }
$stageProcess = Start-Process -FilePath $mysqld -ArgumentList ('--defaults-file="{0}"' -f $stageIni) -WindowStyle Hidden -PassThru
```

After approval, initialization creates system tables and a temporary root password in the protected error log. Inspect that log privately; do not paste it into chat. In a new Workbench connection named `DJEMC LOCAL STAGING 8.4.11`, use host `localhost`, port `33084`, staging CA, and SSL verification of both CA and identity. Complete the expired-root-password change privately, then create a distinct staging-only account through Workbench's Users and Privileges UI. These are staging writes and are part of the confirmation gate. Grant that account privileges only on the disposable restore schema; never reuse the production account/password or grant global administration privileges to the application runner.

The restore schema will use the reviewed production schema name **on this separate server**, with its original charset/collation, as specified in the main checklist. Do not create it on XAMPP or Aiven production. For a full-schema restore the staging account needs the schema-level object/data privileges used by the dump, including routine/event/view/trigger privileges where applicable. Create/permission it only after checking that schema name and the backup's dependencies.

## 5. Prepare separate private environment files

Create these files in `$privateRoot\env` using a local editor that does not sync secrets or back up its session outside the protected location. Do not type passwords into PowerShell commands/history. Templates below deliberately contain placeholders and are not connection-ready. Replace them privately; never commit the completed files or send their contents to Codex. Use correct dotenv quoting, including quotes around passwords containing `#` or spaces.

**Production export file:** `production-export.env`. Obtain the actual hostname, port, database and CA from the existing Aiven service's Connection information. Save its CA as `$privateRoot\certificates\production-ca.pem`. Use an **existing** export account with SELECT/schema-inspection privileges and any object-inspection privileges required by the backup. If no such account exists, a DBA must arrange it under separate authorization; this setup does not create users or grants in production. Calling a file "read-only" does not restrict a write-capable account.

```dotenv
NODE_ENV=production
DB_HOST=ACTUAL_PRODUCTION_AIVEN_HOSTNAME
DB_PORT=ACTUAL_PRODUCTION_AIVEN_PORT
DB_NAME=ACTUAL_PRODUCTION_DATABASE
DB_USER=EXISTING_EXPORT_ACCOUNT
DB_PASS="PRIVATE_EXPORT_PASSWORD"
MIGRATION_DB_CA_FILE=C:/Users/YOUR_WINDOWS_USER/DJEMC-Private/certificates/production-ca.pem
```

**Staging file:** `staging-messaging.env`. Fill this only after the isolated staging server/account/schema have been approved and created. Local portable example:

```dotenv
NODE_ENV=production
DB_HOST=localhost
DB_PORT=33084
DB_NAME=REVIEWED_PRODUCTION_SCHEMA_NAME_ON_THE_SEPARATE_SERVER
DB_USER=STAGING_ONLY_ACCOUNT
DB_PASS="PRIVATE_STAGING_PASSWORD"
MIGRATION_DB_CA_FILE=C:/Users/YOUR_WINDOWS_USER/DJEMC-Private/certificates/local-staging/ca.pem
```

For Aiven staging substitute its separate hostname/port/account and **its own** downloaded CA certificate. Do not point a staging env file at the production hostname. Do not edit `backend/.env`, `backend/.env.staging`, Render or Firebase. Node's `--env-file` does not override preexisting shell environment variables, so use a fresh terminal without conflicting DB_* / NODE_ENV values. The Node CLI reads these files; the `mysql` / `mysqldump` commands in the main checklist instead use explicit reviewed connection arguments and prompt for the password. Do not execute/evaluate dotenv files as PowerShell scripts.

## 6. Verify identities before exporting or restoring

Once the connections are configured, run only these read-only statements on each intended server, keeping results privately labelled production versus staging:

```sql
SELECT VERSION() AS server_version, @@server_uuid AS server_uuid,
       @@hostname AS server_hostname, @@port AS server_port,
       DATABASE() AS selected_database, @@GLOBAL.event_scheduler AS event_scheduler;
SHOW SESSION STATUS LIKE 'Ssl_cipher';
```

Require a real 8.4.11 staging result (not MariaDB, not the client's version), different production/staging server UUIDs, the reviewed endpoint/port, and an encrypted session. Require OFF/DISABLED for the staging event scheduler and no running application, email, notification or scheduled-event writers. If production's scheduler is ON, record it; do not change it. Aiven may expose an internal server port through SQL that differs from its client-facing connection port; verify both appropriately instead of assuming the SQL port equals the external service port.

For portable staging, the planned identity is **localhost:33084, independent private data directory, actual server UUID pending**. A schema with the production name is acceptable only on this proven separate server. A second schema on production, another Workbench connection label, or a renamed env file does not establish isolation.

## 7. Export, restore and migrate only after the gates are met

No export is currently possible from this workspace because the private production connection/CA and verified encrypted destination are absent. A filesystem hash of an old/local SQL file is not a verified production backup. Do not use the open Downloads test dump as evidence for the 37 current production records.

After setup confirmation and successful identity checks, follow sections 2–4 of [the main checklist](messaging-production-migration.md):

1. Refresh read-only production preflight and exact counts. Record the current message baseline; 34 + 3 is expected only if no legitimate messages have since arrived.
2. Use the prepared `mysqldump --single-transaction` export with verified TLS and `--result-file` into the protected backups directory. Prohibit competing DDL. Agree how writers will be held stable for comparisons; do not assume reads freeze production traffic or silently change Render to achieve that.
3. Include the five existing messaging tables **and all foreign-key dependencies**, including required user tables. The full application-schema backup in the main checklist is the reviewed recovery approach; a two-table-only restore cannot validate all existing foreign keys. Confirm the chosen export scope before exporting data.
4. Check exit status, artifact length and SHA256; capture the protected deterministic messaging-data snapshot. Keep files and their contents private.
5. Restore only into the identity-verified independent staging server, with events OFF and workers absent. Check all restore errors and full schema/object dependencies; compare original counts, index definitions, foreign keys and data-snapshot hashes.
6. Run `--production-plan` dry run, then staging-only apply. Require exactly the reviewed remaining targets, original column attributes preserved, both reference columns TEXT, and the ledger with its primary key and unique `(sender_id,channel,conversation_id,request_key)` index.
7. Run **staging apply a second time**, then check-only; require an empty plan, no additional DDL or data changes, unchanged existing rows and the same hashes. Compare reference contents privately, not just their lengths. Confirm all 34 + 3 original messages when that is still the captured baseline. Run the fixture integration tests on a separate disposable schema/server, not inside the restored baseline schema.
8. Record actual MySQL/server identity, backup/restore/hash results and test results. Production stays NO-GO until the main checklist's backup, exact-engine, preflight, maintenance and explicit production-approval gates pass.

Keep the main checklist's rollback/recovery policy: retain widened columns and retry records on code rollback; resolve/review a partial rerun instead of narrowing or dropping. Restore recovery into a separate service, verify it there, reconcile later writes and obtain separate approval before any production restore/cutover. Ordinary SQL ROLLBACK cannot undo the three DDL statements.

## Confirmation to proceed

The next confirmation should identify the chosen server option, the verified encrypted root directory, and whether it authorizes staging initialization/account/schema creation and later staging restore/migration. Provide only paths and nonsecret identity/status information. Do not include passwords, env contents, backup contents, certificate private keys or encryption recovery keys.

Until that confirmation and missing setup information arrive, the agent will not initialize a server, change a database password, create a database/user, restore a dump or run staging/production migrations. Production writes require a separate explicit approval even after staging passes.
