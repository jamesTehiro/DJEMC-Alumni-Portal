# Chat attachment reference length repair

`messages.file_url` and legacy `employermessages.attachment` used Sequelize
STRING (VARCHAR(255)). Private Cloudinary references are `cld:` plus base64url
JSON containing provider, resourceType, type, publicId, URL and originalName.
Encoding expands JSON size; ordinary image references can exceed 255 characters.
Strict MySQL rejects these inserts with ER_DATA_TOO_LONG/1406. This migration
widens both reference columns to TEXT; metadata and Cloudinary encoding stay intact.
TEXT supports up to 65,535 bytes. Wider existing TEXT types are retained.

`file_name` and `file_mime` remain VARCHAR metadata fields; they do not contain
the encoded reference. ApplicationDocument.file_path has a separate TEXT repair
already in this repository; it is not replayed here. Other profile/document
storage fields are outside this chat-only migration.

## Deployment and exact SQL

Use the existing standalone, identity-checked repair process. The older
`migrate:message-attachments` command targets capitalized tables and only adds
metadata; it is not the repair for this production error. This new runner
never calls sync or replays unrelated migrations.

1. Confirm the intended Aiven host and database against Render's DB_HOST and
   DB_NAME. Back up the database using the established procedure. MySQL DDL
   can acquire metadata locks and commits independently; choose a quiet window.
2. Deploy the migration, runner and model changes. From Render's backend
   directory, run the check-only command with actual reviewed values:

```sh
node scripts/applyChatAttachmentReferenceMigration.js --database ACTUAL_DB_NAME --host ACTUAL_AIVEN_HOST
```

3. Review column types, nullability, defaults and charset/collation. Then apply:

```sh
node scripts/applyChatAttachmentReferenceMigration.js --apply --database ACTUAL_DB_NAME --host ACTUAL_AIVEN_HOST
```

The runner uses Render's existing DB credentials/TLS configuration. If Shell
is unavailable, append the same command to the existing Render Build Command,
preserving install/build steps, or use the supported pre-deploy command.
At repository root use `node backend/scripts/...`. Remove a temporary build
suffix after success. No secrets belong in the command. Do not guess the host
or database or substitute the local development database.

For the ordinary nullable definitions with empty comments, the type change is:

```sql
ALTER TABLE `messages` MODIFY COLUMN `file_url` TEXT NULL DEFAULT NULL;
ALTER TABLE `employermessages` MODIFY COLUMN `attachment` TEXT NULL DEFAULT NULL;
```

The migration's exact generated SQL additionally preserves discovered charset,
collation, comment and nullability. For example, when both are utf8mb4_unicode_ci:

```sql
ALTER TABLE `messages` MODIFY COLUMN `file_url` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '';
ALTER TABLE `employermessages` MODIFY COLUMN `attachment` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '';
```

Do not manually use the nullable example for a NOT NULL column. The runner emits
NOT NULL when appropriate. It requires exact lowercase messages.file_url,
skips an absent legacy employer field, and refuses unexpected definitions,
non-NULL defaults, generated columns or attachment indexes before DDL. Review
such blockers instead of dropping constraints. Re-running safely skips TEXT,
MEDIUMTEXT and LONGTEXT. Partial DDL success can be rerun. Automatic downgrade
refuses to narrow columns and risk truncation. No SequelizeMeta records are
rewritten by the standalone runner; normal CLI execution can also apply this
idempotent migration later.

## Verification

Rerun check-only on Render. Confirm TEXT (or wider) and unchanged nullability.
Restart deployed backend instances after code deployment. With authorized test
accounts, send one image and one supported file through Alumni direct/forum/
course/batch, Employer, Admin Employer and Admin Alumni workflows available to
those roles. Confirm sent records contain complete references, receiving clients
can preview/download identical bytes, and unrelated users cannot retrieve them.
Check deletion/unread behavior and Render logs for absence of 1406.

Read-only aggregate inspection (no message contents):

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
AND ((TABLE_NAME='messages' AND COLUMN_NAME='file_url')
OR (TABLE_NAME='employermessages' AND COLUMN_NAME='attachment'));
SELECT MAX(CHAR_LENGTH(file_url)) AS longest_reference FROM messages;
```

Failed inserts did not create messages; retry only the specific failed send
after checking whether it exists. Existing truncated references are not rebuilt
by this schema change. Production is fixed only after the apply command and
end-to-end checks succeed against the intended Aiven database.

## Regression checks

```sh
node --test tests/chatAttachmentMigration.test.js tests/chatAttachmentRoundTrip.test.js tests/chatAttachmentAccess.test.js tests/objectStorageReferences.test.js tests/messageDeletionPermissions.test.js
```

Set CHAT_ATTACHMENT_DB_TEST=1 to enable the MySQL save/retrieve test using a
connection-local temporary table, dropped afterward. It checks the current
TEXT model declarations and round-trips a reference longer than 1,000 characters
through Sequelize. It does not alter production/application tables or prove
that production's actual columns have already been migrated.
