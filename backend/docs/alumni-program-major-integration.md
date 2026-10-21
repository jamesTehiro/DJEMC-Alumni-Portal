# Program and Major integration

## Data and compatibility

`config/academicPrograms.json` is the single program/major configuration, read by
the backend and imported by the frontend build. Build the frontend from a checkout
that includes `backend/config/academicPrograms.json`.

Program remains `course`; years remain `batch_year` (official master record) and
`graduation_year` (submitted alumni profile). The only schema additions are nullable
`VARCHAR(255)` columns named `major` on **alumnirecords** and **alumniprofiles**.
There is no backfill, rename, data conversion, index change, or new relationship.
Stored abbreviations remain unchanged. `CRIM` is a display alias of BSCRIM; `AB`
remains historical/custom and is not assumed to mean English Language.

New BSBA/BSED registration, manual creation and CSV rows require a configured major.
An unchanged historical program/major pair remains editable, including missing or
historical majors. A changed pair must pass the current rules. Switching programs
clears a stale major in forms and revalidates it in APIs. Other programs preserve
separate optional specializations. Existing duplicate CSV rows are skipped without
overwriting them or requiring completion of their historical major.

Registrar verification continues to link the selected official master record. It
does not overwrite submitted profile fields. Tracking and coordinator academic
displays take program and major together from the official record when available,
otherwise from the submitted profile. A missing official major is displayed as
not recorded; it is never borrowed from a different submitted program.

Updated APIs: registration, profile read/update, registrar records list/search/
create, CSV preview/import, administrator alumni list/tracking, and membership
academic prefill. `PUT /api/alumni-records/:id` adds registrar-only editing under
the existing authentication/scope middleware and registrar write lock. Duplicate
identity remains student ID, email, or full name + program + batch, excluding the
record being edited. Major does not redefine duplicate identity.

The CSV header is `full_name,course,batch_year,major`; the downloadable template
also retains the existing optional `student_id,email` columns. The three-column
format, 2 MB limit, 1,000-data-row limit, formula protection, transactional import,
preview and confirmation remain supported. Major is also available as a separate
master-table filter; changing the program resets that filter.

Messaging conversation keys/audiences, recruitment qualifications, resume
education, notifications, account verification actions, and privacy-limited
public profile previews retain their existing behavior.

## Schema inspection and migration

A read-only local information_schema inspection on 2026-10-21 found lowercase
`alumnirecords` and `alumniprofiles`, each with `course VARCHAR(255)` and neither
with `major`. Production schema has **not** been inspected or changed for this
feature. Unit tests simulate MySQL metadata, first application, interrupted
application/retry, repeated application, and mismatched target rejection. The
real migration also passed twice on isolated local MariaDB 10.4.32 database
`djemc_academic_1792596325454_test`, preserving six official fixture records, six
profiles, proof references, indexes and foreign keys. That database contains only
synthetic fixtures and is retained for review; no pre-existing database was
changed. This is not MySQL 8.4.11 validation or a production restore test.

Do not deploy the updated backend until both actual target columns have been
verified or added: Sequelize reads now include `major`. Production startup does
not automatically apply this migration and `sync({ alter: true })` is not enabled.

1. Obtain a current verified backup before an approved production change. Export
   the two tables' structure and data with MySQL Workbench using a consistent
   snapshot, retain their existing indexes/constraints, and store the export
   privately outside this repository. Verify the dump by restoring to an isolated
   database and comparing counts and representative records before relying on it.
   A previously completed unrelated backup is not evidence of this restore check.
2. Read the actual schema using the commands below. Review existing rows and
   metadata without changing them. Do not export private row contents to logs.
3. Test the migration on an isolated database restored from that backup. Apply
   twice; the second plan must be empty. Compare record values, counts, indexes
   and foreign keys with the baseline.
4. Review a quiet window. ADD COLUMN takes metadata locks and implicitly commits
   DDL on MySQL; a long transaction can block it. The runner bounds metadata lock
   waits to 15 seconds and serializes its DDL through the existing advisory-lock
   helper. It cannot make two table changes transactional. If interrupted after
   one table, inspect then rerun; already-added compatible columns are skipped.
5. Apply only after explicit approval, then rerun inspection and verification.
   Roll back application code if necessary and **leave the nullable columns in
   place**. Dropping columns would discard newly saved majors. A database restore
   is an operator-reviewed recovery operation that may overwrite later writes;
   never restore over live tables casually or disable foreign keys to force it.

### PowerShell: read-only inspection (safe default)

These commands use an existing **private** production environment file and verified
Aiven CA certificate. Replace the example paths and reviewed target values; no
password is passed as a command argument. The environment file must contain the
existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` and `NODE_ENV=production`.
It must remain outside Git. The explicit dotenv preload takes precedence over the
development `backend/.env`; the migration aborts on a target mismatch.

```powershell
Set-Location C:\Alumni\backend
$env:DOTENV_CONFIG_PATH = 'C:\DJEMC-private\aiven-production.env'
$env:MIGRATION_DB_CA_FILE = 'C:\DJEMC-private\aiven-ca.pem'
$ReviewedHost = '<confirmed Aiven hostname>'
$ReviewedDatabase = '<confirmed database name>'
node -r dotenv/config .\scripts\applyAlumniMajorMigration.js --host $ReviewedHost --database $ReviewedDatabase
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; do not apply.' }
```

Expected plan: at most the two nullable `major` additions. An existing incompatible
major column or missing course/table stops the runner for manual review. Remote
connections require CA-verified TLS; connection errors are sanitized.

Run these read-only statements in the same target's Workbench SQL editor, both
before and after the migration. Save the results privately for comparison.

```sql
SELECT DATABASE() AS database_name, VERSION() AS server_version;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('alumnirecords', 'alumniprofiles')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
SELECT COUNT(*) AS official_records FROM alumnirecords;
SELECT COUNT(*) AS alumni_profiles FROM alumniprofiles;
SHOW INDEX FROM alumnirecords;
SHOW INDEX FROM alumniprofiles;
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME IN ('alumnirecords', 'alumniprofiles')
       OR REFERENCED_TABLE_NAME IN ('alumnirecords', 'alumniprofiles'))
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
```

### Production apply command — approval required; not executed

After the preceding backup, isolated validation and reviewed dry-run, in the same
PowerShell session with the same verified private configuration:

```powershell
node -r dotenv/config .\scripts\applyAlumniMajorMigration.js --host $ReviewedHost --database $ReviewedDatabase --apply
if ($LASTEXITCODE -ne 0) { throw 'Migration stopped; inspect both tables before retrying.' }
node -r dotenv/config .\scripts\applyAlumniMajorMigration.js --host $ReviewedHost --database $ReviewedDatabase
```

With database variables already loaded by the deployment environment, the
equivalent package command is:
`npm.cmd run migrate:alumni-major -- --host <reviewed-host> --database <reviewed-database> --apply`.

Verify empty remaining plan, nullable major columns, unchanged original values,
counts, indexes and constraints. After an independently approved release, check
registration, registrar review/records/CSV, profile editing, coordinator search,
and tracking/drawer with appropriate test accounts. No production test messages,
notifications or accounts are created by this migration.

No migration, commit, push, Render/Firebase deployment, or production write is
performed automatically as part of this implementation.

## Validation performed

- Backend academic, CSV, profile/tracking, membership, registration-year, OTP and
  privacy regressions: **133 passed, 10 skipped**. The skipped legacy verification
  tests require a separately configured integration database; they were not run
  against the working application database.
- Authentication transaction/error regressions: **5 passed**.
- Opt-in real database migration test: **1 passed**, on the disposable MariaDB
  database identified above. Both original application tables remain unmodified.
- Frontend registration/profile/membership unit checks: **24 passed**.
- Browser academic fields/master records/CSV/queue/coordinator checks: **6 passed**;
  Graduate Tracking table/filter/source-priority/drawer/responsive checks:
  **5 passed**; desktop/mobile registration validation: **3 passed**; production
  bundle desktop/mobile/expired-code OTP checks: **3 passed**.
- Final `npm.cmd run build`: passed. Chrome fixture API calls were intercepted;
  browser tests did not contact production services.
- Read-only local migration dry-run: exactly two nullable major additions, no
  data writes. MySQL 8.4.11 and production backup/restore remain unverified.

Reproduce the backend tests from `C:\Alumni\backend`:

```powershell
node --test tests/academicPrograms.test.js tests/alumniCsvImport.test.js tests/alumniProfileTracking.test.js tests/membershipProfileSave.test.js tests/membershipWorkflow.test.js tests/membershipSchemaReadPaths.test.js tests/membershipSchemaAudit.test.js tests/registrationYearAndSearch.test.js tests/verificationEmailFlow.test.js tests/registrationOtpApi.test.js tests/registrationOtp.test.js tests/profilePreviewPrivacy.test.js tests/authDatabaseFlow.test.js
# Optional: creates a NEW loopback-only fixture database and retains it for review.
$env:RUN_ACADEMIC_DATABASE_TESTS = 'true'
node --test tests/academicProgramsDatabase.integration.test.js
Remove-Item Env:\RUN_ACADEMIC_DATABASE_TESTS
```

Reproduce frontend validation from `C:\Alumni\frontend\alumni-portal`:

```powershell
node --test tests/registrationValidation.test.js tests/membershipProfile.test.js tests/membershipApplication.test.js tests/profilePhotoUpload.test.js
$env:PUPPETEER_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test --test-concurrency=1 tests/academicPrograms.browser.test.js tests/alumniRecordsTable.browser.test.js tests/registrationValidation.browser.test.js
npm.cmd run build
node --test tests/registrationOtpUi.test.mjs
```

## Files changed for this feature

Paths below are relative to the repository root. Other changes already present
in the working tree were preserved.

Backend configuration and schema:

- `backend/config/academicPrograms.json` (new shared source)
- `backend/utils/academicPrograms.js` (new validator)
- `backend/models/AlumniRecord.js`
- `backend/models/AlumniProfile.js`
- `backend/migrations/20261021-add-alumni-major.js` (new)
- `backend/scripts/applyAlumniMajorMigration.js` (new)
- `backend/package.json`

Backend APIs and existing supporting paths:

- `backend/controllers/authController.js`
- `backend/controllers/alumniRecordController.js`
- `backend/controllers/alumniRecordImportController.js`
- `backend/controllers/adminController.js`
- `backend/controllers/profileController.js`
- `backend/controllers/membershipController.js`
- `backend/routes/alumniRecordRoutes.js`
- `backend/services/alumniProfileSave.js`
- `backend/utils/alumniRecordsCsv.js`
- `backend/utils/membershipSchemaAudit.js`

Frontend shared controls and records:

- `frontend/alumni-portal/src/utils/academicPrograms.js` (new)
- `frontend/alumni-portal/src/components/AcademicProgramFields.jsx` (new)
- `frontend/alumni-portal/src/components/AddAlumniModal.jsx`
- `frontend/alumni-portal/src/components/MasterAlumniRecordsPanel.jsx`
- `frontend/alumni-portal/src/components/MasterAlumniRecordsPanel.css`
- `frontend/alumni-portal/src/components/CsvAlumniImportModal.jsx`
- `frontend/alumni-portal/src/components/AlumniRecordsTable.jsx`
- `frontend/alumni-portal/src/components/AlumniSearchBar.jsx`
- `frontend/alumni-portal/src/components/DeleteConfirmationModal.jsx`

Frontend pages:

- `frontend/alumni-portal/src/pages/AlumniRegisterPage.jsx`
- `frontend/alumni-portal/src/pages/RegisterPage.jsx` (existing unrouted form)
- `frontend/alumni-portal/src/pages/ProfilePage.jsx`
- `frontend/alumni-portal/src/pages/RegistrarVerificationQueuePage.jsx`
- `frontend/alumni-portal/src/pages/RegistrarPendingAlumniPage.jsx`
- `frontend/alumni-portal/src/pages/RegistrarDashboardPage.jsx`
- `frontend/alumni-portal/src/pages/RegistrarRecordsPage.jsx`
- `frontend/alumni-portal/src/pages/registrar/useRegistrarAdminData.js`
- `frontend/alumni-portal/src/pages/AdminAlumniPage.jsx`
- `frontend/alumni-portal/src/pages/admin/AdminUsersPage.jsx` (preserves earlier UI work)
- `frontend/alumni-portal/src/pages/admin/AdminVerificationPage.jsx`

Tests and this report:

- `backend/tests/academicPrograms.test.js` (new)
- `backend/tests/academicProgramsDatabase.integration.test.js` (new)
- `backend/tests/alumniCsvImport.test.js`
- `backend/tests/authDatabaseFlow.test.js`
- `frontend/alumni-portal/tests/academicPrograms.browser.test.js` (new)
- `frontend/alumni-portal/tests/alumniRecordsTable.browser.test.js` (extends prior work)
- `frontend/alumni-portal/tests/registrationValidation.browser.test.js`
- `frontend/alumni-portal/tests/registrationOtpUi.test.mjs`
- `backend/docs/alumni-program-major-integration.md` (new)
