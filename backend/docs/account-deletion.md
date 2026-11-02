# Administrator account deletion

Latest production readiness review (2026-11-02): **NO-GO**. See [the exact inventory, current blockers, verification results and operator checklist](account-deletion-production-readiness.md). The main remote server is MySQL 8.4.11, but no separate staging service was confirmed and the cleanup schema is absent. Prior MariaDB fixture evidence below is historical and is not MySQL 8.4 acceptance.

Latest route/modal repair: [production diagnosis, current verification limits and deployment checklist](account-deletion-route-repair.md). Permanent deletion remains disabled.

## Dependency map (prepared before implementation)

Source inspection covered both settings scopes, admin routes/status actions, authentication, every registered Sequelize model/association, historical migrations, private storage, messaging, email queue and audit logging. `account-deletion-schema.json` records a metadata-only inspection of the configured remote MySQL database. All existing tables use InnoDB. Existing CASCADE constraints on users include messages, audit logs and posts: deleting a user directly would destroy retained content. No constraints will be changed.

| Root / key | Dependents | Treatment |
| --- | --- | --- |
| users.id / role=employer | jobs.employer_id | Explicitly delete this employer's jobs only |
| jobs.id | applications.job_id, jobrequirements.job_id, requirementgroups.job_id, jobrequirementsnapshots.job_id | Delete owned records, requirements before groups |
| users.id / role=alumni | applications.alumni_id | Delete applications; preserve employer jobs |
| applications.id | applicationdocuments.application_id, applicationresponses.application_id, jobrequirementsnapshots.application_id, interviews.application_id | Explicit child deletion; capture file references first |
| applicationdocuments.id | applicationdocuments.original_document_id | Detach surviving revision links; clear internal revision links before deletion |
| interviews.id | notifications.interview_id | Detach other users' notifications before interview deletion |
| users.id | resumes.user_id | Delete sections and versions before resumes |
| resumes.id | resumepersonalinfo, resumesummaries, resumeeducations, resumeworkexperiences, resumeskills, resumeprojects, resumecertifications, resumetrainings, resumeseminars, resumeawards, resumeorganizations, resumevolunteerworks, resumelanguages, resumereferences, resumeversions (resume_id) | Delete explicit scoped rows |
| users.id | alumniprofiles.user_id -> employmenthistories.alumni_id; employerprofiles.user_id; notifications.userId; password_reset_tokens.user_id; message_send_requests.sender_id; alumniprofileupdaterequests.alumni_user_id; registration_email_verifications.consumed_by_user_id | Delete account-owned rows; never delete by email alone |
| users.id | messages.sender_id, posts.user_id, comments.user_id, auditlogs.actor_id, employerconversations.employerId/adminId, employermessages.senderId, conversations.user1Id/user2Id, membershipapplications.alumni_user_id | Preserve content; reassign references to a distinct protected identity for this deletion |
| users.id | conversationparticipants.user_id | Remove departing group membership; retain a protected identity in direct threads so remaining participants can still read history |
| users.id | announcements.admin_id, document/response reviewers, profile-update requester, membership permission grantor | Preserve records and reassign actor references |
| users.alumni_record_id -> alumnirecords.id | Official Registrar master list | Always preserve; deletion of a referencing user does not delete the master |
| email_queue_jobs | `to` recipient; no account FK | Preserve history; cancel pending/failed deliveries to verified target email; block deletion while a delivery is processing |
| private files | application paths/documents, proof/permit metadata, resume photos | Durable cleanup outbox in deletion transaction; cleanup after commit only; keep files still referenced by any retained record |

## Approved retention decisions

On 2026-11-02 the user approved retaining shared messages, forum content, shared attachments, audit logs and email history, and explicitly requested preserving **all membership forms, including drafts**. A separate inactive `deleted` identity per removed account preserves NOT NULL references and unique membership/employer-conversation ownership. It has no password, no original email, no profile, no Registrar link, and cannot be targeted by these endpoints. Membership forms retain their existing institutional content. Audit metadata, message bodies, email history and forum content are retained as approved; this is not a promise to erase all historical personal information.

Account-owned applications (including employer-job application histories/snapshots), saved resumes, profiles, login credentials, reset tokens and private documents are removed. Alumni applying to deleted jobs remain users. Personal documents reused elsewhere remain in storage. No retention category is silently resolved by a database cascade.

## Transaction order

1. Recheck authenticated admin scope and verified primary key; lock actor and selected account; reject protected/self/missing accounts. Verify actual schema, InnoDB engines and incoming FK map. Recompute and compare the previously displayed impact token.
2. Lock recipient email jobs; refuse in-flight delivery and cancel queued deliveries. Create the protected retention identity and reassign shared/institutional actor references. Replace direct-thread participation with that identity, remove departing group membership and delete account request/token records.
3. Detach retained interview notifications and document revision links. Delete document/response/snapshot/interview rows, then applications. Delete job requirements, groups, remaining job snapshots and employer jobs.
4. Delete resume sections/versions, resumes, employment history, profiles and owned notifications. Write mandatory audit event and private-file cleanup outbox records. Delete original user last. Any failure rolls back all database changes.
5. A separately invoked cleanup worker handles committed outbox entries, checks surviving references and retries provider failures. It never runs inside the account-deletion transaction or automatically during development. Existing employer conversations remain visible as read-only history; direct messages retain a visible deleted participant. Backend send endpoints reject new messages to these identities.

## Endpoints and confirmation

Both `/api/admin/alumni/users/:userId` and `/api/admin/employer/users/:userId` accept `DELETE` with `{ confirmation: "DELETE", confirmationToken }`. Obtain the signed, ten-minute token using `GET` on the same path plus `/deletion-impact`. It binds the acting administrator, target primary key, target role, policy and exact dependency snapshot. A changed dependency, expired token or mismatched account requires a fresh preview. Preview never creates identities, outbox rows or audit records.

Authentication uses current database account state, then the existing admin-role and scope middleware. The service rechecks the actor under a transaction lock, rejects self/admin/other-role/deleted targets, and optionally protects additional account IDs using comma-separated `ACCOUNT_DELETION_PROTECTED_IDS`.

All preserved membership content remains institutional data. Read-only retained messages and their attachments remain subject to existing participant/admin access checks. No broad FK changes, global FK disabling or account lookup by email are used.

## Production gate and recovery

Permanent deletion remains disabled unless `ACCOUNT_DELETION_POLICY=retain-memberships-v1` is explicitly configured after review. Preview remains read-only. No production deletion, deployment, automatic migration, commit or FK modification is authorized by this implementation task.

Production checklist:

- Review this policy, the checked-in FK inventory, target-specific impact counts and explicit production deletion approval.
- Verify the deployment target privately and take a consistent MySQL backup. Test restore/PITR and record the recovery point. Arrange a separate restricted backup/version retention policy for external objects.
- Run the fixture tests against isolated MySQL 8.4 staging before enabling production. The available local fixture engine was MariaDB 10.4.32; it is not a substitute for MySQL 8.4 acceptance testing.
- Keep `ACCOUNT_DELETION_POLICY` unset while deploying. From the reviewed backend runtime, `npm run migrate:account-deletion` checks readiness only. The explicitly invoked apply command is `npm run migrate:account-deletion -- --apply --host REVIEWED_HOST --database REVIEWED_DATABASE`, replacing both placeholders with the independently reviewed configured target. This runner applies only the additive `account_deletion_files` migration. No historical migration set should be replayed.
- Deploy backend/frontend together, set any protected IDs, verify read-only previews and existing account actions, and review authorization results. The runtime also refuses unknown incoming FKs and missing/nontransactional required tables.
- After explicit production approval, configure `ACCOUNT_DELETION_POLICY=retain-memberships-v1` for the backend and the cleanup worker. Start the separately managed worker with `npm run account-deletion-cleanup`. Enable this feature only after the worker's schema/storage access and monitoring are ready.
- For each real deletion, review fresh counts and type `DELETE`. Inspect the mandatory `account.permanently_deleted` audit record, affected portals and cleanup queue. Do not use a production account for a development smoke test.

Rollback code deployment does not restore deleted accounts or files. Database recovery requires a reviewed backup/PITR restore and reconciliation of later writes. External object deletion is irreversible without provider backups. Pause cleanup to retain committed pending files during an incident. Never reset cleanup history or replay destructive migrations to recover.

Cleanup uses leased outbox entries, exponential retries and crash recovery. Successful or already-missing Cloudinary objects count as completed; provider errors do not. Files referenced by retained rows, JSON snapshots, membership forms or shared messages are marked `retained`. Unsupported/unsafe references and ten failed attempts become `manual_review`, with their references retained for an operator. Public URLs without a deletable provider reference require manual review; they are not reported as successful deletion. Credentials, file references, email bodies and SQL errors are not printed by the deletion/cleanup handlers. Provider deletion is exercised through mocked responses only in development. Reference scans use primary-key pagination; assess scan cost on the staging data volume and avoid introducing new references to retired objects during cleanup.

## Validation

Editable resume photo URLs, snapshot-only file references and profile image URLs do not prove that an object belongs to the account. They are recorded as `manual_review / OWNERSHIP_REVIEW` unless the same reference is also present in a server-managed owned upload field. Review upload provenance before releasing these entries for cleanup; an arbitrary URL or crafted reference must never authorize deletion of unrelated storage assets.

Verified on 2026-11-02:

- Isolated loopback database integration: new fixture schema only; repeated additive migration, real transactions/FKs, employer and alumni deletion, accurate preview counts, protected/missing/wrong-role targets, stale and cross-account tokens, duplicate concurrent requests, queued email cancellation/in-flight blocking, late-failure rollback (including audit/outbox/shared identity changes), unknown dependency rejection, preserved Registrar/membership drafts/unrelated users/resumes/jobs, retained messaging reads and blocked sends, real authenticated HTTP preview/deletion, and storage retry/crash recovery all passed.
- Four focused safety tests passed: authorization/confirmation before DB access, canonical shared-file identities and unsafe paths, non-destructive migration rollback guard, and strict Cloudinary outcome handling. External storage responses are mocked; no real cloud objects were deleted.
- 58 existing backend regression tests passed across account status, current-session authentication, Registrar deletion, resume persistence, messaging transport/attachments/access and object-storage references. Another earlier focused run passed 40 tests including message-deletion permissions.
- Both settings pages passed the browser fixture on desktop (Employer) and 390px mobile (Alumni): disabled/unavailable preview handling, exact typed confirmation, real count rendering, duplicate submission guard, loading/cancel state, failure preserving table rows, success removing only the confirmed row, and existing deactivate/reactivate/password-reset actions. Screenshots were visually inspected.
- Vite production build passed. Lint passed for the new modal, settings page and browser test. Existing messaging-page lint findings are unchanged: AdminEmployerMessagesPage has 5 errors/2 warnings and MessagesPage has 8 errors/1 warning; a comparison to `HEAD` verified no new findings.

Reproduce from `backend` with `node --test tests/accountDeletion.test.js`. The DB integration is opt-in with `RUN_ACCOUNT_DELETION_DATABASE_TESTS=true` and a disposable loopback server on `ACCOUNT_DELETION_TEST_PORT` (default 3311); it creates a new `djemc_account_deletion_*_test` schema and retains fixtures for review. It ignores the remote `.env` target and never connects to Aiven. From `frontend/alumni-portal`, run `node --test tests/accountDeletion.browser.test.js` with `PUPPETEER_EXECUTABLE_PATH` pointing to local Chrome. Never point deletion fixtures at production.

No production deletion, production migration, deployment or commit was performed. The remote database was used only for metadata reads during dependency inspection.
