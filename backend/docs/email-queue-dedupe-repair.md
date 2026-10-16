# Repair email queue deduplication schema

The model requires `email_queue_jobs.dedupe_key` to be nullable `VARCHAR(191)`, with a full single-column unique index. Omitted keys remain NULL; MySQL allows multiple NULLs in a unique index. Non-NULL duplicate keys must not be silently rewritten or deleted.

The existing `20261012-add-job-interview-invitations.js` migration also touches capitalized Jobs and Notifications tables. Do not replay that bundled migration as a queue-only production repair. This new migration changes only the exact lowercase email_queue_jobs table.

## Files

- backend/migrations/20261016-repair-email-queue-dedupe-key.js: additive, idempotent column/index repair with duplicate and compatibility checks.
- backend/scripts/applyEmailQueueDedupeMigration.js: read-only by default; identity-checked --apply affects only the queue schema. Also reports other missing model columns without changing them.
- backend/tests/emailQueueDedupeMigration.test.js: migration and runner tests, including read-only default and wrong-database refusal.
- backend/tests/emailQueueDeduplication.test.js: enqueue keys/NULLs, transactional uniqueness errors, and worker retries preserving keys.
- backend/docs/email-queue-dedupe-repair.md: this deployment guide.

No model, controller, queue-worker, route, UI, existing migration, or application behavior was changed. Existing duplicate detection remains database-backed; transactional unique-key failures propagate so their transaction can roll back. Nontransactional enqueue error handling remains unchanged.

## Before production apply

1. Back up the intended database using your existing procedure. Compare Render DB_HOST, DB_PORT and DB_NAME with the intended production server in Workbench. Do not paste DB_PASS or connection URLs into logs or chat. The previously reported database is defaultdb; verify this rather than assuming it.
2. Deploy the new migration and runner. Run `node scripts/applyEmailQueueDedupeMigration.js --database defaultdb --host EXPECTED_PRODUCTION_HOST` from the backend directory. Replace EXPECTED_PRODUCTION_HOST with the reviewed literal DB_HOST value; it is a hostname, not a URL or password.
3. Review check-only output: connected database, column/index presence, duplicate-group count, and other missing model columns. No writes occur. Other schema gaps require separate review; this repair will not fix them.
4. If existing non-NULL duplicates are reported, stop. Do not delete emails, NULL out keys, or choose a winner automatically. Investigate their business meaning and approve a separate data-reconciliation plan first. Multiple NULL keys do not block this migration.
5. Schedule the index addition while queue writers are paused if practical. MySQL DDL can take metadata locks and commits independently. A concurrent duplicate can cause unique-index creation to fail; the script does not delete records to force success.

## Apply using Render without Shell

Temporarily append the check-only command above to Render's existing Build Command, preserving its install/build steps. Read the build logs. If the build working directory is repository root, use `node backend/scripts/applyEmailQueueDedupeMigration.js` instead of `node scripts/...`.

After reviewing the preflight and confirming host/database, use the following targeted command in that Build Command (or a pre-deploy command if your plan supports it):

    node scripts/applyEmailQueueDedupeMigration.js --apply --database defaultdb --host EXPECTED_PRODUCTION_HOST

The existing schema must already contain the exact lowercase email_queue_jobs table. The runner never creates application tables, never runs sequelize.sync, never applies other migrations, and never changes/deletes email rows. It adds only the nullable column and missing full unique index. It does not mark the older bundled migration as applied or modify SequelizeMeta; future normal migration execution can run the idempotent new migration safely.

If the column already exists with an incompatible type/nullability or the canonical index name has an incompatible definition, the runner stops for manual review. It never narrows existing columns or drops/replaces indexes. If DDL partially succeeds (column added but index fails), leave that safe additive column in place, resolve the reported blocker, and rerun. Automatic down migration intentionally refuses to erase keys or weaken uniqueness; roll back application code while retaining the additive schema if needed.

After a successful migration, remove the temporary apply suffix from the Build Command, deploy/restart all web and queue-worker instances, and rerun the check-only command. Confirm columnPresent=true, uniqueIndexPresent=true, duplicateGroups=0. Verify an authorized operation that queues email, its queued status, retry processing if needed, and repeated-operation deduplication. Use an approved test account/recipient to avoid sending unintended mail. Do not claim production is fixed until this verification succeeds in Render's environment.

## Local verification and limits

The read-only runner connected to local djemc_alumni_db. It found the required column and unique index already present, zero duplicate non-NULL groups, and no missing columns across registered models. This is not evidence of Render's production schema. No migration was applied locally or to production during implementation.

## Independent production API investigation (2026-10-16)

The Render worker log supplied by the user confirms ER_BAD_FIELD_ERROR/1054 for missing email_queue_jobs.dedupe_key. reserveJobs uses EmailQueueJob.findAll without an attributes restriction, so Sequelize selects every modeled column, including dedupe_key, before it can reserve or send a message. The loop therefore fails repeatedly even when no new deduplication operation is attempted. Do not hide these errors or remove the model field; apply and verify the additive migration above.

The other live endpoints were checked independently using read-only requests with the Firebase Origin and no credentials:

| Endpoint | Live response | Confirmed finding |
| --- | --- | --- |
| GET /api/jobs | 500: Table defaultdb.Jobs does not exist | Deployed query uses capitalized Jobs. Current Job model explicitly maps to jobs. This read path does not query EmailQueueJob. |
| GET /api/announcements | 500: Table defaultdb.Announcements does not exist | Deployed query uses capitalized Announcements. Current Announcement model maps to announcements. Public GET uses announcementController.getAnnouncements with admin User and Comment joins, not adminController.getAnnouncements. This read path does not query EmailQueueJob. |
| GET /api/membership/me | 401: No token provided | Expected authentication rejection before the membership controller. No authenticated production failure or root cause was verified. |

Current route chains:

- server.js /api/jobs -> jobRoutes GET / -> jobController.getJobs -> db.Job.findAll, with users/employerprofiles/alumniprofiles and optional jobrequirements/requirementgroups reads. No queue reads on GET.
- server.js /api/announcements -> announcementRoutes GET / -> announcementController.getAnnouncements -> announcements, users (admin alias), comments. Announcement creation may enqueue notifications, but public retrieval does not.
- server.js /api/membership -> membershipRoutes auth middleware -> GET /me -> membershipController.getMyApplication -> verified user, membershipapplications, profile, optional alumnirecords, and employmenthistories prefill. It does not read the email queue. The controller maps missing-table/column errors to 503, so a signed-in status and matching redacted error log/schema audit are needed before selecting a repair. Do not automatically apply membership migrations based on the worker's error.

The uppercase jobs/announcements errors are consistent with an older or different deployed backend revision. Confirm Render's deployed commit and the optional JOB_TABLE_DIAGNOSTICS runtime output after deploying the existing lowercase model patch. The live responses do not establish that Render uses the intended Workbench server. Health or a local connection alone is insufficient.

Added backend/tests/productionReadPaths.test.js verifies actual public announcement SELECT generation (including lowercase joins), authentication blocking before membership reads, and lowercase employment-history SELECT generation for membership prefill. Existing jobs endpoint SQL-generation and membership authorization tests were also run.

Validation for this investigation: 53 focused tests passed, 0 failures; read-only local check found column/index present, duplicateGroups=0 and no other missing model columns. No production migration, data modification, email send, or authenticated production API request was performed. Production remains unverified until the intended database migration is applied and worker/API behavior is checked after deployment.
