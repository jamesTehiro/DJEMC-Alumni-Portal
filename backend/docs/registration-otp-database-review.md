# Gmail OTP database review and exact SQL

No production schema/data changes have been applied. The working portal database has not been migrated. Migration execution was tested only in NEW, isolated local MariaDB fixture databases. Actual Aiven MySQL schema inspection and separate Aiven staging validation remain pending secure access and must precede explicit production approval.

## Verified versus unverified evidence

| Item | Working local MariaDB 10.4.32 | Aiven production |
| --- | --- | --- |
| users.email | Nullable VARCHAR(255), full UNIQUE indexes present | Not inspected |
| Duplicate groups under database email comparison | 0 | Not inspected |
| Duplicate groups after trim/lowercase | 0 | Not inspected |
| Duplicate groups after Gmail dot/plus/googlemail normalization | 0 | Not inspected |
| Existing user email-verification fields | None | Not inspected |
| Registration OTP table | Absent | Not inspected |
| users.id | Signed INT primary key | Not inspected |
| users engine/collation | InnoDB / utf8mb4_general_ci | Not inspected |

The User model already declares email uniqueness. Model declarations are not proof of production indexes. Existing redundant raw email indexes are retained; this work does not remove or duplicate them. Canonical Gmail uniqueness is stronger than raw email uniqueness and requires its own duplicate audit across ALL roles and statuses, including pending and rejected users.

## Read-only audit and connection requirements

The audit imports no application server, runs no sync and sends no mail. Its default is read-only:

```sh
# From backend/, using securely configured read-only credentials
node scripts/applyRegistrationOtpMigration.js --environment staging --host <expected-host> --database <expected-database>
```

For remote access, configure MIGRATION_DB_HOST, MIGRATION_DB_PORT, MIGRATION_DB_NAME, MIGRATION_DB_USER, MIGRATION_DB_PASS and the Aiven CA through MIGRATION_DB_CA_FILE if required. Remote migration/audit connections verify TLS certificates. Without dedicated configuration, read-only mode can inspect the existing DB_* target; apply mode requires dedicated MIGRATION_DB_* credentials and never falls back to runtime credentials. Host/database mismatches abort before inspection or DDL.

Obtain schema-only outputs privately with a verified-TLS database client:

```sql
SELECT DATABASE(), VERSION();
SHOW CREATE TABLE users;
SHOW INDEX FROM users;
SHOW CREATE TABLE alumniprofiles;
SHOW CREATE TABLE alumnirecords;
SHOW CREATE TABLE rate_limit_entries;
SHOW INDEX FROM rate_limit_entries;
SHOW TABLES LIKE '%verif%';
SHOW TABLES LIKE '%otp%';
```

Review any suitable existing verification fields/tables for reuse. The draft stops on other identifiable email verification tables or incompatible user verification fields instead of silently creating a parallel implementation. A compatible nullable email_verified_at is reused. Also confirm shared rate-limit uniqueness on (scope, key, window_start), exact engine/collation, key types, generated columns, triggers and partitioning.

## Exact proposed additions

These are reviewable SQL statements, NOT an instruction to execute production changes now. They correspond to migration `20261019-add-registration-gmail-otp.js`, assuming its schema preconditions match the actual target. Execute only missing additions through the guarded command, after staging and approval.

The timestamp column must be added BEFORE indexing the virtual column: MariaDB 10.4 cannot perform that later timestamp addition with INSTANT once an indexed virtual column exists. This ordering was verified in the isolated integration run.

```sql
ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL DEFAULT NULL,
  ALGORITHM=INSTANT;

ALTER TABLE users
  ADD COLUMN normalized_email VARCHAR(255)
  GENERATED ALWAYS AS (
    CASE
      WHEN SUBSTRING_INDEX(LOWER(TRIM(email)), '@', -1)
           IN ('gmail.com', 'googlemail.com')
      THEN CONCAT(
        REPLACE(
          SUBSTRING_INDEX(
            SUBSTRING_INDEX(LOWER(TRIM(email)), '@', 1), '+', 1
          ), '.', ''
        ), '@gmail.com'
      )
      ELSE LOWER(TRIM(email))
    END
  ) VIRTUAL,
  ALGORITHM=INPLACE,
  LOCK=NONE;

ALTER TABLE users
  ADD UNIQUE INDEX users_normalized_email_uq (normalized_email),
  ALGORITHM=INPLACE,
  LOCK=NONE;

CREATE TABLE IF NOT EXISTS registration_email_verifications (
  email_key VARCHAR(254) NOT NULL,
  email VARCHAR(254) NOT NULL,
  session_hash VARCHAR(64) NOT NULL UNIQUE,
  otp_hash VARCHAR(64) NULL,
  status VARCHAR(16) NOT NULL,
  expires_at DATETIME(3) NULL,
  verified_at DATETIME NULL,
  consumed_at DATETIME NULL,
  consumed_by_user_id INT NULL,
  sent_at DATETIME(3) NOT NULL,
  resend_history JSON NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (email_key),
  FOREIGN KEY (consumed_by_user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
```

No original email values, accounts, alumni/employer profiles, official alumni records, applications, employment histories or role/status assignments are changed by these statements. Existing users receive NULL email_verified_at and are not required to repeat Gmail verification. No IDs are reset. The new verification table has a string primary key and does not alter users' auto-increment behavior.

INSTANT and INPLACE requirements have no automatic copying fallback. Unsupported versions, partitioning, key types or table definitions must stop for review, rather than rebuilding/recreating users. The earlier STORED-column draft was revised because adding a stored generated column can copy a table. Even supported in-place DDL can acquire metadata locks and build indexes; measure this on Aiven staging. See [MySQL generated-column DDL](https://dev.mysql.com/doc/refman/8.0/en/alter-table-generated-columns.html).

## Duplicate preflight SQL

Aggregate counts only; no personal addresses are returned. Run before proposing/application of any new uniqueness constraint. The migration checks canonical collisions before its FIRST schema addition. Multiple NULL email values are preserved.

```sql
SELECT COUNT(*) AS duplicate_groups
FROM (
  SELECT email FROM users WHERE email IS NOT NULL
  GROUP BY email HAVING COUNT(*) > 1
) AS collisions;

SELECT COUNT(*) AS duplicate_groups
FROM (
  SELECT LOWER(TRIM(email)) AS email_key
  FROM users WHERE email IS NOT NULL
  GROUP BY email_key HAVING COUNT(*) > 1
) AS collisions;

SELECT COUNT(*) AS duplicate_groups
FROM (
  SELECT CASE
    WHEN SUBSTRING_INDEX(LOWER(TRIM(email)), '@', -1)
         IN ('gmail.com', 'googlemail.com')
    THEN CONCAT(REPLACE(
      SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(TRIM(email)), '@', 1), '+', 1),
      '.', ''), '@gmail.com')
    ELSE LOWER(TRIM(email))
  END AS email_key
  FROM users WHERE email IS NOT NULL
  GROUP BY email_key HAVING COUNT(*) > 1
) AS collisions;
```

If collisions exist, stop and present a separate owner-reviewed resolution plan. No automated deletion, merging, overwrite or email renaming is authorized. A concurrent conflicting write after preflight must make unique-index creation fail safely; do not use IGNORE to force it through.

## Staging gate and execution commands

Local integration verified additive SQL, preserved synthetic legacy records, idempotence, real unique constraints/row locks, concurrent registration, incorrect attempts, rolling resend limits, rollback of failed profile creation, legacy login and Registrar approval/rejection notifications. Evidence: `tmp/registration-otp-local-db-test.json` and `tmp/registration-otp-database-and-service-final.log`. This is MariaDB evidence and does not establish Aiven MySQL compatibility.

A separate Aiven staging database must match production's MySQL version, schema/key definitions, engine/collation and relevant triggers. Record original values/counts, run duplicate audits, apply only this migration, compare original records, rerun for idempotence, check locking and application/email/upload behavior, and report results before requesting production approval. Isolate recipient addresses or mock mail on staging.

```sh
# Separate, confirmed staging credentials/target only
node scripts/applyRegistrationOtpMigration.js --apply --environment staging --host <staging-host> --database <staging-database>

# Only AFTER successful staging, backup/recovery point and explicit production approval
node scripts/applyRegistrationOtpMigration.js --apply --environment production --production-approved --host <aiven-host> --database <production-database>
```

The production flag is a command guard, not approval. The operator account needs only schema inspection/SELECT, the specific ALTER/INDEX on users, CREATE for the OTP table and REFERENCES permission. Runtime credentials should not gain DDL privileges. Do not run all historical migrations or execute the application server as an audit tool. Ordinary startup now checks readiness without applying migrations or creating tables; ENABLE_DB_SYNC must remain unset/false.

## Rollback and partial failure

MySQL DDL implicitly commits. A surrounding Sequelize transaction or SQL ROLLBACK will not undo these schema additions. See [MySQL implicit commits](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html).

1. Restore the previously reviewed backend/frontend application release while retaining the additive schema. Review that old backend's startup first: it previously auto-ran an unrelated employer permit migration and must not unexpectedly mutate production during rollback.
2. Keep users.email_verified_at, normalized_email, users_normalized_email_uq and the verification table/history. Existing source can ignore extra fields, while canonical email uniqueness remains enforced. Verify this behavior on staging.
3. If a DDL step fails, retain completed additions, inspect the partial state and resolve only the specific blocker under review. Re-run the guarded, idempotent migration only after review. Do not delete objects or records to force a clean-looking state.
4. down() deliberately refuses destructive schema removal. A physical rollback removing the new table/column/index conflicts with the user's preservation rules and requires a separate reviewed authorization; no destructive rollback SQL is supplied or executed.
5. Establish a verified Aiven backup/recovery point before approved production execution. A full database restore is not routine rollback because it can overwrite legitimate writes made after that backup.

The original runtime database SSL configuration remains a separate connection-security finding (legacy rejectUnauthorized=false). The new dedicated migration connection verifies TLS; review runtime CA verification separately before production sign-off.

See [the implementation/deployment report](registration-otp-implementation-report.md) for files, APIs, security controls, environment variables, test outcomes, deployment order, Firebase and GitHub commands, and remaining approval steps.
