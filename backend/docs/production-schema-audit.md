# Production schema audit and proposed repair plan

**Status: production inventory is pending. This is a complete source inventory and a verified local comparison, not a verified production schema comparison. No production schema or data changes were applied.**

## Evidence and limits

- All 46 registered models use the shared backend/config/database.js Sequelize instance. DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASS determine the connection; Render environment values take precedence over dotenv defaults. No full connection URL is used.
- Previously verified live GET /api/jobs returned missing defaultdb.Jobs and GET /api/announcements returned missing defaultdb.Announcements. Current source uses jobs and announcements. Deployed runtime/revision mismatch is likely; existence of production lowercase tables is not independently verified.
- User-provided Render worker logs confirm ER_BAD_FIELD_ERROR/1054 for email_queue_jobs.dedupe_key. The queue model requires nullable VARCHAR(191) and a full unique index. Multiple NULLs are allowed.
- The user reports authenticated /api/membership/me returns the migration-not-ready message. That handler converts any missing-table/column error in its read chain into this message. The exact missing object remains unknown; do not assume both membership tables are absent.
- Public unauthenticated /api/membership/me checks return 401 before controller access. No authenticated production account or private runtime database inventory is available in this workspace.
- The connected local server is jamesbruhh, database djemc_alumni_db, lower_case_table_names=1. This is separate evidence from Render defaultdb.

## Priorities and proposed fixes (continued audit, 2026-10-16)

| Priority | Confirmed evidence | Correction prepared | Production gate |
| --- | --- | --- | --- |
| 1 | Worker selects missing email_queue_jobs.dedupe_key and fails before reservation | Queue-only additive migration, duplicate preflight and guarded runner | Verify intended host/database, review preflight, back up, then apply and verify |
| 1 | Live jobs and announcements queries use capitalized names; current registered models use lowercase names | Retain the existing explicit mappings; regression tests prove actual controller SQL uses jobs/announcements and lowercase joins | Verify deployed commit and exact lowercase production tables; deploy correct source and retest |
| 2 | Signed-in membership reports missing-table/column readiness failure (user report) | Preserve readiness check; add metadata-only dependency diagnosis and full read-chain regressions | Obtain SCHEMA_AUDIT_MEMBERSHIP output before choosing an additive migration |
| 2 | Resume list succeeds (user response); other resume operations are not live-verified | Preserve existing mappings; add SQL/association/timestamp regressions for remaining reads | Verify all 16 tables/columns, then approved save/update/detail/version/PDF checks |
| 3 | Historical migrations include mixed-case targets, old timestamps and role/data changes | Review all 32 migration files against actual metadata and ledger | Never treat an unrecorded migration as permission to replay it |

The independent public HTTP retest on 2026-10-16 still returns 500 for jobs and announcements with the same capitalized-table errors. These endpoints do not read the email queue, so the queue repair cannot explain or fix their GET failures. The likely stale/different deployment is an inference; the deployed revision and actual production table inventory are still required to establish its exact cause.

No additional model mapping changes are needed in this continuation. The existing patch changes explicit table mappings in 25 model files and preserves column definitions, aliases, foreign keys, timestamps and index names. See [the exact model file list and before/after mappings](lowercase-table-mappings.md). No table renaming or table-creation migration is proposed for a casing-only runtime discrepancy.

## Membership diagnosis and migration gate

The exact route is server.js -> /api/membership -> membershipRoutes auth middleware -> GET /me -> membershipController.getMyApplication. There is no separate readiness probe to disable. respondError maps ER_NO_SUCH_TABLE and ER_BAD_FIELD_ERROR from any of these reads to the same private HTTP 503 response:

| Order | Table | Required read | Condition |
| --- | --- | --- | --- |
| 1 | users | id, name, email, role, admin_scope, account_status, alumni_record_id | Every authenticated request entering controller |
| 2 | membershipapplications | All modeled columns, including created_at and updated_at | Verified alumni |
| 3 | alumniprofiles | id, user_id predicate, phone, address, course, graduation_year, job_title, current_company | Verified alumni |
| 4 | alumnirecords | id, course, batch_year | User has alumni_record_id |
| 5 | employmenthistories | id ordering, alumni_id predicate, company_name, position, start_year, end_year, employment_type | Profile exists |

membershipadministrators is used by membership admin/access routes, not alumni GET /me. email_queue_jobs is not queried by this route. A missing users.alumni_record_id or a conditional employment table can therefore produce the same message as a missing membershipapplications table.

The exact historical membership schema migration is `20261014-create-membership-applications.js`. Its targets include MembershipApplications, MembershipAdministrators and Users, with snake_case timestamps for membership records, and an Employer Admin grant. `scripts/applyMembershipMigration.js` also runs later Registrar grant and Admin Alumni transfer migrations. These schema/access effects must not be replayed blindly against case-sensitive production tables. `scripts/inspectMembershipSchema.js` uses historical mixed-case references and reads account/application information; use the metadata auditor here instead.

The auditor now emits `SCHEMA_AUDIT_MEMBERSHIP`: each dependency's exact expected/actual table, case variants, required/missing columns and conditional status. `baseReadsResolvable` covers unconditional reads; `allReadsResolvable` includes both account-dependent reads. These fields check table/column resolution only, not authentication, account data, grants or a successful HTTP request.

No new membership migration has been generated because the exact missing object is unconfirmed. Once production metadata arrives, prepare only the identified lowercase table/column additions. If an entire table is missing, verify existing users key types and explicit foreign-key targets first; preserve RESTRICT rules, both timestamp names, existing records and role permissions. If a NOT NULL column is missing from a populated table, review a compatible backfill separately rather than inventing defaults. Check duplicates before any unique index. Keep any access-grant DML separate from schema repair.

## Prepared file inventory and data effects

| Files | Reason / effects |
| --- | --- |
| 25 model files listed in lowercase-table-mappings.md | Existing casing patch only; targets current lowercase tables without schema operations |
| migrations/20261016-repair-email-queue-dedupe-key.js | Only proposed production schema repair: nullable VARCHAR(191), default NULL for existing rows, plus missing full single-column unique index; preserves all queue rows and refuses incompatible definitions or duplicate non-NULL keys |
| scripts/applyEmailQueueDedupeMigration.js | Check-only default, explicit host/database guard for apply; no unrelated migrations or ledger edits |
| scripts/checkModelTableMappings.js | Existing read-only exact table/identity checker |
| utils/schemaAudit.js; scripts/auditDatabaseSchema.js | Complete metadata comparison, no-row column SELECTs, commit/identity and migration ledger reporting; no automatic repair |
| utils/membershipSchemaAudit.js | New metadata-only summary scoped to the actual membership read chain |
| tests/modelTableMappings.test.js; tests/modelTableAudit.test.js; tests/schemaAudit.test.js | All-model mappings, associations, index/timestamp preservation and read-only/identity-guard coverage |
| tests/emailQueueDedupeMigration.test.js; tests/emailQueueDeduplication.test.js | Safe migration, duplicate checks, keyed/NULL enqueueing, transactional rejection and retry coverage |
| tests/productionReadPaths.test.js | Existing actual announcement SQL and independent membership authentication/prefill coverage |
| tests/membershipSchemaAudit.test.js; tests/membershipSchemaReadPaths.test.js | New metadata diagnosis and actual membership SQL; all dependency failures retain private 503 |
| tests/resumeSchemaReadPaths.test.js | New resume list/detail/GET PDF/versions SQL and all resume aliases/foreign keys/timestamps |
| docs/production-schema-audit.md; docs/lowercase-table-mappings.md; docs/email-queue-dedupe-repair.md | Continuing report, exact mapping list and guarded queue deployment instructions |

All paths in this table are relative to backend. Existing jobsEndpointTableMapping.test.js, jobTableDiagnostics.test.js, membership and resume workflow tests are reused. This continuation adds only the membership audit helper, its CLI integration, three focused test files and report updates. No controller, API route, queue worker, authentication, frontend, or existing migration was rewritten. Pre-existing frontend changes in the workspace are outside this audit.

The queue's unique index is part of the existing model's deduplication contract. Unkeyed emails use NULL; multiple NULLs are allowed. Employer verification and interview invitations look up their operation-specific key before enqueueing; alumni profile requests also store a key. The worker reserves all modeled columns, retries the same record and retains the key through pending/failed/sent transitions. The prepared migration checks existing duplicate non-NULL groups under database comparison/collation rules, reuses an equivalent full unique index, and refuses an incompatible canonical index. It never clears keys or deletes duplicate email history. MySQL DDL may commit independently; failed index creation can leave the new nullable column, which should remain for a safe rerun. Its destructive down operation intentionally refuses execution.

## Report by model/table

The complete expected schema below comes from the current registered models, including association-injected foreign keys. Production names/columns are marked unverified unless supported by a live response or supplied worker log. The successful resume-list response supports reads of two tables; it is not a full production metadata inventory.

| Model | Expected table | Actual production table | Missing/mismatched production columns | Affected endpoints | Recommended correction / migration |
| --- | --- | --- | --- | --- | --- |
| User | users | Unverified | Unverified pending Render read-only audit | /api/auth, /api/profile, /api/admin, /api/applications, /api/messages, /api/membership | No migration until a production difference is confirmed |
| AlumniProfile | alumniprofiles | Unverified | Unverified pending Render read-only audit | /api/profile, /api/auth, /api/admin, /api/membership | No migration until a production difference is confirmed |
| EmployerProfile | employerprofiles | Unverified | Unverified pending Render read-only audit | /api/profile, /api/auth, /api/jobs, /api/admin | No migration until a production difference is confirmed |
| EmploymentHistory | employmenthistories | Unverified | Unverified pending Render read-only audit | /api/profile, /api/membership/me, alumni tracking | No migration until a production difference is confirmed |
| Job | jobs | Unverified | Live query uses Jobs; production columns unverified | /api/jobs, /api/applications, employer job administration | Deploy lowercase model mapping and verify runtime commit; no rename or table creation |
| Application | applications | Unverified | Unverified pending Render read-only audit | /api/applications, job applicants, interviews | No migration until a production difference is confirmed |
| Announcement | announcements | Unverified | Live query uses Announcements; production columns unverified | /api/announcements, /api/admin/alumni/announcements | Deploy lowercase model mapping and verify runtime commit; no rename or table creation |
| Comment | comments | Unverified | Unverified pending Render read-only audit | /api/comments, /api/posts, /api/announcements | No migration until a production difference is confirmed |
| Conversation | conversations | Unverified | Unverified pending Render read-only audit | /api/messages | No migration until a production difference is confirmed |
| ConversationParticipant | conversationparticipants | Unverified | Unverified pending Render read-only audit | /api/messages, unread counts | No migration until a production difference is confirmed |
| Message | messages | Unverified | Unverified pending Render read-only audit | /api/messages, attachment retrieval | No migration until a production difference is confirmed |
| Notification | notifications | Unverified | Unverified pending Render read-only audit | /api/notifications, notification writes | No migration until a production difference is confirmed |
| Interview | interviews | Unverified | Unverified pending Render read-only audit | /api/applications interview actions | No migration until a production difference is confirmed |
| AlumniRecord | alumnirecords | Unverified | Unverified pending Render read-only audit | /api/alumni-records, /api/registrar, /api/auth, /api/membership | No migration until a production difference is confirmed |
| Post | posts | Unverified | Unverified pending Render read-only audit | /api/posts, feed | No migration until a production difference is confirmed |
| EmployerConversation | employerconversations | Unverified | Unverified pending Render read-only audit | /api/admin-employer | No migration until a production difference is confirmed |
| EmployerMessage | employermessages | Unverified | Unverified pending Render read-only audit | /api/admin-employer | No migration until a production difference is confirmed |
| PasswordResetToken | password_reset_tokens | Unverified | Unverified pending Render read-only audit | /api/auth password-reset actions | No migration until a production difference is confirmed |
| EmailQueueJob | email_queue_jobs | email_queue_jobs (worker log confirms table resolution) | dedupe_key missing (confirmed worker log); other columns unverified | background email worker; notification/interview/verification/profile-update writes | Prepared queue-only additive migration; review duplicate keys first |
| RateLimitEntry | rate_limit_entries | Unverified | Unverified pending Render read-only audit | rate-limited authentication/API middleware | No migration until a production difference is confirmed |
| RequirementLibrary | requirementlibrary | Unverified | Unverified pending Render read-only audit | /api/jobs/requirements/library | No migration until a production difference is confirmed |
| RequirementGroup | requirementgroups | Unverified | Unverified pending Render read-only audit | /api/jobs requirement actions; applications | No migration until a production difference is confirmed |
| JobRequirement | jobrequirements | Unverified | Unverified pending Render read-only audit | /api/jobs requirement actions; applications | No migration until a production difference is confirmed |
| JobRequirementSnapshot | jobrequirementsnapshots | Unverified | Unverified pending Render read-only audit | /api/applications requirement snapshots | No migration until a production difference is confirmed |
| ApplicationDocument | applicationdocuments | Unverified | Unverified pending Render read-only audit | /api/applications document review/preview/download | No migration until a production difference is confirmed |
| ApplicationResponse | applicationresponses | Unverified | Unverified pending Render read-only audit | /api/applications requirement responses | No migration until a production difference is confirmed |
| AuditLog | auditlogs | Unverified | Unverified pending Render read-only audit | admin/applications/profile/membership audit writes and tracking reads | No migration until a production difference is confirmed |
| AlumniProfileUpdateRequest | alumniprofileupdaterequests | Unverified | Unverified pending Render read-only audit | /api/admin alumni tracking; /api/profile update responses | No migration until a production difference is confirmed |
| MembershipApplication | membershipapplications | Unverified | Unverified; membership error does not identify exact missing object | /api/membership/me; membership admin/document/PDF routes | Inspect exact production tables/columns first; targeted migration only after evidence |
| MembershipAdministrator | membershipadministrators | Unverified | Unverified; membership error does not identify exact missing object | /api/membership/access; membership admin routes | Inspect exact production tables/columns first; targeted migration only after evidence |
| Resume | resumes | resumes (successful list reported by user; metadata pending) | List-selected columns work; remaining schema unverified | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumePersonalInfo | resumepersonalinfo | resumepersonalinfo (successful list reported by user; metadata pending) | List read works; schema metadata pending | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeSummary | resumesummaries | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeEducation | resumeeducations | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeWorkExperience | resumeworkexperiences | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeSkill | resumeskills | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeProject | resumeprojects | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeCertification | resumecertifications | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeTraining | resumetrainings | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeSeminar | resumeseminars | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeAward | resumeawards | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeOrganization | resumeorganizations | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeVolunteerWork | resumevolunteerworks | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeLanguage | resumelanguages | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeReference | resumereferences | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |
| ResumeVersion | resumeversions | Unverified | Unverified pending Render read-only audit | /api/resumes; application resume snapshots | No migration until a production difference is confirmed |

## Proposed migration/deployment plan before any production writes

1. Back up the intended database. Verify Render DB_HOST/DB_PORT/DB_NAME against the intended Workbench connection privately. Do not assume defaultdb points to the local djemc_alumni_db server.
2. Push the audit tooling and pending lowercase model mappings to the correct Render branch. Temporarily append `&& node scripts/auditDatabaseSchema.js --database defaultdb --host EXPECTED_PRODUCTION_HOST` to the existing Render Build Command when its working directory is backend. Use `node backend/scripts/...` from repository root. Substitute the reviewed host value, preserve the existing build command, and leave ENABLE_DB_SYNC disabled. No Shell is needed.
3. Collect SCHEMA_AUDIT_IDENTITY, every SCHEMA_AUDIT_MODEL line, SCHEMA_AUDIT_MEMBERSHIP, and SCHEMA_AUDIT_MIGRATIONS from build logs. Confirm intendedTargetVerified=true and compare connected identity with the intended database. The tool only executes SELECTs, never selects application rows, never imports migrations for execution, and never calls sync. --output can save the full expected/actual metadata as JSON; --strict optionally fails on reported differences. Default audit reports differences without mutating or blocking deployment.
4. Review actual-case table inventory, missing/type/nullability/PK/auto-increment differences, indexes and foreign keys. Foreign-key delete rules are business/integrity decisions: differences from Sequelize defaults are review items, not instructions to weaken RESTRICT to CASCADE. Larger database text widths and extra columns are also review items, not reasons to shrink/drop data.
5. Confirmed queue repair: use the existing version-controlled 20261016-repair-email-queue-dedupe-key.js with the guarded applyEmailQueueDedupeMigration.js runner, as documented in email-queue-dedupe-repair.md. It adds nullable VARCHAR(191) plus a missing full unique index, refuses non-NULL duplicates/incompatible definitions, and preserves rows. No second duplicate migration is necessary. Apply only after explicit target/preflight verification.
6. Jobs/announcements: deploy the already-correct lowercase mappings and check deployed commit. Do not rename/create lowercase duplicates in response to an old binary querying uppercase tables.
7. Membership: defer any new migration until the inventory identifies exactly which columns/tables are missing. If creation is needed, prepare a lowercase-only, additive migration with explicit existing users foreign-key references and no automatic grants. Do not blindly invoke the historical membership runner, which can create mixed-case tables and perform access-grant/revoke DML.
8. Review pending migration history against actual schema. A missing SequelizeMeta entry does not mean schema is missing; a present entry does not guarantee schema is complete. Do not replay all historical migrations or run sync({alter:true}). Some history includes data transformations, column removals, and access grants.
9. Apply only separately reviewed targeted repairs during an appropriate DDL maintenance window. Rerun the read-only audit, deploy/restart web and email worker instances, and check logs for successful reservation/sending using an approved test recipient.
10. Retest /api/jobs, /api/announcements, signed-in /api/membership/me, resume save/read and affected private APIs. A successful audit or health response alone does not prove endpoint success. Remove temporary build/diagnostic settings afterward.

## Resume progress investigation

The user supplied a successful response body with a data array of resume summaries and nested personalInfo.full_name objects. This exactly matches the current GET /api/resumes -> resumeController.getResumes response shape. The handler reads Resume.findAll and then ResumePersonalInfo.findOne for each listed resume. The current mappings are resumes and resumepersonalinfo; these models share the central Sequelize instance with Job, Announcement, membership models and the queue. All 16 resume models already use lowercase names, but this list operation reads only two of them. Authentication verifies the JWT without querying users. This evidence supports successful resume-list reads, not the other resume sections, save/update operations, jobs, announcements, membership, or email queue schema. It is consistent with correctly mapped resume tables working alongside stale uppercase mappings elsewhere. The exact request URL, Content-Type, deployed revision and database identity are still not independently verified from the supplied body. No personal names, IDs or record contents from that body are stored in this report.

| Resume operation | Additional schema dependencies / verification scope |
| --- | --- |
| GET /api/resumes | resumes and resumepersonalinfo only; current-user and nonarchived filters |
| POST /api/resumes; PUT /api/resumes/:id (Save Progress) | User lock, main resume, submitted section tables, optional AlumniProfile prefill; transactions and owner checks |
| GET /api/resumes/:id | Main resume plus all 14 section tables |
| POST /api/resumes/:id/duplicate | Reads all 14 sections, writes a separate resume and section rows |
| GET /api/resumes/:id/pdf | Returns JSON resume data, reading all 14 sections; it is not the PDF binary renderer |
| POST /api/resumes/:id/pdf | Saved-resume ownership/template read plus HTML-to-PDF renderer |
| GET /api/resumes/:id/versions | Main resume ownership plus resumeversions |
| POST /api/resumes/:id/snapshot | All sections read, resumeversions write |
| Job application submitted with resume_id | applicationController.createResumeSnapshot also reads all 14 section tables |

The frontend Save Progress action uses POST/PUT resume persistence; no separate progress route exists. The 14 section tables cover personal information, summary, education, work experience, skills, projects, certifications, trainings, seminars, awards, organizations, volunteer work, languages and references. All 16 resume models preserve camelCase createdAt/updatedAt, unlike membership's explicit snake_case timestamps.

Existing resumeWorkflow.test.js covers section persistence, draft retry, partial update, rollback, ownership, duplicate/default behavior and PDF validation. New resumeSchemaReadPaths.test.js captures actual generated SQL for list/detail/GET PDF/versions and validates aliases, inverse associations, resume_id references and all timestamp mappings. These tests intercept execution and do not establish production write/render success.

Do not use legacy test_resume_e2e.js as a production audit: it targets localhost, creates/deletes records and asserts obsolete uppercase/snake_case resume schema. scripts/checkResumeWorkflow.js performs writes/locks inside a rollback; it is also not read-only. No resume migration is justified by the successful list or by these historical tooling discrepancies alone.

## Local comparison (not production)

All 46 modeled local tables and all modeled columns exist and their no-row SELECTs succeeded. The inventory contains 47 tables including the migration ledger. Types, indexes and foreign keys were audited independently; the prior columns-only check could not detect these additional differences:
- AlumniProfileUpdateRequest (alumniprofileupdaterequests): {"columnDifferences":[],"missingIndexes":[],"foreignKeyDifferences":[{"column":"requested_by","expected":{"table":"users","column":"id","onDelete":"NO ACTION","onUpdate":"CASCADE"},"actual":[{"column":"requested_by","targetTable":"users","targetColumn":"id","targetDatabase":"djemc_alumni_db","onDelete":"RESTRICT","onUpdate":"CASCADE"}]}]}
- MembershipApplication (membershipapplications): {"columnDifferences":[],"missingIndexes":[],"foreignKeyDifferences":[{"column":"alumni_user_id","expected":{"table":"users","column":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},"actual":[{"column":"alumni_user_id","targetTable":"users","targetColumn":"id","targetDatabase":"djemc_alumni_db","onDelete":"RESTRICT","onUpdate":"CASCADE"}]}]}
- MembershipAdministrator (membershipadministrators): {"columnDifferences":[],"missingIndexes":[],"foreignKeyDifferences":[{"column":"user_id","expected":{"table":"users","column":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},"actual":[{"column":"user_id","targetTable":"users","targetColumn":"id","targetDatabase":"djemc_alumni_db","onDelete":"RESTRICT","onUpdate":"CASCADE"}]}]}
- ResumePersonalInfo (resumepersonalinfo): {"columnDifferences":[{"column":"phone","property":"type","expected":"VARCHAR(50)","actual":"varchar(255)"},{"column":"linkedin","property":"type","expected":"VARCHAR(500)","actual":"varchar(255)"},{"column":"github","property":"type","expected":"VARCHAR(500)","actual":"varchar(255)"},{"column":"portfolio","property":"type","expected":"VARCHAR(500)","actual":"varchar(255)"},{"column":"website","property":"type","expected":"VARCHAR(500)","actual":"varchar(255)"}],"missingIndexes":[],"foreignKeyDifferences":[]}
- ResumeEducation (resumeeducations): {"columnDifferences":[{"column":"gpa","property":"type","expected":"VARCHAR(20)","actual":"varchar(255)"}],"missingIndexes":[],"foreignKeyDifferences":[]}
- ResumeSkill (resumeskills): {"columnDifferences":[{"column":"category","property":"type","expected":"VARCHAR(100)","actual":"varchar(255)"}],"missingIndexes":[],"foreignKeyDifferences":[]}
- ResumeProject (resumeprojects): {"columnDifferences":[{"column":"url","property":"type","expected":"VARCHAR(500)","actual":"varchar(255)"}],"missingIndexes":[],"foreignKeyDifferences":[]}
- ResumeCertification (resumecertifications): {"columnDifferences":[{"column":"url","property":"type","expected":"VARCHAR(500)","actual":"varchar(255)"}],"missingIndexes":[],"foreignKeyDifferences":[]}
- ResumeLanguage (resumelanguages): {"columnDifferences":[{"column":"language","property":"type","expected":"VARCHAR(100)","actual":"varchar(255)"},{"column":"proficiency","property":"type","expected":"VARCHAR(100)","actual":"varchar(255)"}],"missingIndexes":[],"foreignKeyDifferences":[]}
- ResumeReference (resumereferences): {"columnDifferences":[{"column":"phone","property":"type","expected":"VARCHAR(50)","actual":"varchar(255)"}],"missingIndexes":[],"foreignKeyDifferences":[]}

Local resume URL columns include VARCHAR(255) where models permit VARCHAR(500); this can affect long values locally. Other local string columns are wider than model declarations. No production width migration was created without production evidence, and no local values/definitions were changed.

## Every migration reviewed (source; production applied status pending)

The following manifest identifies source operations and mixed-case literals. These are candidates for review, not automatically pending or safe-to-run repairs. See the JSON migration inventory for operation source locations.

| Migration | Review markers |
| --- | --- |
| 20260324-add-admin-profile-columns.js | mixed-case literals: Users |
| 20260327-add-expected-salary-to-jobs.js | mixed-case literals: Jobs |
| 20260328-add-schedule-columns-to-announcements.js | mixed-case literals: Announcements |
| 20260413-create-email-queue-and-rate-limit-tables.js | queue-only/lowercase or dynamic targets |
| 20260414-unify-messaging-and-harden-infra.js | possible data transformation/seed DML; up includes removals; mixed-case literals: Conversations, Messages, ConversationParticipants, EmployerConversations, EmployerMessages, Users |
| 20260518-add-missing-application-identity-columns.js | mixed-case literals: Applications |
| 20260526-add-feed-indexes.js | mixed-case literals: Posts, Comments |
| 20260616-add-employment-status-to-alumni-profiles.js | mixed-case literals: AlumniProfile, AlumniProfiles |
| 20260618-add-alumni-record-id-to-users.js | mixed-case literals: Users |
| 20260709-add-requirement-fields-to-jobs.js | mixed-case literals: Jobs |
| 20260709-create-application-documents.js | possible data transformation/seed DML; mixed-case literals: ApplicationDocuments |
| 20260709-create-application-responses.js | possible data transformation/seed DML; mixed-case literals: ApplicationResponses |
| 20260709-create-audit-logs.js | mixed-case literals: AuditLogs |
| 20260709-create-job-requirement-snapshots.js | mixed-case literals: JobRequirementSnapshots |
| 20260709-create-job-requirements.js | mixed-case literals: JobRequirements |
| 20260709-create-requirement-groups.js | mixed-case literals: RequirementGroups |
| 20260709-create-requirement-library.js | possible data transformation/seed DML; mixed-case literals: RequirementLibrary |
| 20260719-add-recruitment-lifecycle.js | mixed-case literals: Jobs, Applications |
| 20260720-create-resume-system.js | possible data transformation/seed DML; mixed-case literals: Resumes, ResumePersonalInfo, ResumeSummaries, ResumeEducation, ResumeWorkExperience, ResumeSkills, ResumeProjects, ResumeCertifications, ResumeTrainings, ResumeSeminars, ResumeAwards, ResumeOrganizations, ResumeVolunteerWork, ResumeLanguages, ResumeReferences, ResumeVersions |
| 20260724-add-missing-timestamps-to-resume-tables.js | possible data transformation/seed DML; mixed-case literals: ResumePersonalInfo, ResumeSummaries, ResumeEducation, ResumeWorkExperience, ResumeSkills, ResumeProjects, ResumeCertifications, ResumeTrainings, ResumeSeminars, ResumeAwards, ResumeOrganizations, ResumeVolunteerWork, ResumeLanguages, ResumeReferences, ResumeVersions |
| 20260725-add-proof-document-to-alumni-profiles.js | mixed-case literals: AlumniProfiles |
| 20261009-add-employer-message-file-metadata.js | mixed-case literals: EmployerMessages |
| 20261011-add-message-file-sizes.js | mixed-case literals: Messages, EmployerMessages |
| 20261012-add-application-archive-flag.js | mixed-case literals: Applications |
| 20261012-add-job-interview-invitations.js | mixed-case literals: Jobs, Notifications |
| 20261013-create-alumni-profile-update-requests.js | possible data transformation/seed DML; mixed-case literals: AlumniProfileUpdateRequests, Users, Notifications |
| 20261013-expand-application-document-file-path.js | mixed-case literals: ApplicationDocuments |
| 20261014-add-job-posting-details.js | mixed-case literals: Jobs |
| 20261014-create-membership-applications.js | possible data transformation/seed DML; mixed-case literals: Users, MembershipApplications, MembershipAdministrators |
| 20261014-grant-registrar-membership-access.js | possible data transformation/seed DML; queue-only/lowercase or dynamic targets |
| 20261014-transfer-membership-access-to-admin-alumni.js | possible data transformation/seed DML; queue-only/lowercase or dynamic targets |
| 20261016-repair-email-queue-dedupe-key.js | queue-only/lowercase or dynamic targets |

Migration hazards verified in source: 20260414-unify-messaging-and-harden-infra performs data transformations and removals; 20260720-create-resume-system uses mixed-case/singular spellings and snake_case timestamps that differ from current lowercase models; 20260724-add-missing-timestamps-to-resume-tables adds snake_case timestamps while current resume models use createdAt/updatedAt; membership create/grant/transfer migrations also perform role-grant DML. Historical up/down methods were not executed.

## Raw SQL and initialization review

Runtime schema references in jobController, adminController and rateLimitStore use getTableName() for model tables. membershipListing uses a static JSON_EXTRACT expression, not a separate database connection. Background workers require the same models/config as HTTP routes. sequelize.sync({alter:true}) is guarded out of production in server.js; the audit does not load server.js or any worker loop. Nonproduction startup may create missing optional tables; the audit bypasses startup entirely.

The preceding route/controller/service/utility/config/worker source inventory covers 106 JavaScript files. This continuation adds a pure membership metadata helper with no database operations. Affected endpoint groups above are module-level dependencies and include read/write operations; they are not a claim that every endpoint executes every associated table.

## Expected schema inventory (all registered models)

### User / users

Affected: /api/auth, /api/profile, /api/admin, /api/applications, /api/messages, /api/membership. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| name -> name | VARCHAR(255) | true | false | false |
| email -> email | VARCHAR(255) | true | false | false |
| password -> password | VARCHAR(255) | true | false | false |
| role -> role | VARCHAR(255) | true | false | false |
| admin_scope -> admin_scope | VARCHAR(255) | true | false | false |
| admin_department -> admin_department | VARCHAR(255) | true | false | false |
| admin_avatar_url -> admin_avatar_url | LONGTEXT | true | false | false |
| account_status -> account_status | VARCHAR(255) | true | false | false |
| alumni_record_id -> alumni_record_id | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"users_email","unique":true,"fields":["email"]},{"name":"users_role_admin_scope","unique":true,"fields":["role","admin_scope"]}]

Associations: [{"alias":"AlumniProfile","type":"HasOne","targetModel":"AlumniProfile","targetTable":"alumniprofiles","foreignKey":"user_id","through":null},{"alias":"membershipApplication","type":"HasOne","targetModel":"MembershipApplication","targetTable":"membershipapplications","foreignKey":"alumni_user_id","through":null},{"alias":"membershipPermission","type":"HasOne","targetModel":"MembershipAdministrator","targetTable":"membershipadministrators","foreignKey":"user_id","through":null},{"alias":"profileUpdateRequestsReceived","type":"HasMany","targetModel":"AlumniProfileUpdateRequest","targetTable":"alumniprofileupdaterequests","foreignKey":"alumni_user_id","through":null},{"alias":"EmployerProfile","type":"HasOne","targetModel":"EmployerProfile","targetTable":"employerprofiles","foreignKey":"user_id","through":null},{"alias":"AlumniRecord","type":"BelongsTo","targetModel":"AlumniRecord","targetTable":"alumnirecords","foreignKey":"alumni_record_id","through":null},{"alias":"sentMessages","type":"HasMany","targetModel":"Message","targetTable":"messages","foreignKey":"sender_id","through":null},{"alias":"conversations","type":"BelongsToMany","targetModel":"Conversation","targetTable":"conversations","foreignKey":"user_id","through":"conversationparticipants"},{"alias":"ConversationParticipants","type":"HasMany","targetModel":"ConversationParticipant","targetTable":"conversationparticipants","foreignKey":"user_id","through":null},{"alias":"Jobs","type":"HasMany","targetModel":"Job","targetTable":"jobs","foreignKey":"employer_id","through":null},{"alias":"Applications","type":"HasMany","targetModel":"Application","targetTable":"applications","foreignKey":"alumni_id","through":null},{"alias":"Posts","type":"HasMany","targetModel":"Post","targetTable":"posts","foreignKey":"user_id","through":null},{"alias":"employerConversation","type":"HasOne","targetModel":"EmployerConversation","targetTable":"employerconversations","foreignKey":"employerId","through":null},{"alias":"adminEmployerConversations","type":"HasMany","targetModel":"EmployerConversation","targetTable":"employerconversations","foreignKey":"adminId","through":null},{"alias":"PasswordResetTokens","type":"HasMany","targetModel":"PasswordResetToken","targetTable":"password_reset_tokens","foreignKey":"user_id","through":null},{"alias":"Announcements","type":"HasMany","targetModel":"Announcement","targetTable":"announcements","foreignKey":"admin_id","through":null},{"alias":"Comments","type":"HasMany","targetModel":"Comment","targetTable":"comments","foreignKey":"user_id","through":null},{"alias":"AuditLogs","type":"HasMany","targetModel":"AuditLog","targetTable":"auditlogs","foreignKey":"actor_id","through":null},{"alias":"documentReviews","type":"HasMany","targetModel":"ApplicationDocument","targetTable":"applicationdocuments","foreignKey":"reviewed_by","through":null},{"alias":"responseReviews","type":"HasMany","targetModel":"ApplicationResponse","targetTable":"applicationresponses","foreignKey":"reviewed_by","through":null},{"alias":"Resumes","type":"HasMany","targetModel":"Resume","targetTable":"resumes","foreignKey":"user_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"alumni_record_id","targetTable":"alumnirecords","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"}]

### AlumniProfile / alumniprofiles

Affected: /api/profile, /api/auth, /api/admin, /api/membership. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| user_id -> user_id | INTEGER | true | false | false |
| course -> course | VARCHAR(255) | true | false | false |
| graduation_year -> graduation_year | INTEGER | true | false | false |
| phone -> phone | VARCHAR(255) | true | false | false |
| address -> address | VARCHAR(255) | true | false | false |
| profile_visibility -> profile_visibility | VARCHAR(255) | true | false | false |
| avatar_url -> avatar_url | TEXT | true | false | false |
| proof_document_path -> proof_document_path | TEXT | true | false | false |
| employment_status -> employment_status | VARCHAR(30) | true | false | false |
| current_company -> current_company | VARCHAR(255) | true | false | false |
| job_title -> job_title | VARCHAR(255) | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"EmploymentHistories","type":"HasMany","targetModel":"EmploymentHistory","targetTable":"employmenthistories","foreignKey":"alumni_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### EmployerProfile / employerprofiles

Affected: /api/profile, /api/auth, /api/jobs, /api/admin. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| user_id -> user_id | INTEGER | true | false | false |
| organization_name -> organization_name | VARCHAR(255) | true | false | false |
| industry -> industry | VARCHAR(255) | true | false | false |
| website_url -> website_url | VARCHAR(255) | true | false | false |
| business_permit_path -> business_permit_path | VARCHAR(255) | true | false | false |
| address -> address | VARCHAR(255) | true | false | false |
| contact_email -> contact_email | VARCHAR(255) | true | false | false |
| logo_url -> logo_url | LONGTEXT | true | false | false |
| verified -> verified | TINYINT(1) | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: []

Foreign-key expectations: [{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### EmploymentHistory / employmenthistories

Affected: /api/profile, /api/membership/me, alumni tracking. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| alumni_id -> alumni_id | INTEGER | true | false | false |
| company_name -> company_name | VARCHAR(255) | true | false | false |
| position -> position | VARCHAR(255) | true | false | false |
| start_year -> start_year | INTEGER | true | false | false |
| end_year -> end_year | INTEGER | true | false | false |
| employment_type -> employment_type | VARCHAR(255) | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"AlumniProfile","type":"BelongsTo","targetModel":"AlumniProfile","targetTable":"alumniprofiles","foreignKey":"alumni_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"alumni_id","targetTable":"alumniprofiles","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Job / jobs

Affected: /api/jobs, /api/applications, employer job administration. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| title -> title | VARCHAR(255) | true | false | false |
| description -> description | TEXT | true | false | false |
| location -> location | VARCHAR(255) | true | false | false |
| employment_type -> employment_type | VARCHAR(255) | true | false | false |
| course_target -> course_target | VARCHAR(255) | true | false | false |
| expected_salary -> expected_salary | VARCHAR(255) | true | false | false |
| posting_details -> posting_details | JSON | true | false | false |
| interview_venue -> interview_venue | VARCHAR(255) | true | false | false |
| interview_place -> interview_place | TEXT | true | false | false |
| interview_date -> interview_date | DATE | true | false | false |
| interview_time -> interview_time | VARCHAR(255) | true | false | false |
| interview_contact_info -> interview_contact_info | VARCHAR(255) | true | false | false |
| interview_what_to_bring -> interview_what_to_bring | TEXT | true | false | false |
| employer_id -> employer_id | INTEGER | true | false | false |
| current_requirement_version -> current_requirement_version | INTEGER | true | false | false |
| has_requirements -> has_requirements | TINYINT(1) | true | false | false |
| recruitment_status -> recruitment_status | VARCHAR(255) | false | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"User","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"employer_id","through":null},{"alias":"Applications","type":"HasMany","targetModel":"Application","targetTable":"applications","foreignKey":"job_id","through":null},{"alias":"RequirementGroups","type":"HasMany","targetModel":"RequirementGroup","targetTable":"requirementgroups","foreignKey":"job_id","through":null},{"alias":"JobRequirements","type":"HasMany","targetModel":"JobRequirement","targetTable":"jobrequirements","foreignKey":"job_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"employer_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Application / applications

Affected: /api/applications, job applicants, interviews. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| job_id -> job_id | INTEGER | true | false | false |
| alumni_id -> alumni_id | INTEGER | true | false | false |
| position_applied_for -> position_applied_for | VARCHAR(255) | true | false | false |
| department_office -> department_office | VARCHAR(255) | true | false | false |
| employment_type -> employment_type | VARCHAR(255) | true | false | false |
| preferred_work_location -> preferred_work_location | VARCHAR(255) | true | false | false |
| expected_salary -> expected_salary | VARCHAR(255) | true | false | false |
| start_date -> start_date | DATE | true | false | false |
| full_name -> full_name | VARCHAR(255) | true | false | false |
| email -> email | VARCHAR(255) | true | false | false |
| dob -> dob | DATE | true | false | false |
| place_of_birth -> place_of_birth | VARCHAR(255) | true | false | false |
| gender -> gender | VARCHAR(255) | true | false | false |
| contact_number -> contact_number | VARCHAR(255) | true | false | false |
| nationality -> nationality | VARCHAR(255) | true | false | false |
| address -> address | TEXT | true | false | false |
| professional_summary -> professional_summary | TEXT | true | false | false |
| civil_service_eligibility -> civil_service_eligibility | VARCHAR(255) | true | false | false |
| rating -> rating | VARCHAR(255) | true | false | false |
| license_number -> license_number | VARCHAR(255) | true | false | false |
| validity -> validity | DATE | true | false | false |
| education -> education | VARCHAR(255) | true | false | false |
| school -> school | VARCHAR(255) | true | false | false |
| degree -> degree | VARCHAR(255) | true | false | false |
| years_attended -> years_attended | VARCHAR(255) | true | false | false |
| honors -> honors | VARCHAR(255) | true | false | false |
| company -> company | VARCHAR(255) | true | false | false |
| position -> position | VARCHAR(255) | true | false | false |
| employment_period -> employment_period | VARCHAR(255) | true | false | false |
| responsibilities -> responsibilities | TEXT | true | false | false |
| achievements -> achievements | TEXT | true | false | false |
| reason_for_leaving -> reason_for_leaving | TEXT | true | false | false |
| skills -> skills | TEXT | true | false | false |
| soft_skills -> soft_skills | TEXT | true | false | false |
| certifications -> certifications | TEXT | true | false | false |
| leadership_role -> leadership_role | VARCHAR(255) | true | false | false |
| people_managed -> people_managed | VARCHAR(255) | true | false | false |
| leadership_achievements -> leadership_achievements | TEXT | true | false | false |
| training_title -> training_title | VARCHAR(255) | true | false | false |
| training_organization -> training_organization | VARCHAR(255) | true | false | false |
| training_duration -> training_duration | VARCHAR(255) | true | false | false |
| training_date -> training_date | DATE | true | false | false |
| reference_name -> reference_name | VARCHAR(255) | true | false | false |
| reference_position -> reference_position | VARCHAR(255) | true | false | false |
| reference_company -> reference_company | VARCHAR(255) | true | false | false |
| reference_contact -> reference_contact | VARCHAR(255) | true | false | false |
| civil_status -> civil_status | VARCHAR(255) | true | false | false |
| disability -> disability | TEXT | true | false | false |
| disability_other -> disability_other | VARCHAR(255) | true | false | false |
| employment_status -> employment_status | VARCHAR(255) | true | false | false |
| employment_type_detail -> employment_type_detail | TEXT | true | false | false |
| ofw -> ofw | VARCHAR(255) | true | false | false |
| former_ofw -> former_ofw | VARCHAR(255) | true | false | false |
| four_ps -> four_ps | VARCHAR(255) | true | false | false |
| preferred_occupation -> preferred_occupation | VARCHAR(255) | true | false | false |
| preferred_work_type -> preferred_work_type | VARCHAR(255) | true | false | false |
| preferred_location_type -> preferred_location_type | VARCHAR(255) | true | false | false |
| preferred_location_detail -> preferred_location_detail | VARCHAR(255) | true | false | false |
| languages -> languages | TEXT | true | false | false |
| currently_in_school -> currently_in_school | VARCHAR(255) | true | false | false |
| education_level -> education_level | VARCHAR(255) | true | false | false |
| work_status -> work_status | VARCHAR(255) | true | false | false |
| other_skills -> other_skills | TEXT | true | false | false |
| other_skills_other -> other_skills_other | VARCHAR(255) | true | false | false |
| convicted_of_crime -> convicted_of_crime | VARCHAR(255) | true | false | false |
| dismissed_from_service -> dismissed_from_service | VARCHAR(255) | true | false | false |
| currently_employed -> currently_employed | VARCHAR(255) | true | false | false |
| can_work_overtime -> can_work_overtime | VARCHAR(255) | true | false | false |
| why_join -> why_join | TEXT | true | false | false |
| good_fit -> good_fit | TEXT | true | false | false |
| career_goals -> career_goals | TEXT | true | false | false |
| declaration_confirmed -> declaration_confirmed | VARCHAR(255) | true | false | false |
| notes -> notes | TEXT | true | false | false |
| resume_path -> resume_path | VARCHAR(255) | true | false | false |
| resume_snapshot -> resume_snapshot | JSON | true | false | false |
| transcript_path -> transcript_path | VARCHAR(255) | true | false | false |
| certificate_path -> certificate_path | VARCHAR(255) | true | false | false |
| status -> status | VARCHAR(255) | true | false | false |
| is_archived -> is_archived | TINYINT(1) | false | false | false |
| recruitment_cycle -> recruitment_cycle | INTEGER | false | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Job","type":"BelongsTo","targetModel":"Job","targetTable":"jobs","foreignKey":"job_id","through":null},{"alias":"alumni","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"alumni_id","through":null},{"alias":"Interviews","type":"HasMany","targetModel":"Interview","targetTable":"interviews","foreignKey":"application_id","through":null},{"alias":"JobRequirementSnapshot","type":"HasOne","targetModel":"JobRequirementSnapshot","targetTable":"jobrequirementsnapshots","foreignKey":"application_id","through":null},{"alias":"ApplicationDocuments","type":"HasMany","targetModel":"ApplicationDocument","targetTable":"applicationdocuments","foreignKey":"application_id","through":null},{"alias":"ApplicationResponses","type":"HasMany","targetModel":"ApplicationResponse","targetTable":"applicationresponses","foreignKey":"application_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"job_id","targetTable":"jobs","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"alumni_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Announcement / announcements

Affected: /api/announcements, /api/admin/alumni/announcements. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| title -> title | VARCHAR(255) | true | false | false |
| content -> content | TEXT | true | false | false |
| admin_id -> admin_id | INTEGER | true | false | false |
| day -> day | DATE | true | false | false |
| time -> time | VARCHAR(255) | true | false | false |
| location -> location | VARCHAR(255) | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"admin","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"admin_id","through":null},{"alias":"Comments","type":"HasMany","targetModel":"Comment","targetTable":"comments","foreignKey":"announcement_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"admin_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Comment / comments

Affected: /api/comments, /api/posts, /api/announcements. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| announcement_id -> announcement_id | INTEGER | true | false | false |
| post_id -> post_id | INTEGER | true | false | false |
| user_id -> user_id | INTEGER | true | false | false |
| comment -> comment | TEXT | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"comments_post_id_created_at_idx","unique":false,"fields":["post_id","createdAt"]}]

Associations: [{"alias":"Post","type":"BelongsTo","targetModel":"Post","targetTable":"posts","foreignKey":"post_id","through":null},{"alias":"User","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"user_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"announcement_id","targetTable":"announcements","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"post_id","targetTable":"posts","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Conversation / conversations

Affected: /api/messages. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| user1Id -> user1Id | INTEGER | true | false | false |
| user2Id -> user2Id | INTEGER | true | false | false |
| conversation_key -> conversation_key | VARCHAR(255) | true | false | false |
| name -> name | VARCHAR(255) | true | false | false |
| type -> type | VARCHAR(255) | true | false | false |
| batch_year -> batch_year | INTEGER | true | false | false |
| course -> course | VARCHAR(255) | true | false | false |
| last_message_text -> last_message_text | TEXT | true | false | false |
| last_message_at -> last_message_at | DATETIME | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"conversations_conversation_key","unique":true,"fields":["conversation_key"]},{"name":"conversations_type","unique":false,"fields":["type"]},{"name":"conversations_batch_year_course","unique":false,"fields":["batch_year","course"]}]

Associations: [{"alias":"Messages","type":"HasMany","targetModel":"Message","targetTable":"messages","foreignKey":"conversation_id","through":null},{"alias":"participants","type":"BelongsToMany","targetModel":"User","targetTable":"users","foreignKey":"conversation_id","through":"conversationparticipants"},{"alias":"ConversationParticipants","type":"HasMany","targetModel":"ConversationParticipant","targetTable":"conversationparticipants","foreignKey":"conversation_id","through":null}]

Foreign-key expectations: []

### ConversationParticipant / conversationparticipants

Affected: /api/messages, unread counts. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| conversation_id -> conversation_id | INTEGER | false | true | false |
| user_id -> user_id | INTEGER | false | true | false |
| unread_count -> unread_count | INTEGER | false | false | false |
| last_read_at -> last_read_at | DATETIME | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"conversation_participants_conversation_id_user_id","unique":true,"fields":["conversation_id","user_id"]},{"name":"conversation_participants_user_id","unique":false,"fields":["user_id"]},{"name":"conversation_participants_conversation_id","unique":false,"fields":["conversation_id"]}]

Associations: [{"alias":"Conversation","type":"BelongsTo","targetModel":"Conversation","targetTable":"conversations","foreignKey":"conversation_id","through":null},{"alias":"User","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"user_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"conversation_id","targetTable":"conversations","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Message / messages

Affected: /api/messages, attachment retrieval. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| conversation_id -> conversation_id | INTEGER | false | false | false |
| sender_id -> sender_id | INTEGER | false | false | false |
| message_text -> message_text | TEXT | true | false | false |
| file_url -> file_url | VARCHAR(255) | true | false | false |
| file_name -> file_name | VARCHAR(255) | true | false | false |
| file_mime -> file_mime | VARCHAR(255) | true | false | false |
| file_size -> file_size | INTEGER | true | false | false |
| is_read -> is_read | TINYINT(1) | false | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"messages_conversation_id_created_at","unique":false,"fields":["conversation_id","createdAt"]},{"name":"messages_sender_id","unique":false,"fields":["sender_id"]},{"name":"messages_is_read","unique":false,"fields":["is_read"]}]

Associations: [{"alias":"sender","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"sender_id","through":null},{"alias":"Conversation","type":"BelongsTo","targetModel":"Conversation","targetTable":"conversations","foreignKey":"conversation_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"conversation_id","targetTable":"conversations","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"sender_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Notification / notifications

Affected: /api/notifications, notification writes. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| userId -> userId | INTEGER | false | false | false |
| type -> type | VARCHAR(255) | true | false | false |
| interview_id -> interview_id | INTEGER | true | false | false |
| message -> message | TEXT | true | false | false |
| isRead -> isRead | TINYINT(1) | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Interview","type":"BelongsTo","targetModel":"Interview","targetTable":"interviews","foreignKey":"interview_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"interview_id","targetTable":"interviews","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"}]

### Interview / interviews

Affected: /api/applications interview actions. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| application_id -> application_id | INTEGER | false | false | false |
| venue -> venue | VARCHAR(255) | false | false | false |
| place -> place | VARCHAR(255) | false | false | false |
| date -> date | DATE | false | false | false |
| time -> time | VARCHAR(255) | false | false | false |
| contact_info -> contact_info | VARCHAR(255) | false | false | false |
| what_to_bring -> what_to_bring | TEXT | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Application","type":"BelongsTo","targetModel":"Application","targetTable":"applications","foreignKey":"application_id","through":null},{"alias":"Notifications","type":"HasMany","targetModel":"Notification","targetTable":"notifications","foreignKey":"interview_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"application_id","targetTable":"applications","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### AlumniRecord / alumnirecords

Affected: /api/alumni-records, /api/registrar, /api/auth, /api/membership. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| full_name -> full_name | VARCHAR(255) | false | false | false |
| student_id -> student_id | VARCHAR(255) | true | false | false |
| course -> course | VARCHAR(255) | false | false | false |
| batch_year -> batch_year | INTEGER | false | false | false |
| email -> email | VARCHAR(255) | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"alumnirecords_student_id_unique","unique":true,"fields":["student_id"]},{"name":"alumnirecords_email_unique","unique":true,"fields":["email"]}]

Associations: [{"alias":"User","type":"HasOne","targetModel":"User","targetTable":"users","foreignKey":"alumni_record_id","through":null}]

Foreign-key expectations: []

### Post / posts

Affected: /api/posts, feed. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| user_id -> user_id | INTEGER | true | false | false |
| text -> text | TEXT | true | false | false |
| image_url -> image_url | TEXT | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"posts_created_at_idx","unique":false,"fields":["createdAt"]}]

Associations: [{"alias":"User","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"user_id","through":null},{"alias":"Comments","type":"HasMany","targetModel":"Comment","targetTable":"comments","foreignKey":"post_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### EmployerConversation / employerconversations

Affected: /api/admin-employer. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| employerId -> employerId | INTEGER | false | false | false |
| adminId -> adminId | INTEGER | false | false | false |
| last_message_text -> last_message_text | TEXT | true | false | false |
| last_message_at -> last_message_at | DATETIME | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"employerconversations_employerId_unique","unique":true,"fields":["employerId"]}]

Associations: [{"alias":"employer","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"employerId","through":null},{"alias":"admin","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"adminId","through":null},{"alias":"messages","type":"HasMany","targetModel":"EmployerMessage","targetTable":"employermessages","foreignKey":"conversationId","through":null}]

Foreign-key expectations: [{"sourceColumn":"employerId","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"adminId","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### EmployerMessage / employermessages

Affected: /api/admin-employer. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| conversationId -> conversationId | INTEGER | false | false | false |
| senderType -> senderType | ENUM('employer', 'admin') | false | false | false |
| senderId -> senderId | INTEGER | false | false | false |
| message -> message | TEXT | true | false | false |
| attachment -> attachment | VARCHAR(255) | true | false | false |
| file_name -> file_name | VARCHAR(255) | true | false | false |
| file_mime -> file_mime | VARCHAR(255) | true | false | false |
| file_size -> file_size | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"employer_messages_conversation_id_created_at","unique":false,"fields":["conversationId","createdAt"]},{"name":"employer_messages_sender_id","unique":false,"fields":["senderId"]}]

Associations: [{"alias":"conversation","type":"BelongsTo","targetModel":"EmployerConversation","targetTable":"employerconversations","foreignKey":"conversationId","through":null}]

Foreign-key expectations: [{"sourceColumn":"conversationId","targetTable":"employerconversations","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### PasswordResetToken / password_reset_tokens

Affected: /api/auth password-reset actions. Timestamp configuration: {"enabled":false,"createdAt":null,"updatedAt":null}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| user_id -> user_id | INTEGER | true | false | false |
| role -> role | VARCHAR(255) | true | false | false |
| token -> token | VARCHAR(255) | false | false | false |
| expires_at -> expires_at | DATETIME | true | false | false |

Indexes: [{"name":"password_reset_tokens_token_unique","unique":true,"fields":["token"]}]

Associations: [{"alias":"User","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"user_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### EmailQueueJob / email_queue_jobs

Affected: background email worker; notification/interview/verification/profile-update writes. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| to -> to | VARCHAR(255) | false | false | false |
| subject -> subject | VARCHAR(255) | false | false | false |
| message -> message | LONGTEXT | false | false | false |
| dedupe_key -> dedupe_key | VARCHAR(191) | true | false | false |
| status -> status | ENUM('pending', 'processing', 'sent', 'failed') | false | false | false |
| attempts -> attempts | INTEGER | false | false | false |
| max_attempts -> max_attempts | INTEGER | false | false | false |
| last_error -> last_error | LONGTEXT | true | false | false |
| scheduled_at -> scheduled_at | DATETIME | false | false | false |
| processing_started_at -> processing_started_at | DATETIME | true | false | false |
| sent_at -> sent_at | DATETIME | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"email_queue_jobs_dedupe_key_uq","unique":true,"fields":["dedupe_key"]},{"name":"email_queue_jobs_status_scheduled_at","unique":false,"fields":["status","scheduled_at"]},{"name":"email_queue_jobs_status_processing_started_at","unique":false,"fields":["status","processing_started_at"]}]

Associations: []

Foreign-key expectations: []

### RateLimitEntry / rate_limit_entries

Affected: rate-limited authentication/API middleware. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":null}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| scope -> scope | VARCHAR(255) | false | false | false |
| key -> key | VARCHAR(255) | false | false | false |
| window_start -> window_start | DATETIME | false | false | false |
| count -> count | INTEGER | false | false | false |
| expires_at -> expires_at | DATETIME | false | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |

Indexes: [{"name":"rate_limit_entries_scope_key_window_start","unique":true,"fields":["scope","key","window_start"]},{"name":"rate_limit_entries_expires_at","unique":false,"fields":["expires_at"]}]

Associations: []

Foreign-key expectations: []

### RequirementLibrary / requirementlibrary

Affected: /api/jobs/requirements/library. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":"updated_at"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| requirement_code -> requirement_code | VARCHAR(100) | false | false | false |
| category -> category | VARCHAR(100) | false | false | false |
| label -> label | VARCHAR(255) | false | false | false |
| description -> description | TEXT | true | false | false |
| requirement_type -> requirement_type | ENUM('document_upload', 'information_field') | false | false | false |
| value_type -> value_type | VARCHAR(50) | true | false | false |
| value_options -> value_options | JSON | true | false | false |
| is_active -> is_active | TINYINT(1) | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| created_at -> created_at | DATETIME | false | false | false |
| updated_at -> updated_at | DATETIME | false | false | false |

Indexes: [{"name":"requirementlibrary_requirement_code_unique","unique":true,"fields":["requirement_code"]}]

Associations: [{"alias":"JobRequirements","type":"HasMany","targetModel":"JobRequirement","targetTable":"jobrequirements","foreignKey":"library_id","through":null}]

Foreign-key expectations: []

### RequirementGroup / requirementgroups

Affected: /api/jobs requirement actions; applications. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":null}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| job_id -> job_id | INTEGER | false | false | false |
| version -> version | INTEGER | false | false | false |
| group_label -> group_label | VARCHAR(255) | false | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| created_at -> created_at | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Job","type":"BelongsTo","targetModel":"Job","targetTable":"jobs","foreignKey":"job_id","through":null},{"alias":"JobRequirements","type":"HasMany","targetModel":"JobRequirement","targetTable":"jobrequirements","foreignKey":"group_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"job_id","targetTable":"jobs","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### JobRequirement / jobrequirements

Affected: /api/jobs requirement actions; applications. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":null}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| job_id -> job_id | INTEGER | false | false | false |
| version -> version | INTEGER | false | false | false |
| group_id -> group_id | INTEGER | true | false | false |
| library_id -> library_id | INTEGER | true | false | false |
| requirement_code -> requirement_code | VARCHAR(100) | false | false | false |
| label -> label | VARCHAR(255) | false | false | false |
| description -> description | TEXT | true | false | false |
| requirement_type -> requirement_type | ENUM('document_upload', 'information_field') | false | false | false |
| value_type -> value_type | VARCHAR(50) | true | false | false |
| value_options -> value_options | JSON | true | false | false |
| required -> required | TINYINT(1) | true | false | false |
| is_custom -> is_custom | TINYINT(1) | true | false | false |
| condition_enabled -> condition_enabled | TINYINT(1) | true | false | false |
| condition_field -> condition_field | VARCHAR(100) | true | false | false |
| condition_operator -> condition_operator | VARCHAR(20) | true | false | false |
| condition_value -> condition_value | VARCHAR(500) | true | false | false |
| allowed_types -> allowed_types | VARCHAR(500) | true | false | false |
| max_file_size -> max_file_size | INTEGER | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| created_at -> created_at | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Job","type":"BelongsTo","targetModel":"Job","targetTable":"jobs","foreignKey":"job_id","through":null},{"alias":"RequirementGroup","type":"BelongsTo","targetModel":"RequirementGroup","targetTable":"requirementgroups","foreignKey":"group_id","through":null},{"alias":"RequirementLibrary","type":"BelongsTo","targetModel":"RequirementLibrary","targetTable":"requirementlibrary","foreignKey":"library_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"job_id","targetTable":"jobs","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"group_id","targetTable":"requirementgroups","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"},{"sourceColumn":"library_id","targetTable":"requirementlibrary","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"}]

### JobRequirementSnapshot / jobrequirementsnapshots

Affected: /api/applications requirement snapshots. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":null}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| application_id -> application_id | INTEGER | false | false | false |
| job_id -> job_id | INTEGER | false | false | false |
| version -> version | INTEGER | false | false | false |
| snapshot_data -> snapshot_data | JSON | false | false | false |
| created_at -> created_at | DATETIME | false | false | false |

Indexes: [{"name":"jobrequirementsnapshots_application_id_unique","unique":true,"fields":["application_id"]}]

Associations: [{"alias":"Application","type":"BelongsTo","targetModel":"Application","targetTable":"applications","foreignKey":"application_id","through":null},{"alias":"Job","type":"BelongsTo","targetModel":"Job","targetTable":"jobs","foreignKey":"job_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"application_id","targetTable":"applications","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"job_id","targetTable":"jobs","targetColumn":"id","onDelete":"NO ACTION","onUpdate":"CASCADE"}]

### ApplicationDocument / applicationdocuments

Affected: /api/applications document review/preview/download. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":"updated_at"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| application_id -> application_id | INTEGER | false | false | false |
| requirement_code -> requirement_code | VARCHAR(100) | false | false | false |
| file_path -> file_path | TEXT | false | false | false |
| file_name -> file_name | VARCHAR(255) | false | false | false |
| file_size -> file_size | INTEGER | true | false | false |
| mime_type -> mime_type | VARCHAR(100) | true | false | false |
| review_status -> review_status | ENUM('pending_review', 'approved', 'rejected', 'needs_revision') | true | false | false |
| review_notes -> review_notes | TEXT | true | false | false |
| reviewed_by -> reviewed_by | INTEGER | true | false | false |
| reviewed_at -> reviewed_at | DATETIME | true | false | false |
| original_document_id -> original_document_id | INTEGER | true | false | false |
| version -> version | INTEGER | false | false | false |
| created_at -> created_at | DATETIME | false | false | false |
| updated_at -> updated_at | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Application","type":"BelongsTo","targetModel":"Application","targetTable":"applications","foreignKey":"application_id","through":null},{"alias":"originalDocument","type":"BelongsTo","targetModel":"ApplicationDocument","targetTable":"applicationdocuments","foreignKey":"original_document_id","through":null},{"alias":"revisions","type":"HasMany","targetModel":"ApplicationDocument","targetTable":"applicationdocuments","foreignKey":"original_document_id","through":null},{"alias":"reviewer","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"reviewed_by","through":null}]

Foreign-key expectations: [{"sourceColumn":"application_id","targetTable":"applications","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"reviewed_by","targetTable":"users","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"},{"sourceColumn":"original_document_id","targetTable":"applicationdocuments","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"}]

### ApplicationResponse / applicationresponses

Affected: /api/applications requirement responses. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":"updated_at"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| application_id -> application_id | INTEGER | false | false | false |
| requirement_code -> requirement_code | VARCHAR(100) | false | false | false |
| response_value -> response_value | TEXT | false | false | false |
| review_status -> review_status | ENUM('pending_review', 'approved', 'rejected', 'needs_revision') | true | false | false |
| review_notes -> review_notes | TEXT | true | false | false |
| reviewed_by -> reviewed_by | INTEGER | true | false | false |
| reviewed_at -> reviewed_at | DATETIME | true | false | false |
| version -> version | INTEGER | false | false | false |
| created_at -> created_at | DATETIME | false | false | false |
| updated_at -> updated_at | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Application","type":"BelongsTo","targetModel":"Application","targetTable":"applications","foreignKey":"application_id","through":null},{"alias":"responseReviewer","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"reviewed_by","through":null}]

Foreign-key expectations: [{"sourceColumn":"application_id","targetTable":"applications","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"reviewed_by","targetTable":"users","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"}]

### AuditLog / auditlogs

Affected: admin/applications/profile/membership audit writes and tracking reads. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":null}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| actor_id -> actor_id | INTEGER | false | false | false |
| actor_role -> actor_role | VARCHAR(50) | false | false | false |
| action -> action | VARCHAR(100) | false | false | false |
| target_type -> target_type | VARCHAR(50) | false | false | false |
| target_id -> target_id | INTEGER | true | false | false |
| requirement_code -> requirement_code | VARCHAR(100) | true | false | false |
| metadata -> metadata | JSON | true | false | false |
| ip_address -> ip_address | VARCHAR(45) | true | false | false |
| created_at -> created_at | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"User","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"actor_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"actor_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### AlumniProfileUpdateRequest / alumniprofileupdaterequests

Affected: /api/admin alumni tracking; /api/profile update responses. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| alumni_user_id -> alumni_user_id | INTEGER | false | false | false |
| requested_by -> requested_by | INTEGER | false | false | false |
| notification_id -> notification_id | INTEGER | true | false | false |
| email_queue_job_id -> email_queue_job_id | INTEGER | true | false | false |
| status -> status | VARCHAR(30) | false | false | false |
| request_message -> request_message | TEXT | false | false | false |
| sent_at -> sent_at | DATETIME | true | false | false |
| responded_at -> responded_at | DATETIME | true | false | false |
| completed_at -> completed_at | DATETIME | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: [{"name":"alumni_profile_update_requests_user_status_idx","unique":false,"fields":["alumni_user_id","status"]},{"name":"alumni_profile_update_requests_actor_created_idx","unique":false,"fields":["requested_by","createdAt"]},{"name":"alumni_profile_update_requests_notification_uq","unique":true,"fields":["notification_id"]},{"name":"alumni_profile_update_requests_email_job_uq","unique":true,"fields":["email_queue_job_id"]}]

Associations: [{"alias":"alumni","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"alumni_user_id","through":null},{"alias":"requester","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"requested_by","through":null},{"alias":"emailQueueJob","type":"BelongsTo","targetModel":"EmailQueueJob","targetTable":"email_queue_jobs","foreignKey":"email_queue_job_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"alumni_user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"},{"sourceColumn":"requested_by","targetTable":"users","targetColumn":"id","onDelete":"NO ACTION","onUpdate":"CASCADE"},{"sourceColumn":"email_queue_job_id","targetTable":"email_queue_jobs","targetColumn":"id","onDelete":"SET NULL","onUpdate":"CASCADE"}]

### MembershipApplication / membershipapplications

Affected: /api/membership/me; membership admin/document/PDF routes. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":"updated_at"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| alumni_user_id -> alumni_user_id | INTEGER | false | false | false |
| personal_details -> personal_details | JSON | false | false | false |
| educational_attainment -> educational_attainment | JSON | false | false | false |
| work_experience -> work_experience | JSON | false | false | false |
| training_seminars -> training_seminars | JSON | false | false | false |
| community_involvement -> community_involvement | JSON | false | false | false |
| awards_citations -> awards_citations | JSON | false | false | false |
| options -> options | JSON | false | false | false |
| applicant_name -> applicant_name | VARCHAR(512) | false | false | false |
| academic_program -> academic_program | VARCHAR(255) | true | false | false |
| graduation_year -> graduation_year | INTEGER | true | false | false |
| consent_accepted -> consent_accepted | TINYINT(1) | false | false | false |
| consent_accepted_at -> consent_accepted_at | DATETIME | true | false | false |
| consent_text -> consent_text | TEXT | true | false | false |
| consent_version -> consent_version | VARCHAR(100) | true | false | false |
| application_status -> application_status | VARCHAR(30) | false | false | false |
| submitted_at -> submitted_at | DATETIME | true | false | false |
| profile_completed_at -> profile_completed_at | DATETIME | true | false | false |
| created_at -> created_at | DATETIME | false | false | false |
| updated_at -> updated_at | DATETIME | false | false | false |

Indexes: [{"name":"membership_application_alumni_uq","unique":true,"fields":["alumni_user_id"]},{"name":"membership_application_status_date_idx","unique":false,"fields":["application_status","submitted_at"]}]

Associations: [{"alias":"alumni","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"alumni_user_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"alumni_user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### MembershipAdministrator / membershipadministrators

Affected: /api/membership/access; membership admin routes. Timestamp configuration: {"enabled":true,"createdAt":"created_at","updatedAt":"updated_at"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| user_id -> user_id | INTEGER | false | false | false |
| granted_by -> granted_by | INTEGER | true | false | false |
| grant_reason -> grant_reason | VARCHAR(255) | false | false | false |
| revoked_at -> revoked_at | DATETIME | true | false | false |
| created_at -> created_at | DATETIME | false | false | false |
| updated_at -> updated_at | DATETIME | false | false | false |

Indexes: [{"name":"membershipadministrators_user_id_unique","unique":true,"fields":["user_id"]}]

Associations: [{"alias":"administrator","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"user_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### Resume / resumes

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| user_id -> user_id | INTEGER | false | false | false |
| title -> title | VARCHAR(255) | true | false | false |
| template_id -> template_id | VARCHAR(100) | true | false | false |
| font_family -> font_family | VARCHAR(100) | true | false | false |
| font_size -> font_size | INTEGER | true | false | false |
| line_spacing -> line_spacing | FLOAT | true | false | false |
| color_theme -> color_theme | VARCHAR(100) | true | false | false |
| settings -> settings | JSON | true | false | false |
| is_default -> is_default | TINYINT(1) | true | false | false |
| is_archived -> is_archived | TINYINT(1) | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"User","type":"BelongsTo","targetModel":"User","targetTable":"users","foreignKey":"user_id","through":null},{"alias":"personalInfo","type":"HasOne","targetModel":"ResumePersonalInfo","targetTable":"resumepersonalinfo","foreignKey":"resume_id","through":null},{"alias":"summary","type":"HasOne","targetModel":"ResumeSummary","targetTable":"resumesummaries","foreignKey":"resume_id","through":null},{"alias":"education","type":"HasMany","targetModel":"ResumeEducation","targetTable":"resumeeducations","foreignKey":"resume_id","through":null},{"alias":"workExperience","type":"HasMany","targetModel":"ResumeWorkExperience","targetTable":"resumeworkexperiences","foreignKey":"resume_id","through":null},{"alias":"skills","type":"HasMany","targetModel":"ResumeSkill","targetTable":"resumeskills","foreignKey":"resume_id","through":null},{"alias":"projects","type":"HasMany","targetModel":"ResumeProject","targetTable":"resumeprojects","foreignKey":"resume_id","through":null},{"alias":"certifications","type":"HasMany","targetModel":"ResumeCertification","targetTable":"resumecertifications","foreignKey":"resume_id","through":null},{"alias":"trainings","type":"HasMany","targetModel":"ResumeTraining","targetTable":"resumetrainings","foreignKey":"resume_id","through":null},{"alias":"seminars","type":"HasMany","targetModel":"ResumeSeminar","targetTable":"resumeseminars","foreignKey":"resume_id","through":null},{"alias":"awards","type":"HasMany","targetModel":"ResumeAward","targetTable":"resumeawards","foreignKey":"resume_id","through":null},{"alias":"organizations","type":"HasMany","targetModel":"ResumeOrganization","targetTable":"resumeorganizations","foreignKey":"resume_id","through":null},{"alias":"volunteerWork","type":"HasMany","targetModel":"ResumeVolunteerWork","targetTable":"resumevolunteerworks","foreignKey":"resume_id","through":null},{"alias":"languages","type":"HasMany","targetModel":"ResumeLanguage","targetTable":"resumelanguages","foreignKey":"resume_id","through":null},{"alias":"references","type":"HasMany","targetModel":"ResumeReference","targetTable":"resumereferences","foreignKey":"resume_id","through":null},{"alias":"versions","type":"HasMany","targetModel":"ResumeVersion","targetTable":"resumeversions","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"user_id","targetTable":"users","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumePersonalInfo / resumepersonalinfo

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| full_name -> full_name | VARCHAR(255) | true | false | false |
| professional_title -> professional_title | VARCHAR(255) | true | false | false |
| email -> email | VARCHAR(255) | true | false | false |
| phone -> phone | VARCHAR(50) | true | false | false |
| address -> address | TEXT | true | false | false |
| linkedin -> linkedin | VARCHAR(500) | true | false | false |
| github -> github | VARCHAR(500) | true | false | false |
| portfolio -> portfolio | VARCHAR(500) | true | false | false |
| website -> website | VARCHAR(500) | true | false | false |
| photo_url -> photo_url | TEXT | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeSummary / resumesummaries

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| content -> content | TEXT | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeEducation / resumeeducations

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| institution -> institution | VARCHAR(255) | true | false | false |
| degree -> degree | VARCHAR(255) | true | false | false |
| field_of_study -> field_of_study | VARCHAR(255) | true | false | false |
| start_date -> start_date | DATETIME | true | false | false |
| end_date -> end_date | DATETIME | true | false | false |
| is_current -> is_current | TINYINT(1) | true | false | false |
| gpa -> gpa | VARCHAR(20) | true | false | false |
| description -> description | TEXT | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeWorkExperience / resumeworkexperiences

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| job_title -> job_title | VARCHAR(255) | true | false | false |
| company -> company | VARCHAR(255) | true | false | false |
| location -> location | VARCHAR(255) | true | false | false |
| start_date -> start_date | DATETIME | true | false | false |
| end_date -> end_date | DATETIME | true | false | false |
| is_current -> is_current | TINYINT(1) | true | false | false |
| description -> description | TEXT | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeSkill / resumeskills

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| category -> category | VARCHAR(100) | true | false | false |
| skill_name -> skill_name | VARCHAR(255) | false | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeProject / resumeprojects

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| project_name -> project_name | VARCHAR(255) | true | false | false |
| description -> description | TEXT | true | false | false |
| technologies -> technologies | TEXT | true | false | false |
| url -> url | VARCHAR(500) | true | false | false |
| start_date -> start_date | DATETIME | true | false | false |
| end_date -> end_date | DATETIME | true | false | false |
| is_current -> is_current | TINYINT(1) | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeCertification / resumecertifications

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| name -> name | VARCHAR(255) | true | false | false |
| issuer -> issuer | VARCHAR(255) | true | false | false |
| issue_date -> issue_date | DATETIME | true | false | false |
| expiry_date -> expiry_date | DATETIME | true | false | false |
| credential_id -> credential_id | VARCHAR(255) | true | false | false |
| url -> url | VARCHAR(500) | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeTraining / resumetrainings

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| training_name -> training_name | VARCHAR(255) | true | false | false |
| provider -> provider | VARCHAR(255) | true | false | false |
| completion_date -> completion_date | DATETIME | true | false | false |
| description -> description | TEXT | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeSeminar / resumeseminars

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| seminar_name -> seminar_name | VARCHAR(255) | true | false | false |
| organizer -> organizer | VARCHAR(255) | true | false | false |
| date -> date | DATETIME | true | false | false |
| location -> location | VARCHAR(255) | true | false | false |
| description -> description | TEXT | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeAward / resumeawards

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| title -> title | VARCHAR(255) | true | false | false |
| issuer -> issuer | VARCHAR(255) | true | false | false |
| date -> date | DATETIME | true | false | false |
| description -> description | TEXT | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeOrganization / resumeorganizations

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| organization_name -> organization_name | VARCHAR(255) | true | false | false |
| position -> position | VARCHAR(255) | true | false | false |
| start_date -> start_date | DATETIME | true | false | false |
| end_date -> end_date | DATETIME | true | false | false |
| is_current -> is_current | TINYINT(1) | true | false | false |
| description -> description | TEXT | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeVolunteerWork / resumevolunteerworks

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| organization -> organization | VARCHAR(255) | true | false | false |
| role -> role | VARCHAR(255) | true | false | false |
| start_date -> start_date | DATETIME | true | false | false |
| end_date -> end_date | DATETIME | true | false | false |
| is_current -> is_current | TINYINT(1) | true | false | false |
| description -> description | TEXT | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeLanguage / resumelanguages

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| language -> language | VARCHAR(100) | true | false | false |
| proficiency -> proficiency | VARCHAR(100) | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeReference / resumereferences

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| name -> name | VARCHAR(255) | true | false | false |
| relationship -> relationship | VARCHAR(255) | true | false | false |
| company -> company | VARCHAR(255) | true | false | false |
| email -> email | VARCHAR(255) | true | false | false |
| phone -> phone | VARCHAR(50) | true | false | false |
| sort_order -> sort_order | INTEGER | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

### ResumeVersion / resumeversions

Affected: /api/resumes; application resume snapshots. Timestamp configuration: {"enabled":true,"createdAt":"createdAt","updatedAt":"updatedAt"}.

| Attribute -> stored column | Expected MySQL type | Nullable | PK | Auto increment |
| --- | --- | --- | --- | --- |
| id -> id | INTEGER | false | true | true |
| resume_id -> resume_id | INTEGER | false | false | false |
| version_number -> version_number | INTEGER | false | false | false |
| snapshot_data -> snapshot_data | JSON | true | false | false |
| change_summary -> change_summary | TEXT | true | false | false |
| createdAt -> createdAt | DATETIME | false | false | false |
| updatedAt -> updatedAt | DATETIME | false | false | false |

Indexes: []

Associations: [{"alias":"Resume","type":"BelongsTo","targetModel":"Resume","targetTable":"resumes","foreignKey":"resume_id","through":null}]

Foreign-key expectations: [{"sourceColumn":"resume_id","targetTable":"resumes","targetColumn":"id","onDelete":"CASCADE","onUpdate":"CASCADE"}]

## Complete route catalog (static registration inventory)

The catalog is taken from every mounted route file and server.js. No server was started, no handler was invoked against production, and no authorization was bypassed. Middleware remains unchanged.

| Method | Route | Registration |
| --- | --- | --- |
| POST | /api/auth/register | backend/routes/authRoutes.js:7 |
| POST | /api/auth/login | backend/routes/authRoutes.js:8 |
| POST | /api/auth/forgot-password | backend/routes/authRoutes.js:9 |
| POST | /api/auth/reset-password | backend/routes/authRoutes.js:10 |
| GET | /api/auth/admin-setup-status | backend/routes/authRoutes.js:11 |
| POST | /api/auth/admin-setup | backend/routes/authRoutes.js:12 |
| GET | /api/files/secure/:token | backend/routes/fileRoutes.js:6 |
| GET | /api/files/:folder/:fileName | backend/routes/fileRoutes.js:7 |
| GET | /api/profile | backend/routes/profileRoutes.js:9 |
| GET | /api/profile/:userId/preview | backend/routes/profileRoutes.js:10 |
| GET | /api/profile/:userId | backend/routes/profileRoutes.js:11 |
| PUT | /api/profile | backend/routes/profileRoutes.js:12 |
| GET | /api/profiles | backend/routes/profileRoutes.js:9 |
| GET | /api/profiles/:userId/preview | backend/routes/profileRoutes.js:10 |
| GET | /api/profiles/:userId | backend/routes/profileRoutes.js:11 |
| PUT | /api/profiles | backend/routes/profileRoutes.js:12 |
| GET | /api/jobs/requirements/library | backend/routes/jobRoutes.js:10 |
| GET | /api/jobs/requirements/library/:code | backend/routes/jobRoutes.js:11 |
| GET | /api/jobs | backend/routes/jobRoutes.js:14 |
| GET | /api/jobs/:id/interview-details | backend/routes/jobRoutes.js:15 |
| PUT | /api/jobs/:id/interview-details | backend/routes/jobRoutes.js:16 |
| GET | /api/jobs/:id | backend/routes/jobRoutes.js:17 |
| POST | /api/jobs | backend/routes/jobRoutes.js:20 |
| PUT | /api/jobs/:id | backend/routes/jobRoutes.js:21 |
| DELETE | /api/jobs/:id | backend/routes/jobRoutes.js:22 |
| POST | /api/jobs/:id/stop-recruitment | backend/routes/jobRoutes.js:25 |
| POST | /api/jobs/:id/reactivate-recruitment | backend/routes/jobRoutes.js:26 |
| GET | /api/jobs/:id/requirements | backend/routes/jobRoutes.js:29 |
| GET | /api/jobs/:id/requirements/versions | backend/routes/jobRoutes.js:30 |
| GET | /api/jobs/:id/preview | backend/routes/jobRoutes.js:31 |
| POST | /api/applications | backend/routes/applicationRoutes.js:10 |
| GET | /api/applications | backend/routes/applicationRoutes.js:11 |
| GET | /api/applications/employer | backend/routes/applicationRoutes.js:12 |
| GET | /api/applications/:id/interview-invitation | backend/routes/applicationRoutes.js:13 |
| POST | /api/applications/:id/interview-invitation | backend/routes/applicationRoutes.js:14 |
| POST | /api/applications/:id/interview-invitation/retry-email | backend/routes/applicationRoutes.js:15 |
| PUT | /api/applications/:id/archive | backend/routes/applicationRoutes.js:16 |
| PUT | /api/applications/:id/restore | backend/routes/applicationRoutes.js:17 |
| GET | /api/applications/jobs/:jobId/applicants | backend/routes/applicationRoutes.js:18 |
| PUT | /api/applications/:id/review | backend/routes/applicationRoutes.js:21 |
| PUT | /api/applications/:id/requirements/:code/review | backend/routes/applicationRoutes.js:22 |
| GET | /api/applications/:id/requirements/review-status | backend/routes/applicationRoutes.js:23 |
| GET | /api/applications/:id/documents/:documentId/file | backend/routes/applicationRoutes.js:24 |
| GET | /api/applications/:id/resume/file | backend/routes/applicationRoutes.js:25 |
| GET | /api/applications/:id/documents/download | backend/routes/applicationRoutes.js:28 |
| GET | /api/announcements | backend/routes/announcementRoutes.js:7 |
| POST | /api/announcements | backend/routes/announcementRoutes.js:8 |
| POST | /api/comments | backend/routes/commentRoutes.js:8 |
| GET | /api/comments/:announcement_id | backend/routes/commentRoutes.js:11 |
| GET | /api/chat/users | backend/routes/chatRoutes.js:7 |
| GET | /api/chat/conversations | backend/routes/chatRoutes.js:8 |
| POST | /api/chat/conversation | backend/routes/chatRoutes.js:9 |
| POST | /api/chat/message | backend/routes/chatRoutes.js:10 |
| GET | /api/chat/messages/:conversation_id | backend/routes/chatRoutes.js:11 |
| DELETE | /api/chat/conversation/:id | backend/routes/chatRoutes.js:12 |
| GET | /api/admin/alumni/users | backend/routes/adminRoutes.js:13 |
| GET | /api/admin/alumni/tracking-summary | backend/routes/adminRoutes.js:14 |
| GET | /api/admin/alumni/users/:userId/tracking | backend/routes/adminRoutes.js:15 |
| POST | /api/admin/alumni/users/:userId/profile-update-requests | backend/routes/adminRoutes.js:16 |
| PUT | /api/admin/alumni/users/:userId/status | backend/routes/adminRoutes.js:17 |
| POST | /api/admin/alumni/warnings | backend/routes/adminRoutes.js:18 |
| POST | /api/admin/alumni/announcements | backend/routes/adminRoutes.js:19 |
| GET | /api/admin/alumni/announcements | backend/routes/adminRoutes.js:20 |
| DELETE | /api/admin/alumni/announcements/:id | backend/routes/adminRoutes.js:21 |
| GET | /api/admin/employer/users | backend/routes/adminRoutes.js:27 |
| PUT | /api/admin/employer/users/:userId/status | backend/routes/adminRoutes.js:28 |
| POST | /api/admin/employer/warnings | backend/routes/adminRoutes.js:29 |
| GET | /api/admin/employer/jobs | backend/routes/adminRoutes.js:32 |
| GET | /api/admin/employer/applications | backend/routes/adminRoutes.js:33 |
| POST | /api/admin/employer/jobs | backend/routes/adminRoutes.js:34 |
| PUT | /api/admin/employer/jobs/:jobId/approval | backend/routes/adminRoutes.js:35 |
| DELETE | /api/admin/employer/jobs/:jobId | backend/routes/adminRoutes.js:36 |
| POST | /api/admin/employer/jobs/:jobId/stop-recruitment | backend/routes/adminRoutes.js:37 |
| POST | /api/admin/employer/jobs/:jobId/reactivate-recruitment | backend/routes/adminRoutes.js:50 |
| PUT | /api/admin/employer/applications/:applicationId/review | backend/routes/adminRoutes.js:51 |
| GET | /api/registrar/analytics | backend/routes/registrarRoutes.js:11 |
| GET | /api/alumni-records | backend/routes/alumniRecordRoutes.js:13 |
| GET | /api/alumni-records/search | backend/routes/alumniRecordRoutes.js:14 |
| POST | /api/alumni-records | backend/routes/alumniRecordRoutes.js:15 |
| POST | /api/alumni-records/import-csv | backend/routes/alumniRecordRoutes.js:16 |
| DELETE | /api/alumni-records/:id | backend/routes/alumniRecordRoutes.js:17 |
| GET | /api/notifications | backend/routes/notificationRoutes.js:9 |
| GET | /api/notifications/:id/interview | backend/routes/notificationRoutes.js:10 |
| PUT | /api/notifications/read/:id | backend/routes/notificationRoutes.js:13 |
| DELETE | /api/notifications/:id | backend/routes/notificationRoutes.js:14 |
| GET | /api/posts | backend/routes/postRoutes.js:5 |
| POST | /api/posts | backend/routes/postRoutes.js:6 |
| GET | /api/posts/:postId/comments | backend/routes/postRoutes.js:7 |
| POST | /api/posts/:postId/comments | backend/routes/postRoutes.js:8 |
| PUT | /api/posts/:postId | backend/routes/postRoutes.js:9 |
| DELETE | /api/posts/:postId | backend/routes/postRoutes.js:10 |
| GET | /api/messages/conversations | backend/routes/messageRoutes.js:8 |
| GET | /api/messages/search-users | backend/routes/messageRoutes.js:9 |
| POST | /api/messages/direct | backend/routes/messageRoutes.js:10 |
| GET | /api/messages/global | backend/routes/messageRoutes.js:11 |
| GET | /api/messages/employer | backend/routes/messageRoutes.js:15 |
| GET | /api/messages/batch/:year | backend/routes/messageRoutes.js:19 |
| GET | /api/messages/course | backend/routes/messageRoutes.js:23 |
| GET | /api/messages/files/:fileName | backend/routes/messageRoutes.js:27 |
| GET | /api/messages/:conversationId | backend/routes/messageRoutes.js:28 |
| POST | /api/messages | backend/routes/messageRoutes.js:29 |
| POST | /api/messages/:conversationId/read | backend/routes/messageRoutes.js:30 |
| POST | /api/messages/:conversationId | backend/routes/messageRoutes.js:31 |
| DELETE | /api/messages/:conversationId/messages/:messageId | backend/routes/messageRoutes.js:32 |
| GET | /api/admin-employer/conversations | backend/routes/adminEmployerMessageRoutes.js:20 |
| POST | /api/admin-employer/messages | backend/routes/adminEmployerMessageRoutes.js:24 |
| GET | /api/admin-employer/messages/files/:fileName | backend/routes/adminEmployerMessageRoutes.js:29 |
| GET | /api/admin-employer/messages/:employerId | backend/routes/adminEmployerMessageRoutes.js:33 |
| DELETE | /api/admin-employer/messages/:employerId/:messageId | backend/routes/adminEmployerMessageRoutes.js:37 |
| GET | /api/users/pending | backend/routes/userRoutes.js:11 |
| PUT | /api/users/:id/approve | backend/routes/userRoutes.js:12 |
| PUT | /api/users/:id/reject | backend/routes/userRoutes.js:13 |
| GET | /api/resumes | backend/routes/resumeRoutes.js:8 |
| GET | /api/resumes/:id | backend/routes/resumeRoutes.js:9 |
| POST | /api/resumes | backend/routes/resumeRoutes.js:10 |
| PUT | /api/resumes/:id | backend/routes/resumeRoutes.js:11 |
| DELETE | /api/resumes/:id | backend/routes/resumeRoutes.js:12 |
| POST | /api/resumes/:id/duplicate | backend/routes/resumeRoutes.js:13 |
| GET | /api/resumes/:id/versions | backend/routes/resumeRoutes.js:14 |
| POST | /api/resumes/:id/snapshot | backend/routes/resumeRoutes.js:15 |
| GET | /api/resumes/:id/pdf | backend/routes/resumeRoutes.js:16 |
| POST | /api/resumes/:id/pdf | backend/routes/resumeRoutes.js:17 |
| GET | /api/membership/access | backend/routes/membershipRoutes.js:6 |
| GET | /api/membership/me | backend/routes/membershipRoutes.js:7 |
| PUT | /api/membership/me/draft | backend/routes/membershipRoutes.js:8 |
| POST | /api/membership/me/submit | backend/routes/membershipRoutes.js:9 |
| GET | /api/membership/me/document | backend/routes/membershipRoutes.js:10 |
| GET | /api/membership/me/pdf | backend/routes/membershipRoutes.js:11 |
| GET | /api/membership/admin | backend/routes/membershipRoutes.js:12 |
| GET | /api/membership/admin/:id/document | backend/routes/membershipRoutes.js:13 |
| GET | /api/membership/admin/:id/pdf | backend/routes/membershipRoutes.js:14 |
| GET | /api/membership/admin/:id | backend/routes/membershipRoutes.js:15 |

Health is registered directly at GET /api/health; it checks only authentication/registration schema and connectivity, not every table. The static SPA fallback and uploaded image routes do not establish database readiness.

## Source files inspected

- backend/migrations/20260324-add-admin-profile-columns.js (34 lines; schema/SQL references at 8, 15, 26, 30)
- backend/migrations/20260327-add-expected-salary-to-jobs.js (23 lines; schema/SQL references at 8, 19)
- backend/migrations/20260328-add-schedule-columns-to-announcements.js (45 lines; schema/SQL references at 8, 15, 22, 33, 37, 41)
- backend/migrations/20260413-create-email-queue-and-rate-limit-tables.js (148 lines; schema/SQL references at 3, 8, 11, 12, 16, 19, 26, 84, 87, 93, 128, 132, 140, 144)
- backend/migrations/20260414-unify-messaging-and-harden-infra.js (302 lines; schema/SQL references at 3, 7, 8, 9, 10, 14, 15, 19, 20, 31, 43, 44, 53, 54, 63, 72, 84, 92, 93, 98, 104, 105, 110, 117, 126, 127, 140, 146, 147, 153, 159, 160, 166, 173, 174, 201, 215, 219, 223, 238, 246, 257, 261, 272, 278, 282, 286, 291, 292, 294, 298)
- backend/migrations/20260518-add-missing-application-identity-columns.js (46 lines; schema/SQL references at 3, 4, 11, 18, 25, 34, 38, 42)
- backend/migrations/20260526-add-feed-indexes.js (52 lines; schema/SQL references at 3, 7, 8, 9, 10, 14, 15, 23, 31, 41, 47)
- backend/migrations/20260616-add-employment-status-to-alumni-profiles.js (67 lines; schema/SQL references at 3, 4, 15, 19, 25, 26, 27, 47, 49, 55, 56)
- backend/migrations/20260618-add-alumni-record-id-to-users.js (63 lines; schema/SQL references at 3, 4, 14, 16, 22, 23, 24, 44, 46, 52, 53)
- backend/migrations/20260709-add-requirement-fields-to-jobs.js (58 lines; schema/SQL references at 3, 4, 13, 25, 47, 50)
- backend/migrations/20260709-create-application-documents.js (70 lines; schema/SQL references at 3, 5, 13, 40, 46, 47, 48, 61)
- backend/migrations/20260709-create-application-responses.js (64 lines; schema/SQL references at 3, 5, 13, 36, 42, 43, 56)
- backend/migrations/20260709-create-audit-logs.js (59 lines; schema/SQL references at 3, 5, 13, 34, 35, 36, 37, 38, 51)
- backend/migrations/20260709-create-job-requirement-snapshots.js (52 lines; schema/SQL references at 3, 5, 13, 30, 31, 44)
- backend/migrations/20260709-create-job-requirements.js (71 lines; schema/SQL references at 3, 5, 13, 49, 50, 63)
- backend/migrations/20260709-create-requirement-groups.js (51 lines; schema/SQL references at 3, 5, 13, 30, 43)
- backend/migrations/20260709-create-requirement-library.js (96 lines; schema/SQL references at 3, 5, 13, 67, 73, 74, 88)
- backend/migrations/20260719-add-recruitment-lifecycle.js (60 lines; schema/SQL references at 3, 4, 13, 26, 49, 52)
- backend/migrations/20260720-create-resume-system.js (545 lines; schema/SQL references at 3, 5, 15, 37, 43, 44, 49, 72, 78, 83, 97, 103, 108, 130, 136, 137, 142, 163, 169, 170, 175, 191, 197, 198, 203, 224, 230, 231, 236, 256, 262, 263, 268, 286, 292, 293, 298, 317, 323, 324, 329, 347, 353, 354, 359, 379, 385, 386, 391, 411, 417, 418, 423, 439, 445, 446, 451, 470, 476, 477, 482, 499, 500, 535)
- backend/migrations/20260724-add-missing-timestamps-to-resume-tables.js (107 lines; schema/SQL references at 29, 30, 34, 37, 45, 48, 85, 86, 90, 93, 96)
- backend/migrations/20260725-add-proof-document-to-alumni-profiles.js (65 lines; schema/SQL references at 3, 4, 14, 16, 23, 24, 25, 45, 47, 54, 55)
- backend/migrations/20261009-add-employer-message-file-metadata.js (16 lines; schema/SQL references at 6, 7, 12, 13)
- backend/migrations/20261011-add-message-file-sizes.js (23 lines; schema/SQL references at 5, 6, 8, 17, 18, 19)
- backend/migrations/20261012-add-application-archive-flag.js (20 lines; schema/SQL references at 7, 17)
- backend/migrations/20261012-add-job-interview-invitations.js (62 lines; schema/SQL references at 3, 4, 5, 19, 22, 28, 36, 46, 49, 56)
- backend/migrations/20261013-create-alumni-profile-update-requests.js (63 lines; schema/SQL references at 3, 5, 12, 17, 24, 31, 38, 48, 51, 52, 53, 54, 59)
- backend/migrations/20261013-expand-application-document-file-path.js (40 lines; schema/SQL references at 8, 17, 28, 29, 34)
- backend/migrations/20261014-add-job-posting-details.js (14 lines; schema/SQL references at 7)
- backend/migrations/20261014-create-membership-applications.js (58 lines; schema/SQL references at 6, 8, 13, 20, 38, 41, 44, 52)
- backend/migrations/20261014-grant-registrar-membership-access.js (10 lines; schema/SQL references at 6)
- backend/migrations/20261014-transfer-membership-access-to-admin-alumni.js (22 lines; schema/SQL references at 8, 9, 12, 13)
- backend/migrations/20261016-repair-email-queue-dedupe-key.js (39 lines; schema/SQL references at 6, 17, 28, 31)
- backend/routes/adminEmployerMessageRoutes.js (43 lines; schema/SQL references at 17, 18, 20, 24, 29, 33, 37)
- backend/routes/adminRoutes.js (55 lines; schema/SQL references at 9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 27, 28, 29, 32, 33, 34, 35, 36, 37, 50, 51)
- backend/routes/alumniRecordRoutes.js (20 lines; schema/SQL references at 9, 10, 11, 13, 14, 15, 16, 17)
- backend/routes/announcementRoutes.js (11 lines; schema/SQL references at 7, 8)
- backend/routes/applicationRoutes.js (31 lines; schema/SQL references at 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 28)
- backend/routes/authRoutes.js (15 lines; schema/SQL references at 7, 8, 9, 10, 11, 12)
- backend/routes/chatRoutes.js (15 lines; schema/SQL references at 5, 7, 8, 9, 10, 11, 12)
- backend/routes/commentRoutes.js (13 lines; schema/SQL references at 5, 8, 11)
- backend/routes/fileRoutes.js (10 lines; schema/SQL references at 5, 6, 7)
- backend/routes/jobRoutes.js (34 lines; schema/SQL references at 10, 11, 14, 15, 16, 17, 20, 21, 22, 25, 26, 29, 30, 31)
- backend/routes/membershipRoutes.js (17 lines; schema/SQL references at 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
- backend/routes/messageRoutes.js (35 lines; schema/SQL references at 6, 8, 9, 10, 11, 15, 19, 23, 27, 28, 29, 30, 31, 32)
- backend/routes/notificationRoutes.js (17 lines; schema/SQL references at 6, 9, 10, 13, 14)
- backend/routes/postRoutes.js (13 lines; schema/SQL references at 5, 6, 7, 8, 9, 10)
- backend/routes/profileRoutes.js (15 lines; schema/SQL references at 7, 9, 10, 11, 12)
- backend/routes/registrarRoutes.js (14 lines; schema/SQL references at 7, 8, 9, 11)
- backend/routes/resumeRoutes.js (20 lines; schema/SQL references at 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
- backend/routes/userRoutes.js (16 lines; schema/SQL references at 7, 8, 9, 11, 12, 13)
- backend/controllers/adminController.js (616 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/adminEmployerMessageController.js (541 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/alumniRecordController.js (200 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/alumniRecordImportController.js (79 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/announcementController.js (73 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/applicationController.js (1223 lines; schema/SQL references at 141, 858, 862)
- backend/controllers/authController.js (459 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/chatController.js (165 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/commentController.js (29 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/fileController.js (270 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/healthController.js (19 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/jobController.js (843 lines; schema/SQL references at 13, 44, 46, 731)
- backend/controllers/membershipController.js (210 lines; schema/SQL references at 31, 98)
- backend/controllers/messageController.js (1039 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/notificationController.js (125 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/postController.js (224 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/profileController.js (301 lines; schema/SQL references at 174)
- backend/controllers/profilePreviewController.js (104 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/registrarController.js (154 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/requirementController.js (53 lines; schema/SQL references at none found by inventory scan)
- backend/controllers/resumeController.js (360 lines; schema/SQL references at 79, 107, 158, 192, 266, 341)
- backend/services/alumniProfileSave.js (85 lines; schema/SQL references at 50, 55)
- backend/services/auditService.js (40 lines; schema/SQL references at none found by inventory scan)
- backend/services/jobPosting.js (134 lines; schema/SQL references at none found by inventory scan)
- backend/services/membershipDocument.js (180 lines; schema/SQL references at none found by inventory scan)
- backend/services/membershipListing.js (51 lines; schema/SQL references at none found by inventory scan)
- backend/services/membershipValidation.js (68 lines; schema/SQL references at none found by inventory scan)
- backend/services/objectStorage.js (271 lines; schema/SQL references at none found by inventory scan)
- backend/services/resumePdf.js (70 lines; schema/SQL references at none found by inventory scan)
- backend/services/resumePersistence.js (98 lines; schema/SQL references at 18)
- backend/utils/alumniRecordsCsv.js (112 lines; schema/SQL references at none found by inventory scan)
- backend/utils/alumniRecordsWriteLock.js (15 lines; schema/SQL references at none found by inventory scan)
- backend/utils/databaseReadiness.js (23 lines; schema/SQL references at none found by inventory scan)
- backend/utils/email.js (42 lines; schema/SQL references at none found by inventory scan)
- backend/utils/emailQueue.js (45 lines; schema/SQL references at none found by inventory scan)
- backend/utils/employmentType.js (23 lines; schema/SQL references at none found by inventory scan)
- backend/utils/fieldEncryption.js (51 lines; schema/SQL references at none found by inventory scan)
- backend/utils/jobTableDiagnostics.js (24 lines; schema/SQL references at 5, 13, 14)
- backend/utils/rateLimitStore.js (57 lines; schema/SQL references at 24, 26, 27, 29, 35, 36)
- backend/utils/schemaAudit.js (38 lines; schema/SQL references at 9, 15)
- backend/utils/storedFiles.js (79 lines; schema/SQL references at none found by inventory scan)
- backend/utils/targetGraduationYear.js (19 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/adminScopeMiddleware.js (18 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/alumniCsvUpload.js (23 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/authMiddleware.js (35 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/bootstrapGuard.js (49 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/employerAccess.js (22 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/errorHandler.js (83 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/optionalAuthMiddleware.js (31 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/rateLimiter.js (51 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/requestLogger.js (24 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/roleMiddleware.js (17 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/sanitizeMiddleware.js (43 lines; schema/SQL references at none found by inventory scan)
- backend/middleware/uploadMiddleware.js (329 lines; schema/SQL references at none found by inventory scan)
- backend/config/database.js (51 lines; schema/SQL references at 23)
- backend/workers/emailQueueWorker.js (159 lines; schema/SQL references at none found by inventory scan)

## Migration operation references (all 32 files)

The following excerpts record the actual operation locations inspected. They are source excerpts, not executed SQL or approval to replay the migration. DML and removals require separate review.

### backend/migrations/20260324-add-admin-profile-columns.js

- Line 8: `await queryInterface.addColumn("Users", "admin_department", {`
- Line 15: `await queryInterface.addColumn("Users", "admin_avatar_url", {`

### backend/migrations/20260327-add-expected-salary-to-jobs.js

- Line 8: `await queryInterface.addColumn("Jobs", "expected_salary", {`

### backend/migrations/20260328-add-schedule-columns-to-announcements.js

- Line 8: `await queryInterface.addColumn("Announcements", "day", {`
- Line 15: `await queryInterface.addColumn("Announcements", "time", {`
- Line 22: `await queryInterface.addColumn("Announcements", "location", {`

### backend/migrations/20260413-create-email-queue-and-rate-limit-tables.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 8: `return table.toLowerCase() === tableName.toLowerCase();`
- Line 11: `if (table?.tableName) {`
- Line 12: `return String(table.tableName).toLowerCase() === tableName.toLowerCase();`
- Line 16: `return String(table.TABLE_NAME).toLowerCase() === tableName.toLowerCase();`
- Line 19: `return String(table).toLowerCase() === tableName.toLowerCase();`
- Line 26: `await queryInterface.createTable("email_queue_jobs", {`
- Line 84: `await queryInterface.addIndex("email_queue_jobs", ["status", "available_at"], {`
- Line 87: `await queryInterface.addIndex("email_queue_jobs", ["reserved_at"], {`
- Line 93: `await queryInterface.createTable("rate_limit_entries", {`
- Line 128: `await queryInterface.addIndex("rate_limit_entries", ["scope", "key", "window_start"], {`
- Line 132: `await queryInterface.addIndex("rate_limit_entries", ["expires_at"], {`

### backend/migrations/20260414-unify-messaging-and-harden-infra.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 7: `if (typeof table === "string") return table.toLowerCase() === tableName.toLowerCase();`
- Line 8: `if (table?.tableName) return String(table.tableName).toLowerCase() === tableName.toLowerCase();`
- Line 9: `if (table?.TABLE_NAME) return String(table.TABLE_NAME).toLowerCase() === tableName.toLowerCase();`
- Line 10: `return String(table).toLowerCase() === tableName.toLowerCase();`
- Line 14: `const hasColumn = async (queryInterface, tableName, columnName) => {`
- Line 15: `const columns = await queryInterface.describeTable(tableName);`
- Line 19: `const hasIndex = async (queryInterface, tableName, indexName) => {`
- Line 20: `const indexes = await queryInterface.showIndex(tableName);`
- Line 31: `await queryInterface.addColumn(`
- Line 43: `await queryInterface.sequelize.query(`
- Line 44: `'UPDATE Conversations`
- Line 53: `await queryInterface.sequelize.query(`
- Line 54: `'UPDATE Conversations`
- Line 63: `await queryInterface.addIndex("Conversations", ["type", "last_message_at"], {`
- Line 72: `await queryInterface.addColumn(`
- Line 84: `await queryInterface.addIndex("Messages", ["conversation_id", "id"], {`
- Line 92: `await queryInterface.sequelize.query(`
- Line 93: `'INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)`
- Line 98: `SELECT 1 FROM ConversationParticipants cp`
- Line 104: `await queryInterface.sequelize.query(`
- Line 105: `'INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)`
- Line 110: `SELECT 1 FROM ConversationParticipants cp`
- Line 117: `await queryInterface.addIndex("ConversationParticipants", ["conversation_id", "user_id"], {`
- Line 126: `await queryInterface.sequelize.query(`
- Line 127: `'INSERT INTO Conversations (conversation_key, name, type, last_message_text, last_message_at, createdAt, updatedAt)`
- Line 140: `SELECT 1 FROM Conversations c`
- Line 146: `await queryInterface.sequelize.query(`
- Line 147: `'INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)`
- Line 153: `SELECT 1 FROM ConversationParticipants cp`
- Line 159: `await queryInterface.sequelize.query(`
- Line 160: `'INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)`
- Line 166: `SELECT 1 FROM ConversationParticipants cp`
- Line 173: `await queryInterface.sequelize.query(`
- Line 174: `'INSERT INTO Messages (`
- Line 201: `SELECT 1 FROM Messages m`
- Line 215: `await queryInterface.renameColumn("email_queue_jobs", "available_at", "scheduled_at", { transaction });`
- Line 219: `await queryInterface.renameColumn("email_queue_jobs", "reserved_at", "processing_started_at", { transaction });`
- Line 223: `await queryInterface.addColumn(`
- Line 238: `await queryInterface.addIndex("Users", ["email"], {`
- Line 246: `await queryInterface.addIndex("Users", ["role", "admin_scope"], {`
- Line 257: `await queryInterface.dropTable("EmployerMessages");`
- Line 261: `await queryInterface.dropTable("EmployerConversations");`

### backend/migrations/20260518-add-missing-application-identity-columns.js

- Line 3: `const hasColumn = async (queryInterface, tableName, columnName) => {`
- Line 4: `const columns = await queryInterface.describeTable(tableName);`
- Line 11: `await queryInterface.addColumn("Applications", "full_name", {`
- Line 18: `await queryInterface.addColumn("Applications", "email", {`
- Line 25: `await queryInterface.addColumn("Applications", "dob", {`

### backend/migrations/20260526-add-feed-indexes.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 7: `if (typeof table === "string") return table.toLowerCase() === tableName.toLowerCase();`
- Line 8: `if (table?.tableName) return String(table.tableName).toLowerCase() === tableName.toLowerCase();`
- Line 9: `if (table?.TABLE_NAME) return String(table.TABLE_NAME).toLowerCase() === tableName.toLowerCase();`
- Line 10: `return String(table).toLowerCase() === tableName.toLowerCase();`
- Line 14: `const hasIndex = async (queryInterface, tableName, indexName) => {`
- Line 15: `const indexes = await queryInterface.showIndex(tableName);`
- Line 23: `await queryInterface.addIndex("Posts", ["createdAt"], {`
- Line 31: `await queryInterface.addIndex("Comments", ["post_id", "createdAt"], {`

### backend/migrations/20260616-add-employment-status-to-alumni-profiles.js

- Line 3: `const hasColumn = async (queryInterface, tableName, columnName) => {`
- Line 4: `const columns = await queryInterface.describeTable(tableName);`
- Line 15: `const tableName = "AlumniProfiles";`
- Line 19: `const exists = tables.some((t) => normalizeTableName(t).toLowerCase() === tableName.toLowerCase());`
- Line 25: `if (!(await hasColumn(queryInterface, tableName, "employment_status"))) {`
- Line 26: `await queryInterface.addColumn(`
- Line 27: `tableName,`

### backend/migrations/20260618-add-alumni-record-id-to-users.js

- Line 3: `const hasColumn = async (queryInterface, tableName, columnName) => {`
- Line 4: `const columns = await queryInterface.describeTable(tableName);`
- Line 14: `const tableName = "Users";`
- Line 16: `const exists = tables.some((t) => normalizeTableName(t).toLowerCase() === tableName.toLowerCase());`
- Line 22: `if (!(await hasColumn(queryInterface, tableName, "alumni_record_id"))) {`
- Line 23: `await queryInterface.addColumn(`
- Line 24: `tableName,`

### backend/migrations/20260709-add-requirement-fields-to-jobs.js

- Line 3: `const hasColumn = async (queryInterface, tableName, columnName) => {`
- Line 4: `const columns = await queryInterface.describeTable(tableName);`
- Line 13: `await queryInterface.addColumn(`
- Line 25: `await queryInterface.addColumn(`

### backend/migrations/20260709-create-application-documents.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 13: `await queryInterface.createTable(`
- Line 40: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 46: `await queryInterface.addIndex("ApplicationDocuments", ["application_id"], { transaction });`
- Line 47: `await queryInterface.addIndex("ApplicationDocuments", ["requirement_code"], { transaction });`
- Line 48: `await queryInterface.addIndex("ApplicationDocuments", ["review_status"], { transaction });`

### backend/migrations/20260709-create-application-responses.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 13: `await queryInterface.createTable(`
- Line 36: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 42: `await queryInterface.addIndex("ApplicationResponses", ["application_id"], { transaction });`
- Line 43: `await queryInterface.addIndex("ApplicationResponses", ["requirement_code"], { transaction });`

### backend/migrations/20260709-create-audit-logs.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 13: `await queryInterface.createTable(`
- Line 34: `await queryInterface.addIndex("AuditLogs", ["actor_id"], { transaction });`
- Line 35: `await queryInterface.addIndex("AuditLogs", ["action"], { transaction });`
- Line 36: `await queryInterface.addIndex("AuditLogs", ["target_type", "target_id"], { transaction });`
- Line 37: `await queryInterface.addIndex("AuditLogs", ["requirement_code"], { transaction });`
- Line 38: `await queryInterface.addIndex("AuditLogs", ["created_at"], { transaction });`

### backend/migrations/20260709-create-job-requirement-snapshots.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 13: `await queryInterface.createTable(`
- Line 30: `await queryInterface.addIndex("JobRequirementSnapshots", ["application_id"], { transaction });`
- Line 31: `await queryInterface.addIndex("JobRequirementSnapshots", ["job_id", "version"], { transaction });`

### backend/migrations/20260709-create-job-requirements.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 13: `await queryInterface.createTable(`
- Line 49: `await queryInterface.addIndex("JobRequirements", ["job_id", "version"], { transaction });`
- Line 50: `await queryInterface.addIndex("JobRequirements", ["requirement_code"], { transaction });`

### backend/migrations/20260709-create-requirement-groups.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 13: `await queryInterface.createTable(`
- Line 30: `await queryInterface.addIndex("RequirementGroups", ["job_id", "version"], { transaction });`

### backend/migrations/20260709-create-requirement-library.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 13: `await queryInterface.createTable(`
- Line 67: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 73: `await queryInterface.addIndex("RequirementLibrary", ["requirement_code"], { transaction });`
- Line 74: `await queryInterface.addIndex("RequirementLibrary", ["category"], { transaction });`

### backend/migrations/20260719-add-recruitment-lifecycle.js

- Line 3: `const hasColumn = async (queryInterface, tableName, columnName) => {`
- Line 4: `const columns = await queryInterface.describeTable(tableName);`
- Line 13: `await queryInterface.addColumn(`
- Line 26: `await queryInterface.addColumn(`

### backend/migrations/20260720-create-resume-system.js

- Line 3: `const hasTable = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());`
- Line 15: `await queryInterface.createTable(`
- Line 37: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 43: `await queryInterface.addIndex("Resumes", ["user_id"], { transaction });`
- Line 44: `await queryInterface.addIndex("Resumes", ["user_id", "is_archived"], { transaction });`
- Line 49: `await queryInterface.createTable(`
- Line 72: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 78: `await queryInterface.addIndex("ResumePersonalInfo", ["resume_id"], { unique: true, transaction });`
- Line 83: `await queryInterface.createTable(`
- Line 97: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 103: `await queryInterface.addIndex("ResumeSummaries", ["resume_id"], { unique: true, transaction });`
- Line 108: `await queryInterface.createTable(`
- Line 130: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 136: `await queryInterface.addIndex("ResumeEducation", ["resume_id"], { transaction });`
- Line 137: `await queryInterface.addIndex("ResumeEducation", ["resume_id", "sort_order"], { transaction });`
- Line 142: `await queryInterface.createTable(`
- Line 163: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 169: `await queryInterface.addIndex("ResumeWorkExperience", ["resume_id"], { transaction });`
- Line 170: `await queryInterface.addIndex("ResumeWorkExperience", ["resume_id", "sort_order"], { transaction });`
- Line 175: `await queryInterface.createTable(`
- Line 191: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 197: `await queryInterface.addIndex("ResumeSkills", ["resume_id"], { transaction });`
- Line 198: `await queryInterface.addIndex("ResumeSkills", ["resume_id", "category"], { transaction });`
- Line 203: `await queryInterface.createTable(`
- Line 224: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 230: `await queryInterface.addIndex("ResumeProjects", ["resume_id"], { transaction });`
- Line 231: `await queryInterface.addIndex("ResumeProjects", ["resume_id", "sort_order"], { transaction });`
- Line 236: `await queryInterface.createTable(`
- Line 256: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 262: `await queryInterface.addIndex("ResumeCertifications", ["resume_id"], { transaction });`
- Line 263: `await queryInterface.addIndex("ResumeCertifications", ["resume_id", "sort_order"], { transaction });`
- Line 268: `await queryInterface.createTable(`
- Line 286: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 292: `await queryInterface.addIndex("ResumeTrainings", ["resume_id"], { transaction });`
- Line 293: `await queryInterface.addIndex("ResumeTrainings", ["resume_id", "sort_order"], { transaction });`
- Line 298: `await queryInterface.createTable(`
- Line 317: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 323: `await queryInterface.addIndex("ResumeSeminars", ["resume_id"], { transaction });`
- Line 324: `await queryInterface.addIndex("ResumeSeminars", ["resume_id", "sort_order"], { transaction });`
- Line 329: `await queryInterface.createTable(`
- Line 347: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 353: `await queryInterface.addIndex("ResumeAwards", ["resume_id"], { transaction });`
- Line 354: `await queryInterface.addIndex("ResumeAwards", ["resume_id", "sort_order"], { transaction });`
- Line 359: `await queryInterface.createTable(`
- Line 379: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 385: `await queryInterface.addIndex("ResumeOrganizations", ["resume_id"], { transaction });`
- Line 386: `await queryInterface.addIndex("ResumeOrganizations", ["resume_id", "sort_order"], { transaction });`
- Line 391: `await queryInterface.createTable(`
- Line 411: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 417: `await queryInterface.addIndex("ResumeVolunteerWork", ["resume_id"], { transaction });`
- Line 418: `await queryInterface.addIndex("ResumeVolunteerWork", ["resume_id", "sort_order"], { transaction });`
- Line 423: `await queryInterface.createTable(`
- Line 439: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 445: `await queryInterface.addIndex("ResumeLanguages", ["resume_id"], { transaction });`
- Line 446: `await queryInterface.addIndex("ResumeLanguages", ["resume_id", "sort_order"], { transaction });`
- Line 451: `await queryInterface.createTable(`
- Line 470: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`
- Line 476: `await queryInterface.addIndex("ResumeReferences", ["resume_id"], { transaction });`
- Line 477: `await queryInterface.addIndex("ResumeReferences", ["resume_id", "sort_order"], { transaction });`
- Line 482: `await queryInterface.createTable(`
- Line 499: `await queryInterface.addIndex("ResumeVersions", ["resume_id"], { transaction });`
- Line 500: `await queryInterface.addIndex("ResumeVersions", ["resume_id", "version_number"], { unique: true, transaction });`

### backend/migrations/20260724-add-missing-timestamps-to-resume-tables.js

- Line 29: `for (const tableName of tablesToFix) {`
- Line 30: `if (!existingLower.includes(tableName.toLowerCase())) {`
- Line 34: `const columns = await queryInterface.describeTable(tableName, { transaction });`
- Line 37: `await queryInterface.addColumn(tableName, 'created_at', {`
- Line 45: `await queryInterface.addColumn(tableName, 'updated_at', {`
- Line 48: `defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")`

### backend/migrations/20260725-add-proof-document-to-alumni-profiles.js

- Line 3: `const hasColumn = async (queryInterface, tableName, columnName) => {`
- Line 4: `const columns = await queryInterface.describeTable(tableName);`
- Line 14: `const tableName = "AlumniProfiles";`
- Line 16: `const exists = tables.some((table) => normalizeTableName(table).toLowerCase() === tableName.toLowerCase());`
- Line 23: `if (!(await hasColumn(queryInterface, tableName, "proof_document_path"))) {`
- Line 24: `await queryInterface.addColumn(`
- Line 25: `tableName,`

### backend/migrations/20261009-add-employer-message-file-metadata.js

- Line 6: `if (!table.file_name) await queryInterface.addColumn("EmployerMessages", "file_name", { type: Sequelize.STRING, allowNull: true });`
- Line 7: `if (!table.file_mime) await queryInterface.addColumn("EmployerMessages", "file_mime", { type: Sequelize.STRING, allowNull: true });`

### backend/migrations/20261011-add-message-file-sizes.js

- Line 5: `for (const tableName of ["Messages", "EmployerMessages"]) {`
- Line 6: `const columns = await queryInterface.describeTable(tableName);`
- Line 8: `await queryInterface.addColumn(tableName, "file_size", {`

### backend/migrations/20261012-add-application-archive-flag.js

- Line 7: `await queryInterface.addColumn("Applications", "is_archived", {`

### backend/migrations/20261012-add-job-interview-invitations.js

- Line 3: `const addColumnIfMissing = async (queryInterface, Sequelize, tableName, name, definition) => {`
- Line 4: `const columns = await queryInterface.describeTable(tableName);`
- Line 5: `if (!columns[name]) await queryInterface.addColumn(tableName, name, definition);`
- Line 19: `await addColumnIfMissing(queryInterface, Sequelize, "Jobs", name, definition);`
- Line 22: `await addColumnIfMissing(queryInterface, Sequelize, "email_queue_jobs", "dedupe_key", {`
- Line 28: `await queryInterface.addIndex("email_queue_jobs", ["dedupe_key"], {`
- Line 36: `await queryInterface.changeColumn("Notifications", "message", {`

### backend/migrations/20261013-create-alumni-profile-update-requests.js

- Line 3: `const tableExists = async (queryInterface, tableName) => {`
- Line 5: `return tables.some((table) => String(table).toLowerCase() === tableName.toLowerCase());`
- Line 12: `await queryInterface.createTable("AlumniProfileUpdateRequests", {`
- Line 17: `references: { model: "Users", key: "id" },`
- Line 24: `references: { model: "Users", key: "id" },`
- Line 31: `references: { model: "Notifications", key: "id" },`
- Line 38: `references: { model: "email_queue_jobs", key: "id" },`
- Line 48: `updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP") }`
- Line 51: `await queryInterface.addIndex("AlumniProfileUpdateRequests", ["alumni_user_id", "status"], { name: "alumni_profile_update_requests_user_status_idx" });`
- Line 52: `await queryInterface.addIndex("AlumniProfileUpdateRequests", ["requested_by", "createdAt"], { name: "alumni_profile_update_requests_actor_created_idx" });`
- Line 53: `await queryInterface.addIndex("AlumniProfileUpdateRequests", ["notification_id"], { name: "alumni_profile_update_requests_notification_uq", unique: true });`
- Line 54: `await queryInterface.addIndex("AlumniProfileUpdateRequests", ["email_queue_job_id"], { name: "alumni_profile_update_requests_email_job_uq", unique: true });`

### backend/migrations/20261013-expand-application-document-file-path.js

- Line 8: `return tables.some((table) => String(typeof table === "object" ? table.tableName : table).toLowerCase() === TABLE_NAME.toLowerCase());`
- Line 17: `await queryInterface.changeColumn(TABLE_NAME, COLUMN_NAME, {`

### backend/migrations/20261014-add-job-posting-details.js

- Line 7: `await queryInterface.addColumn("Jobs", "posting_details", { type: Sequelize.JSON, allowNull: true, defaultValue: null });`

### backend/migrations/20261014-create-membership-applications.js

- Line 6: `updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP") }`
- Line 8: `const userReference = Sequelize => ({ type: Sequelize.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" });`
- Line 13: `await qi.addIndex(table, [field], { name, unique: true });`
- Line 20: `await qi.createTable("MembershipApplications", {`
- Line 38: `await qi.addIndex("MembershipApplications", ["application_status", "submitted_at"], { name: "membership_application_status_date_idx" });`
- Line 41: `await qi.createTable("MembershipAdministrators", {`
- Line 44: `granted_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },`
- Line 52: `await qi.sequelize.query("INSERT INTO MembershipAdministrators (user_id, granted_by, grant_reason, created_at, updated_at) SELECT id, NULL, 'Initial verified Employer Admin designated by membership deployment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM Users u WHERE u.role = 'admin' AND u.admin_scope = 'employer' AND u.account_status = 'verified' AND NOT EXISTS (SELECT 1 FROM MembershipAdministrators m WHERE m.user_id = u.id)");`

### backend/migrations/20261014-grant-registrar-membership-access.js

- Line 6: `await queryInterface.sequelize.query("INSERT INTO MembershipAdministrators (user_id, granted_by, grant_reason, created_at, updated_at) SELECT id, NULL, 'Registrar read-only membership review designated by deployment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM Users u WHERE u.role = 'admin' AND u.admin_scope = 'registrar' AND u.account_status = 'verified' AND NOT EXISTS (SELECT 1 FROM MembershipAdministrators m WHERE m.user_id = u.id)");`

### backend/migrations/20261014-transfer-membership-access-to-admin-alumni.js

- Line 8: `await queryInterface.sequelize.query(`
- Line 9: `"UPDATE MembershipAdministrators m JOIN Users u ON u.id = m.user_id SET m.revoked_at = CURRENT_TIMESTAMP, m.updated_at = CURRENT_TIMESTAMP WHERE m.revoked_at IS NULL AND u.role = 'admin' AND u.admin_scope IN ('registrar', 'employer')",`
- Line 12: `await queryInterface.sequelize.query(`
- Line 13: `"INSERT INTO MembershipAdministrators (user_id, granted_by, grant_reason, created_at, updated_at) SELECT id, NULL, 'Admin Alumni read-only membership access designated by feature transfer', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM Users u WHERE u.role = 'admin' AND u.admin_scope = 'alumni' AND u.account_status = 'verified' AND NOT EXISTS (SELECT 1 FROM MembershipAdministrators m WHERE m.user_id = u.id)",`

### backend/migrations/20261016-repair-email-queue-dedupe-key.js

- Line 6: `if (!tables.some(t => (typeof t === 'string' ? t : t.tableName) === table)) throw new Error('The exact lowercase email_queue_jobs table is missing. Check the database connection; no table will be created.');`
- Line 17: `const [result] = await qi.sequelize.query('SELECT COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM 'email_queue_jobs' WHERE 'dedupe_key' IS NOT NULL GROUP BY 'dedupe_key' HAVING COUNT(*) > 1) AS duplicate_keys', { type: Sequelize.QueryTypes.SELECT });`
- Line 28: `if (!before.columnPresent) await qi.addColumn(table, 'dedupe_key', { type: Sequelize.STRING(191), allowNull: true, defaultValue: null });`
- Line 31: `if (!ready.uniqueIndexPresent) await qi.addIndex(table, ['dedupe_key'], { name: indexName, unique: true });`

## Validation and exact changes for this audit

- Latest full `npm.cmd test`: **291 tests, 281 passed, 10 skipped, 0 failed**. Existing notification/SMTP integration cases require an isolated database ending in _test and RUN_DATABASE_INTEGRATION_TESTS=true, so remain skipped; no successful real delivery is inferred from them. Mocked duplicate and retry tests deliberately exercise errors, so their debug error output is expected.
- Latest focused schema/membership/resume continuation tests: **30 passed, 0 failed** (`schemaAudit`, `membershipSchemaAudit`, `membershipSchemaReadPaths`, `resumeSchemaReadPaths`).
- Previous audit result retained for history: 267 tests, 257 passed, 10 skipped, 0 failed; previous focused mapping/audit checks also passed.
- `node --check` passed for **200 backend JavaScript files**, covering models, config, routes, controllers, services, utilities, workers, migrations, scripts and tests. Backend package.json has no build script. No frontend build is required for this backend-only continuation.
- New continuation files: backend/utils/membershipSchemaAudit.js, backend/tests/membershipSchemaAudit.test.js, backend/tests/membershipSchemaReadPaths.test.js, backend/tests/resumeSchemaReadPaths.test.js.
- Updated continuation files: backend/scripts/auditDatabaseSchema.js (membership metadata summary) and backend/docs/production-schema-audit.md (evidence, source/target FK summaries, migration gates, exact changes and checklist). Previously prepared files are listed in the inventory above.
- Existing queue migration and its runner/tests remain the targeted repair for confirmed missing dedupe_key; no duplicate migration was created.
- Latest local read-only audit verified all 46 modeled table/column SELECTs, zero missing tables/columns and all membership read dependencies. Local SequelizeMeta records the job-posting-details migration and the three membership create/grant/transfer migrations. This is local history only; production applied status remains unknown.
- No additional application model, controller, route, UI, worker behavior, production schema, or production records were changed by this continuation.
- Production schema inventory is still pending; completion requires the Render audit output and post-deployment endpoint tests.

## Latest independent live retest (2026-10-16)

- /api/health: HTTP 200 JSON, database connected and auth/registration schemas available.
- /api/jobs: HTTP 500 JSON, Table defaultdb.Jobs does not exist.
- /api/announcements: HTTP 500 JSON, Table defaultdb.Announcements does not exist.
- /api/membership/me without credentials: HTTP 401 JSON, No token provided. The user-reported signed-in migration-not-ready error still requires a verified production schema inventory.

The CLI also lists repository migration filenames against recorded SequelizeMeta entries, explicitly distinguishing unrecorded history from verified schema gaps. This does not authorize replaying unrecorded migrations. Production remains unfixed/unverified in this audit.

## Render execution sequence without Shell

1. Review and commit only the intended backend patch, new files and tests. Do not accidentally bundle unrelated frontend work. Confirm Render service, repository, branch and deployed commit; verify web and separately deployed worker environments privately. Compare DB_HOST, DB_PORT and DB_NAME to the intended production provider/Workbench connection. DB_USER and DB_PASS remain private. NODE_ENV must be production and ENABLE_DB_SYNC must remain disabled.
2. Preserve the existing Render Build Command. With Root Directory set to backend, temporarily append the following read-only command. Substitute the independently reviewed hostname as a literal value; do not substitute the environment variable itself, which would defeat the independent guard.

   ```sh
   && node scripts/auditDatabaseSchema.js --database defaultdb --host EXPECTED_PRODUCTION_HOST
   ```

   From repository root use `node backend/scripts/auditDatabaseSchema.js` instead. A new build executes this command; no Render Shell is needed. Do not change the Start Command to a migration. If database networking/permissions prevent audit from the build environment, stop and use a supported private pre-deploy job or the intended provider's SQL client with the same reviewed target; do not expose a public schema-debug endpoint.
3. Check SCHEMA_AUDIT_IDENTITY commit and database identity, then all SCHEMA_AUDIT_MODEL, SCHEMA_AUDIT_MEMBERSHIP and SCHEMA_AUDIT_MIGRATIONS lines. Confirm intendedTargetVerified=true. That flag confirms the supplied host/name match; it does not independently prove the chosen server is the intended one. Resolve case variants, missing dependencies and ledger differences before approving writes. No production metadata has been collected by this workspace yet.
4. Back up the confirmed production database. Append the queue runner in check-only mode and review its output before enabling any apply:

   ```sh
   && node scripts/applyEmailQueueDedupeMigration.js --database defaultdb --host EXPECTED_PRODUCTION_HOST
   ```

5. Only after target, backup, schema and duplicate preflight review, pause queue writers where practical and run the single approved queue repair (temporary Build Command suffix or supported pre-deploy command):

   ```sh
   && node scripts/applyEmailQueueDedupeMigration.js --apply --database defaultdb --host EXPECTED_PRODUCTION_HOST
   ```

   The runner never creates the queue table, marks an old bundled migration applied, or replays other migrations. The direct runner does not update SequelizeMeta; record its execution in deployment history. The migration is idempotent if subsequently recorded by the normal migration system. Do not use broad `db:migrate`/`sync` to fill unrelated gaps.
6. Remove the apply suffix immediately after a verified run, rerun check-only and metadata commands, deploy the reviewed lowercase mappings to the web service and restart/redeploy all queue workers. Retain the additive schema if rolling back application code; do not remove dedupe keys/indexes. Membership and other new migrations remain gated on exact metadata and separate review.
7. Complete the checklist below, then remove temporary audit build settings and JOB_TABLE_DIAGNOSTICS if enabled. Keep reports in private deployment records. No Firebase/frontend deployment is necessary for these backend schema/mapping changes.

## Post-deployment verification checklist (not completed against production)

- [ ] Identity: web/worker commit IDs match the reviewed deployment; expected database host/port/name independently match the intended provider; all modeled table/column no-row SELECTs resolve. Review type/nullability/PK/index/FK/default differences without automatic changes.
- [ ] Jobs: GET https://djemc-alumni-backend.onrender.com/api/jobs returns expected JSON successfully; no `Jobs` query error. Verify requirements/library and authorized employer/admin listing paths that use joined requirements/profile tables.
- [ ] Announcements: GET /api/announcements returns expected JSON with existing admin/comment associations; authorized admin listing also succeeds; no `Announcements` query error.
- [ ] Membership: signed-in verified alumni GET /api/membership/me returns application/prefill/consent; verify both linked official-record and employment-prefill cases when available. Existing drafts still load. On an approved test account verify draft save and submit; verify intended Admin Alumni access remains authorized and unrelated roles remain denied. Do not bypass readiness if any step still fails.
- [ ] Queue schema: check-only reports columnPresent=true, uniqueIndexPresent=true, duplicateGroups=0. Existing queued and sent records remain present; new schema column is nullable VARCHAR(191).
- [ ] Queue processing: logs show reservation without 1054; approved test notification queues and sends, or retains its key across a controlled retry. Repeat the existing keyed business operation and confirm duplicate prevention. Test multiple NULL/unkeyed emails using approved recipients in an isolated test workflow; never replay real users' notifications simply to test delivery.
- [ ] Resume list: authenticated GET /api/resumes still succeeds with personalInfo and current-user/nonarchived filtering.
- [ ] Resume sections: GET /api/resumes/:id loads all fourteen sections; use approved test data to save/create and update personal information, work experience, education, skills and remaining supported sections, reload and verify persistence. Save Progress must succeed through POST/PUT, preserving other sections.
- [ ] Resume versions/duplicate: for an approved test resume, snapshot then GET /:id/versions; duplicate and reload without altering the original. List success alone does not cover resumeversions or section writes.
- [ ] Resume PDF: GET /:id/pdf returns expected JSON data; POST /:id/pdf returns a valid PDF from the existing renderer. Check resume-backed application snapshots using an approved test application if that workflow is used.
- [ ] Privacy: unauthenticated private APIs remain 401; another user's resume/membership remains unavailable under existing ownership rules. Do not copy tokens, names, IDs, addresses, emails, document data, SQL containing values, or credentials into audit logs/reports.
- [ ] Completion gate: record actual status/content type and sanitized error codes for every affected production request. Health=200, passing mocks, local metadata or a successful build alone do not establish a production fix.
