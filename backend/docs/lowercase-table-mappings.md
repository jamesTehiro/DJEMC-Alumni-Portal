# Lowercase Sequelize table mappings

Sequelize default pluralization produced capitalized names such as Jobs and EmploymentHistories. Other models explicitly used capitalized tableName values. Windows MySQL with lower_case_table_names=1 masked the mismatch; case-sensitive MySQL deployments can reject these queries.

All 46 initialized models now explicitly target lowercase tables. Existing singular names (requirementlibrary, resumepersonalinfo) and underscore names (email_queue_jobs, password_reset_tokens, rate_limit_entries) are preserved. User, AlumniProfile, EmployerProfile and resume models were already mapped correctly and were not changed.

Only tableName options and five explicit names preserving existing generated index names were changed. Model names, columns, types, timestamp settings, index definitions, association aliases, and foreign-key columns were checked against a pre-change metadata snapshot. Derived foreign-key table references follow the lowercase target mappings.

## Changed model mappings

| Model | Previous table | Existing lowercase table |
| --- | --- | --- |
| EmploymentHistory | EmploymentHistories | employmenthistories |
| Job | Jobs | jobs |
| Application | Applications | applications |
| Announcement | Announcements | announcements |
| Comment | Comments | comments |
| Conversation | Conversations | conversations |
| ConversationParticipant | ConversationParticipants | conversationparticipants |
| Message | Messages | messages |
| Notification | Notifications | notifications |
| Interview | Interviews | interviews |
| AlumniRecord | AlumniRecords | alumnirecords |
| Post | Posts | posts |
| EmployerConversation | EmployerConversations | employerconversations |
| EmployerMessage | EmployerMessages | employermessages |
| RequirementLibrary | RequirementLibrary | requirementlibrary |
| RequirementGroup | RequirementGroups | requirementgroups |
| JobRequirement | JobRequirements | jobrequirements |
| JobRequirementSnapshot | JobRequirementSnapshots | jobrequirementsnapshots |
| ApplicationDocument | ApplicationDocuments | applicationdocuments |
| ApplicationResponse | ApplicationResponses | applicationresponses |
| AuditLog | AuditLogs | auditlogs |
| AlumniProfileUpdateRequest | AlumniProfileUpdateRequests | alumniprofileupdaterequests |
| MembershipApplication | MembershipApplications | membershipapplications |
| MembershipAdministrator | MembershipAdministrators | membershipadministrators |

Chat.js is a legacy, uninitialized file with two definitions; both received the corresponding lowercase tableName without changing its exports or behavior.

## Exact files changed

- `backend/models/AlumniProfileUpdateRequest.js`
- `backend/models/AlumniRecord.js`
- `backend/models/Announcement.js`
- `backend/models/Application.js`
- `backend/models/ApplicationDocument.js`
- `backend/models/ApplicationResponse.js`
- `backend/models/AuditLog.js`
- `backend/models/Chat.js`
- `backend/models/Comment.js`
- `backend/models/Conversation.js`
- `backend/models/ConversationParticipant.js`
- `backend/models/EmployerConversation.js`
- `backend/models/EmployerMessage.js`
- `backend/models/EmploymentHistory.js`
- `backend/models/Interview.js`
- `backend/models/Job.js`
- `backend/models/JobRequirement.js`
- `backend/models/JobRequirementSnapshot.js`
- `backend/models/MembershipAdministrator.js`
- `backend/models/MembershipApplication.js`
- `backend/models/Message.js`
- `backend/models/Notification.js`
- `backend/models/Post.js`
- `backend/models/RequirementGroup.js`
- `backend/models/RequirementLibrary.js`
- `backend/scripts/checkModelTableMappings.js`: new read-only connection identity and exact table-name checker.
- `backend/tests/modelTableMappings.test.js`: regression tests for all initialized models, all factories, generated SQL, foreign-key table references, aliases, timestamps, and preserved index names.
- `backend/docs/lowercase-table-mappings.md`: this audit and deployment report.

## Verification

- Before changes: backend suite passed 219 tests, skipped 10 database integration tests, failed 0.
- After model mapping changes: backend suite passed 222 tests, skipped 10, failed 0.
- Final focused mapping tests: 4 passed, including an additional test for stable index names.
- Frontend production build passed. No frontend source was edited.
- Compared all 46 models against pre-change metadata: attributes, timestamps, indexes and associations match after accounting for lowercase table names and derived references.
- Read-only authentication and information_schema inventory succeeded against the workspace-configured local connection: 127.0.0.1:3306, database djemc_alumni_db, lower_case_table_names=1. All 46 target tables exist with the exact lowercase names.
- Production connection is NOT verified from this workstation: Render connection credentials/environment are not available here. The local result does not establish that Workbench and Render use the same server or database.

## Deployment and separate production verification

1. Deploy these backend changes to Render. No database migration is required for an existing lowercase schema; do not rename tables, run schema sync, or run historical migrations as part of this fix.
2. In Render settings, verify DB_HOST, DB_PORT, DB_NAME (expected defaultdb for the reported error), DB_USER, DB_PASS and NODE_ENV=production identify the intended production database. Keep ENABLE_DB_SYNC disabled.
3. Run `node scripts/checkModelTableMappings.js` from the deployed backend directory in Render Shell. It authenticates and performs SELECT queries only; it never calls sync or performs DDL/DML. It prints configured host/port/database, connected database/server identity, MySQL case mode, and all expected tables. No password or record contents are printed.
4. Confirm the connected production identity against the intended Workbench connection, and verify exists_exactly=true for every model. A missing table or connection error makes the checker exit nonzero; investigate that production schema/configuration rather than creating duplicate tables.
5. Restart/redeploy the backend and verify login/profile employment history and job/application requests no longer report capitalized missing-table errors.

## Complete re-audit: 2026-10-16

No additional model mappings needed changes: the preceding 25-file patch is already present. The central loader registers 46 models. Its only belongsToMany relationships use the registered ConversationParticipant model; no automatic extra join table is generated.

The current audit queried information_schema and executed SELECT 1 FROM each mapped table WHERE 1 = 0. All 46 local mappings passed exact-name and SELECT-permission checks. These queries return no record contents and perform no writes.

| Registered model | Exact local database table | Read-only query |
| --- | --- | --- |
| User | users | passed |
| AlumniProfile | alumniprofiles | passed |
| EmployerProfile | employerprofiles | passed |
| EmploymentHistory | employmenthistories | passed |
| Job | jobs | passed |
| Application | applications | passed |
| Announcement | announcements | passed |
| Comment | comments | passed |
| Conversation | conversations | passed |
| ConversationParticipant | conversationparticipants | passed |
| Message | messages | passed |
| Notification | notifications | passed |
| Interview | interviews | passed |
| AlumniRecord | alumnirecords | passed |
| Post | posts | passed |
| EmployerConversation | employerconversations | passed |
| EmployerMessage | employermessages | passed |
| PasswordResetToken | password_reset_tokens | passed |
| EmailQueueJob | email_queue_jobs | passed |
| RateLimitEntry | rate_limit_entries | passed |
| RequirementLibrary | requirementlibrary | passed |
| RequirementGroup | requirementgroups | passed |
| JobRequirement | jobrequirements | passed |
| JobRequirementSnapshot | jobrequirementsnapshots | passed |
| ApplicationDocument | applicationdocuments | passed |
| ApplicationResponse | applicationresponses | passed |
| AuditLog | auditlogs | passed |
| AlumniProfileUpdateRequest | alumniprofileupdaterequests | passed |
| MembershipApplication | membershipapplications | passed |
| MembershipAdministrator | membershipadministrators | passed |
| Resume | resumes | passed |
| ResumePersonalInfo | resumepersonalinfo | passed |
| ResumeSummary | resumesummaries | passed |
| ResumeEducation | resumeeducations | passed |
| ResumeWorkExperience | resumeworkexperiences | passed |
| ResumeSkill | resumeskills | passed |
| ResumeProject | resumeprojects | passed |
| ResumeCertification | resumecertifications | passed |
| ResumeTraining | resumetrainings | passed |
| ResumeSeminar | resumeseminars | passed |
| ResumeAward | resumeawards | passed |
| ResumeOrganization | resumeorganizations | passed |
| ResumeVolunteerWork | resumevolunteerworks | passed |
| ResumeLanguage | resumelanguages | passed |
| ResumeReference | resumereferences | passed |
| ResumeVersion | resumeversions | passed |

### Additional files changed in the re-audit

- backend/scripts/checkModelTableMappings.js: now verifies SELECT access in addition to exact table existence; permission failures return a nonzero exit code.
- backend/tests/modelTableMappings.test.js: explicitly tests both many-to-many joins and rejects extra generated models.
- backend/tests/modelTableAudit.test.js: tests read-only queries, exact-case mismatch rejection and denied SELECT access.
- backend/docs/lowercase-table-mappings.md: full mapping inventory and current production verification status.

### Live Render API evidence

- GET /api/health: HTTP 200, database connected, auth/registration schemas available.
- GET /api/jobs: HTTP 500, Table defaultdb.Jobs does not exist.
- GET /api/jobs/requirements/library: HTTP 500, Table defaultdb.RequirementLibrary does not exist.
- Requests used the Firebase Origin and received its CORS allow-origin header. The remaining failures are backend table-resolution failures.
- Deployed API table access is NOT fixed or verified. Current source mappings are jobs and requirementlibrary, so the deployed errors are consistent with an older backend revision. Confirm the deployed commit in Render.
- Health does not expose server identity and cannot prove Render uses the intended Workbench database. Render database identity remains unverified.

### Verify without Render Shell

The user cannot open Render Shell. In the Render service settings, temporarily append && node scripts/checkModelTableMappings.js to the existing Build Command when its working directory is backend. For a repository-root build command, use && node backend/scripts/checkModelTableMappings.js instead. Preserve the existing install/build command. Deploy the revision containing the lowercase model mappings and checker.

Inspect the build logs for configured and connected database/server identity, expected defaultdb, all 46 exists_exactly=true and query_ok=true results. Confirm this identity matches the intended MySQL connection. Render build-time environment variables must identify the same database as runtime; the live API checks after deployment are also required. The checker only performs SELECTs and exits nonzero on mismatches.

Keep ENABLE_DB_SYNC disabled. No schema migration is required for the existing lowercase schema. After deployment, recheck /api/health, /api/jobs and /api/jobs/requirements/library; then verify protected employment history and application endpoints using an authorized account. Do not conclude production is repaired based only on local tests or the health endpoint.

### Re-audit test results

- Existing backend suite: 234 tests, 224 passed, 10 intentionally skipped, 0 failures.
- Final focused mapping and read-only audit suites: 8 passed, 0 failures.
- Backend package has no build script. Node syntax checks passed for all 48 model/loader files plus database configuration and the audit script (50 files), and separately for server.js and the two test files.
- No frontend source, API route, authentication behavior, database schema or records changed during this re-audit.
