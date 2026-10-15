# Shared Employer and Admin Employer job posting

## Implementation

Both existing Post Job pages now use the same `JobPostingForm` and shared field/payload validation. The form has organized cards for basic job information, company, role/responsibilities, qualifications, salary/benefits, application instructions, and the existing custom requirements/interview settings. Dynamic responsibilities, skills, required/preferred qualifications and other benefits can be added/removed; selected benefits are never assumed by default.

The existing employment type values are preserved. Company identity is read-only and comes from the account's company profile or trusted Admin Employer name, with no caller-controlled company/employer identity in the creation payload. A blank industry override inherits the current company profile in the advertisement instead of duplicating it in each job. Contact and walk-in information requires an explicit publication choice.

The form previews current state using `JobPostingAdvertisement`; previewing performs no publication request. Back to Editing preserves the values. Publish Job validates the form, requirements and saved interview configuration, then uses the existing authenticated `POST /api/jobs` route. Both parent handlers have a synchronous in-flight ref plus disabled publishing controls to prevent repeated-click submissions. Success/reset/list refresh occurs after the backend returns successfully. No additional job approval process was introduced.

The Admin Employer Post Job form previously lacked the interview configuration required by its existing backend. It now reuses `InterviewDetailsModal` in draft mode, matching the regular Employer page. Existing saved job interview updates and applicant approval/invitations remain in place.

## Persistence and authorization

One nullable JSON-compatible `Jobs.posting_details` column stores work setup, vacancies, company description, responsibilities, qualification groups, salary range/period/display, selected benefits, optional deadline and application instructions. Existing title, description, location, employment type, qualification/course target and expected salary fields remain compatible; expected salary is derived from structured compensation for new postings.

The additive `20261014-add-job-posting-details.js` migration is applied locally. The runner verifies nullable JSON-compatible storage, existing columns and the migration ledger; rerunning it is idempotent. It does not backfill or rewrite old jobs. No sync/alter/drop/recreate operation was used. Other deployments should run from `backend`:

```powershell
npm.cmd run migrate:job-posting
```

MariaDB 10.4 returns JSON as text through the configured mysql2/Sequelize stack. A getter on `Job.posting_details` parses this on reload and serialization while preserving null legacy values. The frontend also accepts legacy null or JSON-string representations safely.

Creation and update recheck the database user: a verified Employer or verified Admin with employer scope. Admin Employer does not need an EmployerProfile verification or a new job approval. Job ownership comes from that database user; spoofed owner/company fields are ignored. Requirements and job/interview values remain transaction-bound. Existing notification creation and email queue behavior are reused.

Public job identity is allowlisted; account email/passwords, employer contact/private profile data and interview details are excluded. Owners and authorized Admin Employer personnel retain protected interview access. Contact information appears in the advertisement only when explicitly published. Update also now persists location and returns the actual saved requirement version when historic versions exist.

## Alumni display

The Alumni Jobs page uses the same advertisement renderer for company/role/responsibilities/qualifications/compensation/benefits/deadline/how-to-apply and actual configured application requirements. Optional empty sections are omitted, and text is rendered safely by React. Search includes the published company name; the existing location/employment filters and Apply workflow are preserved.

View Job remains available even for already-applied jobs. Requirements load for the selected job with cancellation, loading, error and Retry states; Apply is disabled while that load is incomplete or failed. Logos use the published job identity; the page no longer fetches full employer profiles merely to obtain a missing image. Existing JobApplicationModal and application APIs are reused.

## Files changed

Frontend:

- `src/pages/EmployerPage.jsx`
- `src/pages/admin/AdminModerationPage.jsx` (Employer branch; Alumni announcements preserved)
- `src/pages/JobsPage.jsx`
- `src/pages/JobPage.css`
- `src/components/jobs/JobPostingForm.jsx` (new)
- `src/components/jobs/JobPostingAdvertisement.jsx` (new)
- `src/components/jobs/JobPosting.css` (new)
- `src/utils/jobPosting.js` (new)
- `src/utils/jobDisplay.js` (new)
- `tests/jobPosting.test.js` (new)
- `tests/jobDisplay.test.js` (new)

Backend:

- `models/Job.js`
- `controllers/jobController.js`
- `services/jobPosting.js` (new)
- `migrations/20261014-add-job-posting-details.js` (new)
- `scripts/applyJobPostingMigration.js` (new)
- `package.json`
- `tests/jobPosting.test.js` (new)
- `tests/jobPostingMigration.test.js` (new)
- `tests/jobInterviewDetails.test.js` (isolated database-user mock)
- `docs/structured-job-posting.md` (this report)

Test artifact: `tmp/job-posting-baseline.json` contains only table counts and SHA-256 digests used to confirm existing records were preserved. Build output was regenerated by Vite.

## Validation

- All 87 frontend tests passed, including actual JSX rendering, field/payload validation, salary/work-setup/vacancy rules, selected benefits, privacy, legacy advertisements and both parent publish guards.
- Frontend production build passed with 622 modules; the existing empty React chunk warning remains.
- The final broader named backend suites passed 44 tests across structured postings/migrations, the MariaDB JSON getter, interview settings/invitations, applicant status/archive behavior, notification ownership and email-worker recovery.
- 35 live API checks passed and were rerun successfully after the final JSON getter restart: public/alumni old job lists/detail/requirements, employer/Admin Employer own lists and saved interviews, permissions/foreign-job denials, useful errors and invalid publishing requests without writes.
- Existing row counts and raw legacy SHA-256 digests match the captured baseline: Jobs 4, JobRequirements 9, RequirementGroups 0, Applications 5, ApplicationDocuments 8. All four legacy jobs retain null structured details.
- Migration rerun and focused diff/syntax checks passed. Shared components/helpers, AdminModeration and Alumni display/helper targeted lint passed. EmployerPage has 19 pre-existing unrelated messaging/helper/effect lint issues; no unrelated refactor was made.

### Positive MariaDB workflow

An inline rollback-only harness verified both regular Employer and existing Admin Employer publication against the actual database. It first confirmed all 13 touched tables use InnoDB, then confined every fixture write, queued email and asynchronous audit operation to an enclosing transaction that could not commit. Existing Admin Employer was read only; no second administrator was created or its unique role/scope constraint changed.

Both jobs saved/reloaded the structured fields, grouped custom information/optional document requirements, and all saved interview details under the correct owner. Real unread in-app notifications and pending email queue rows targeted only a synthetic alumni fixture. That alumni applied to each job using its actual persisted requirement code; pending status, distinct job/application associations, version 1 grouped snapshot and information responses were verified. Missing information and a duplicate application were rejected. An independent connection could see no fixture users, jobs or emails before rollback, so the worker could not deliver them.

The final rollback left counts and full-row SHA-256 digests unchanged across all 13 checked tables and left the existing Admin Employer row unchanged. No fixtures were committed, deleted for cleanup or emailed. This check identified the real MariaDB JSON-text reload issue; the model getter fix and regression test then passed without weakening the harness assertions. The backend was finally restarted with database sync disabled to load that fix.

Commands: from frontend, `node --test tests/*.test.js`, targeted `npx eslint`, `npm.cmd run build`; from backend, named `node --test` suites covering jobPosting/jobPostingMigration/jobInterviewDetails/jobSpecificApplicants/interviewInvitationWorkflow/notificationInterviewDetails/applicationArchivePermissions/emailQueueWorkerRecovery, syntax checks, and `npm.cmd run migrate:job-posting`. Positive database and live API harnesses ran in memory without adding test fixtures to the saved project data. The full legacy database test suite was not run.

## Limits

Interactive desktop/mobile browser actions remain unverified because the in-app browser runtime was unavailable. Actual React rendering, responsive CSS review, production compilation and API checks were performed. The positive check configured an optional document requirement and submitted actual information responses; it did not upload real files or verify SMTP delivery. Existing upload handlers remain unchanged. The synchronous locks protect repeated clicks; the existing API does not provide durable idempotency for a lost-response network retry, and content-based job deduplication was not introduced.

Some optional helper/test-file patches were rejected by the tool as "patch rejected by user" and were left unapplied. The actual shared JSX tests and existing named regression suites were executed; rejected test cases are not counted as passes.
