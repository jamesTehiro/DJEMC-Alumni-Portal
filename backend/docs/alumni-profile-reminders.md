# Optional Alumni profile reminders

The monthly reminder uses the existing `notifications` table, authenticated notification API and notification page. It is **in-app only**: no email is queued, and no Brevo/OTP settings or existing email workflows are changed. It has no effect on account access, profile contents or eligibility for portal features.

Title: **Profile Update Reminder**

Message: “You may review and update your profile information whenever convenient to help keep your alumni records accurate and up to date. This reminder is optional.”

## Behavior and persistence

- Only `users.role = 'alumni' AND account_status = 'verified'` qualifies. Eligibility is checked again after locking the account, so a stale scheduler candidate cannot notify a suspended, deleted or reassigned account.
- A first reminder is due 30 days after the most recent account/profile timestamp (`users.createdAt`, `users.updatedAt`, `alumniprofiles.updatedAt`). The account timestamp covers name/email changes. Accounts already older than that interval can receive their first reminder on the first enabled run. Missing historical timestamps start a fresh 30-day interval.
- Each new reminder advances the schedule by exactly **30 × 24 hours**, from the actual reminder time. Downtime does not generate a backlog of missed reminders.
- A successful Alumni `PUT /api/profile` resets the schedule in the same transaction as the profile save, including partial saves. A failed save rolls back the clock too. The worker also reconciles later profile/account timestamps after a paused worker or rolling deployment; reconciliation never brings a reminder forward.
- The clock comes from MySQL `CURRENT_TIMESTAMP(3)`, using the existing Sequelize MySQL UTC session/date conversion. There is no calendar-month or local-midnight calculation. Notification timestamps retain the existing browser display convention.
- The per-user schedule is independent of notification rows. Read/dismiss operations never clear it. Dismiss uses the existing owner-checked `DELETE /api/notifications/:id` and survives reload/restart. A failed dismissal leaves the reminder visible with an error. Other notifications retain their existing delete/undo behavior.
- **View Profile** marks the notification read using the existing API and opens `/profile`. There is no blocking modal or completion requirement. The existing manual `profile_update_request` notification remains separate and retains its existing action/status behavior.

Every scheduler/profile-save transaction locks the `users` row first, then its reminder state. This protects the first insert as well as subsequent cycles across multiple API/worker processes. Reminder insertion and clock advancement commit together in InnoDB; a failure rolls both back. The worker retries failed accounts on the next run and continues processing other accounts. Keyset batches contain at most 100 account IDs. A run starts immediately, then waits one poll interval after completion; shutdown finishes the active account transaction and stops further work.

## Migration and configuration

The additive, idempotent migration is `20261103-create-alumni-profile-reminders.js`. It creates only `alumni_profile_reminders`:

| Column | Definition |
| --- | --- |
| `user_id` | signed INT, NOT NULL, primary key, FK to `users.id`, ON DELETE/UPDATE CASCADE |
| `next_reminder_at` | DATETIME(3), NOT NULL |
| `last_reminded_at` | DATETIME(3), nullable |
| `last_profile_updated_at` | DATETIME(3), nullable |

There are no changes to existing notification/user/profile columns and no additional index beyond the `user_id` primary key. The migration/worker preflight requires InnoDB owners, notifications and clock tables, compatible column definitions, the single-column primary key and the owner cascade. It refuses incompatible existing structures rather than repairing them silently. No runtime startup DDL is introduced.

The owner cascade deletes only this private clock when an account is permanently deleted. The account-deletion dependency allowlist/documentation explicitly includes it; existing shared-content retention and the deletion enablement policy are unchanged. The historical metadata snapshot is not rewritten to pretend this migration has run.

| Environment variable | Default / requirement |
| --- | --- |
| `ALUMNI_PROFILE_REMINDERS_ENABLED` | `false` unless exactly `true`. Set consistently on all API and worker instances **after migration**. Enables atomic profile-save clock tracking and reminder scheduling. |
| `ALUMNI_PROFILE_REMINDER_EMBEDDED_WORKER` | Embedded worker starts with the API unless exactly `false`. Set to `false` on APIs if using a dedicated worker. Keep reminders enabled on the API so saves continue resetting the clock. |
| `ALUMNI_PROFILE_REMINDER_POLL_MS` | `3600000` (one hour); integer between `60000` and `2147483647`. This is scheduling frequency, not the 30-day user interval. |
| Existing `DB_*`, `NODE_ENV`, `DB_CA_FILE` | Same reviewed database and verified TLS configuration as the API. No new database credentials are required. |
| `MIGRATION_DB_CA_FILE` | Required by the migration runner for a remote host; use the trusted database CA file. |

The embedded worker inherits API runtime variables and Node arguments. A standalone worker must receive the same database, feature flag and explicitly selected environment configuration. Existing shared `.env` defaults remain unchanged; a file named `.env.staging` is not automatically selected. Use Node `--env-file=.env.staging` explicitly when appropriate, and verify the target is actually staging. Render uses its service environment variables independently; never upload `.env.staging` or assume its name guarantees an isolated database.

## Deployment steps (operator-run only)

No production settings, migrations, notifications, commits, pushes or deployments were performed for this task.

1. Review the changes and target host/database privately. Take an Aiven backup/PITR recovery point and verify its restore procedure. Optionally take an encrypted, access-controlled logical backup with a trusted MySQL client. Do not put credentials on a command line or commit backup files. An example interactive-password command is:

   ```powershell
   mysqldump --host=REVIEWED_HOST --port=REVIEWED_PORT --user=BACKUP_USER --password --ssl-mode=VERIFY_IDENTITY --ssl-ca=cert/ca.pem --single-transaction --no-tablespaces --set-gtid-purged=OFF --result-file=REVIEWED_BACKUP_PATH REVIEWED_DATABASE
   ```

2. On a confirmed isolated MySQL 8.4 service, run the fixture acceptance test described below. The migration and real concurrent row-lock behavior still require this live database verification; mocked tests are not a substitute.
3. Keep `ALUMNI_PROFILE_REMINDERS_ENABLED=false` during rollout. From `backend`, inspect only this migration. Replace the explicit host/database placeholders with the independently reviewed target. These commands read secrets from the selected environment; they never display them:

   ```powershell
   $env:MIGRATION_DB_CA_FILE = (Resolve-Path .\cert\ca.pem).Path
   node --env-file=.env.staging scripts/applyAlumniProfileReminderMigration.js --host REVIEWED_HOST --database REVIEWED_DATABASE
   ```

4. After reviewing the plan and backup, apply the one additive migration, then repeat the read-only inspection:

   ```powershell
   node --env-file=.env.staging scripts/applyAlumniProfileReminderMigration.js --apply --host REVIEWED_HOST --database REVIEWED_DATABASE
   node --env-file=.env.staging scripts/applyAlumniProfileReminderMigration.js --host REVIEWED_HOST --database REVIEWED_DATABASE
   node --env-file=.env.staging workers/alumniProfileReminderWorker.js --check
   ```

   The apply runner verifies host/database identity, uses the existing connection-pinned migration advisory lock and a 15-second metadata lock-wait limit, and reports remaining changes. MySQL DDL commits independently; a created table is not rolled back by a later preflight error. Inspect and rerun the idempotent command rather than dropping/recreating the table. Do not replay all historical migrations.

   For Render's Linux shell, use runtime variables rather than `.env.staging`:

   ```sh
   MIGRATION_DB_CA_FILE=cert/ca.pem node scripts/applyAlumniProfileReminderMigration.js --host REVIEWED_HOST --database REVIEWED_DATABASE
   MIGRATION_DB_CA_FILE=cert/ca.pem node scripts/applyAlumniProfileReminderMigration.js --apply --host REVIEWED_HOST --database REVIEWED_DATABASE
   node workers/alumniProfileReminderWorker.js --check
   ```

5. Deploy the reviewed backend and frontend. After staging acceptance, configure `ALUMNI_PROFILE_REMINDERS_ENABLED=true` on the APIs and chosen worker environment. The default embedded worker requires no separate scheduler service. For a dedicated worker, disable embedding on APIs and use the start command `npm run profile-reminder-worker`; leave the API feature flag enabled for transactional resets. Multiple workers are safe, though one dedicated worker usually avoids unnecessary scans. No email-worker configuration changes are required.
6. With synthetic staging Alumni only, verify a due reminder, View Profile, dismiss/reload, successful profile save postponement, excluded roles and concurrent runs. Confirm existing warnings, announcements and interview notifications still work. Inspect aggregate counts without exposing personal data:

   ```sql
   SELECT COUNT(*) AS non_alumni_recipients
   FROM notifications n JOIN users u ON u.id = n.userId
   WHERE n.type = 'profile_update_reminder' AND u.role <> 'alumni';

   SELECT COUNT(*) AS reminders_less_than_30_days_apart
   FROM notifications a JOIN notifications b
     ON a.userId = b.userId AND a.id < b.id
    AND b.createdAt >= a.createdAt
    AND b.createdAt < DATE_ADD(a.createdAt, INTERVAL 30 DAY)
   WHERE a.type = 'profile_update_reminder' AND b.type = 'profile_update_reminder';
   ```

7. Monitor `[ALUMNI_PROFILE_REMINDER_START_FAILED]`, `[ALUMNI_PROFILE_REMINDER_ACCOUNT_FAILED]` and `[ALUMNI_PROFILE_REMINDER_RUN_FAILED]`. Startup readiness refuses an enabled but unmigrated configuration. No recipient names, emails, profile contents or raw SQL/connection errors are logged by this worker.

To pause reminders while retaining profile-save tracking, stop the standalone worker or disable embedding and restart APIs. For a complete feature rollback, set the enable flag to `false` and redeploy/restart. Keep the additive table and its timestamps so re-enabling cannot repeat an already completed cycle. There is deliberately no destructive `down` migration. Code rollback does not remove reminders already displayed; users can still dismiss them through the existing API.

## Verification commands and limits

Backend regression command from `backend` (ordinary tests mock persistence; no email transport runs):

```powershell
node --test --test-concurrency=2 tests/alumniProfileReminders.test.js tests/alumniProfileReminderMigration.test.js tests/alumniProfileRemindersDatabase.integration.test.js tests/membershipProfileSave.test.js tests/notificationWorkflows.test.js tests/notificationInterviewDetails.test.js tests/notificationAudit.test.js tests/graduateEmploymentMetrics.test.js tests/accountDeletion.test.js tests/modelTableMappings.test.js
```

The opt-in database harness ignores application `.env` files, accepts only loopback hosts, checks MySQL **8.4** before any writes, creates a uniquely named new fixture schema and retains it for inspection. It never alters or removes a pre-existing schema. Supply fixture credentials privately as environment variables, without printing them:

```powershell
$env:RUN_ALUMNI_REMINDER_DATABASE_TESTS = 'true'
$env:ALUMNI_REMINDER_TEST_HOST = '127.0.0.1'
$env:ALUMNI_REMINDER_TEST_PORT = '3311'
node --test tests/alumniProfileRemindersDatabase.integration.test.js
Remove-Item Env:RUN_ALUMNI_REMINDER_DATABASE_TESTS
```

Optional `ALUMNI_REMINDER_TEST_USER` / `ALUMNI_REMINDER_TEST_PASSWORD` default to local fixture root / empty password; set them privately if required. The harness verifies repeated migration without changing existing users, concurrent first reminders, role exclusions, persistent dismissal, later cycles, transaction rollback/retry and profile-save reset timing. MariaDB does not satisfy this acceptance test.

Frontend commands from `frontend/alumni-portal`:

```powershell
$env:PUPPETEER_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests/alumniProfileReminders.browser.test.js
node node_modules/eslint/bin/eslint.js src/features/notifications/pages/NotificationPage.jsx tests/alumniProfileReminders.browser.test.js
npm.cmd run build -- --mode production
```

Browser tests use the actual notification page, synthetic records, mocked APIs and blocked external requests. They check exact title, optional message, nonblocking presentation, View Profile/read behavior, successful/failed/persistent dismissal, existing warning/manual-request actions and desktop/mobile layout.

Final validation:

- Backend: **49 passed, 0 failed, 1 skipped** across the ten files in the command above. The skipped case is the explicitly opt-in MySQL 8.4 acceptance harness. Coverage includes first/delayed/subsequent reminders, persistent restart/dismiss behavior, multiple scheduler instances, account exclusions, pagination, failed transaction retry, successful/failed actual profile saves, saves while scheduling is paused, and existing announcement/warning/interview/audit/profile/graduate-count/deletion/model regressions.
- Frontend: **1 comprehensive browser test passed**, including desktop/mobile behavior and existing notification actions. Chrome required execution outside the sandbox after the initial sandboxed launch timed out; all API calls remained mocked and external requests blocked.
- Targeted ESLint: passed for the notification page and new browser test. This does not claim unrelated project-wide lint findings are resolved.
- Production Vite build: passed with `--mode production` (2m 1s); existing empty-chunk warnings remain nonfatal.
- Backend syntax and scoped whitespace checks: passed.

Local evidence: `tmp/profile-reminders-backend-verified.log`, `tmp/profile-reminders-browser-verified.log`, `tmp/profile-reminders-lint-final.log`, `tmp/profile-reminders-build-final.log` (workspace logs; not deployment assets).

The local fixture port `127.0.0.1:3311` had no listener. Live MySQL 8.4 migration/concurrency acceptance and applying the migration remain deployment prerequisites; no production database was queried or modified during this task.

## Files changed for this feature

- `backend/models/AlumniProfileReminder.js`, `backend/models/index.js`
- `backend/migrations/20261103-create-alumni-profile-reminders.js`
- `backend/services/alumniProfileReminders.js`, `backend/services/alumniProfileSave.js`
- `backend/workers/alumniProfileReminderWorker.js`, `backend/server.js`
- `backend/scripts/applyAlumniProfileReminderMigration.js`, `backend/package.json`
- `backend/services/accountDeletion.js`, `backend/docs/account-deletion.md` (recognize the new private owner dependency)
- `backend/tests/alumniProfileReminders.test.js`, `backend/tests/alumniProfileReminderMigration.test.js`, `backend/tests/alumniProfileRemindersDatabase.integration.test.js`
- `backend/tests/modelTableMappings.test.js` (register the new model), `backend/tests/notificationWorkflows.test.js` (supply the existing announcement path's schema-inspection mock)
- `frontend/alumni-portal/src/features/notifications/pages/NotificationPage.jsx`, `NotificationPage.css`
- `frontend/alumni-portal/tests/alumniProfileReminders.browser.test.js`
- This deployment report.

Other pre-existing working-tree changes belong to earlier tasks and are outside this feature.
