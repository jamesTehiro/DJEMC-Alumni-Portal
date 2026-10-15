# Alumni membership application workflow

The 14 October 2026 revision replaces the standalone alumni form with a floating modal and adds authorized Registrar read-only management. See `membership-management-ui.md` for the current routes, permission migration, UI, file list and verification. The sections below document the initial implementation.

## Implementation

Verified alumni receive a dismissible invitation on `/dashboard` or `/alumni`. The invitation checks `GET /api/membership/me`; closing it never records completion. The sidebar's **Membership Application** link opens `/membership-application` later.

The form preserves Sections I–VI and the official declaration provided in the user's transcription. It supports editable profile prefill, calculated age, six educational levels, repeatable work/training/community/award rows, explicit “none” choices, section navigation, database draft saving, review, and unchecked consent. First name, last name, email, and contact number are required; TIN, religion, date of birth, and other nonessential details are optional. No membership data is placed in localStorage or the public directory.

Submission locks the authenticated user's database row, validates their current alumni role and verified account status, and writes one application plus its submission audit in a managed transaction. A unique alumni user index provides a second duplicate safeguard. Retries return the existing submitted application. Submitted records and original consent text/version/time remain immutable. Submission records `submitted`; it does not approve association membership.

The existing Profile page receives the handoff at `/profile?membership=1`. Empty compatible name/phone/address/job title fields may be prefilled. Replacing existing values requires an explicit review and Apply action. Academic records, registered email, photo, visibility, and employment history are excluded from this import. **Save Profile** uses the existing `PUT /api/profile` endpoint. Alumni profile data, employment history, and the requested membership `profile_completed_at` update commit together. Validation/storage failures leave completion unset. After success, a modal offers **Continue to Dashboard**. Submitted but incomplete users receive a dashboard continuation option instead of another invitation.

Authorized Admin Employer users have a separate **Membership Applications** sidebar entry at `/admin/employer/membership-applications`. Its newest-first list exposes only applicant name, program, graduation year, submission date, status, and ID; it supports search, pagination, loading, empty, error, and retry states. View retrieves the saved application and escaped server-generated document. Preview, Print Application, and Download PDF use the same read-only form. Committee signature, BOT resolution/meeting, Checked, Verified, Attested, and Approved fields remain blank.

## Models and migration

- `MembershipApplication` / `MembershipApplications`: one row per alumni; six JSON sections, optional-section flags, applicant/academic snapshots, draft/submitted status, consent acceptance/text/version/time, submission time, profile completion time, creation/update timestamps.
- `MembershipAdministrator` / `MembershipAdministrators`: explicit user grant, reason, optional grantor, and revocation time.
- `20261014-create-membership-applications.js`: creates only these new tables and their indexes. It grants the existing verified employer-scope administrator the requested membership-management permission. Future accounts receive no automatic grant. Existing users and Registrar records are preserved. Destructive rollback is disabled.

Applied and verified against local `djemc_alumni_db`, MariaDB 10.4.32. The migration ledger includes this migration. Re-running its runner successfully verified the same tables and constraints without duplicating them.

For another deployment, from `backend`:

```powershell
npm.cmd run migrate:membership
# Restart the normal backend with ENABLE_DB_SYNC=false.
```

No additional manual database step is needed in the current workspace. Permission grants must be explicitly reviewed for future membership administrators. A grant alone never authorizes ordinary employers or other administrator scopes.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/membership/me` | Own application, profile/official prefill, completion, consent version |
| PUT | `/api/membership/me/draft` | Save own unfinished application |
| POST | `/api/membership/me/submit` | Validate, consent, submit; retry safely |
| GET | `/api/membership/me/document` | Own submitted read-only document |
| GET | `/api/membership/me/pdf` | Own submitted A4 PDF |
| GET | `/api/membership/access` | Database-checked management permission |
| GET | `/api/membership/admin` | Authorized submitted summaries; search/page/page_size |
| GET | `/api/membership/admin/:id` | Authorized submitted detail |
| GET | `/api/membership/admin/:id/document` | Authorized saved form HTML |
| GET | `/api/membership/admin/:id/pdf` | Authorized actual PDF |
| PUT | `/api/profile` | Existing profile save, with optional membership completion flag |

All membership routes use existing JWT middleware and recheck the account in the database. Alumni can never select another account's application. Administration additionally requires a verified employer-scope admin and a non-revoked grant. Responses have `private, no-store` caching. SQL errors return sanitized messages, and audits record IDs/action/consent version rather than sensitive submitted values. Saved official academic fields are derived from the linked Registrar record and copied into the application snapshot; the official record is never updated. Rendered user values are escaped; preview is sandboxed; the existing PDF renderer disables JavaScript and external resource requests.

## Files changed

Existing frontend files: `src/App.jsx`, `components/AdminShell.jsx`, `components/DashboardLayout.jsx`, `pages/Alumnipage.jsx`, `pages/ProfilePage.jsx`, `services/api.js` (preserves HTTP status/field on errors).

New frontend files:

- `pages/MembershipApplicationPage.jsx`, `pages/MembershipApplicationPage.css`
- `pages/admin/AdminMembershipApplicationsPage.jsx`, `.css`
- `components/membership/MembershipOnboarding.jsx`
- `components/membership/MembershipReview.jsx`, `.css`
- `utils/membershipApplication.js`, `membershipProfile.js`, `membershipDocument.js`
- `tests/membershipApplication.test.js`, `membershipProfile.test.js`, `membershipDocument.test.js`

Existing backend files: `models/index.js`, `server.js` (membership mount), `controllers/profileController.js` (atomic alumni save), `package.json` (migration command).

New backend files:

- `models/MembershipApplication.js`, `models/MembershipAdministrator.js`
- `migrations/20261014-create-membership-applications.js`
- `controllers/membershipController.js`, `routes/membershipRoutes.js`
- `services/membershipValidation.js`, `membershipDocument.js`, `alumniProfileSave.js`
- `scripts/applyMembershipMigration.js`, `inspectMembershipSchema.js`, `checkMembershipWorkflow.js`, `checkMembershipApi.js`, `checkMembershipPdf.js`, `renderMembershipPdfChecks.ps1`
- `tests/membershipWorkflow.test.js`, `membershipMigration.test.js`, `membershipRollbackRunner.test.js`, `membershipDocument.test.js`, `membershipProfileSave.test.js`
- This report.

## Verification

- Frontend `npm.cmd run build`: passed, 611 modules, with the existing empty React chunk warning.
- Frontend `node --test tests/*.test.js`: 55 passed, 0 failed (including 22 membership form/prefill/PDF tests and existing resume/drawer tests).
- Backend focused membership, profile tracking, profile privacy, and security tests: 68 passed, 0 failed.
- Targeted ESLint across the new pages, integration components, profile page, helpers, and review component: passed.
- `node scripts/checkMembershipWorkflow.js`: genuine MariaDB draft/all-sections/options/consent/submission/retry/reload/authorization/admin pagination/document/profile failure+success+completion passed. Every fixture write used an enclosing rollback transaction. It verifies unchanged counts for users, official records, profiles, histories, audits, applications, and grants, and verifies test user/application IDs no longer exist. Existing administrator grants remain read-only.
- `node scripts/checkMembershipApi.js`: 15 live HTTP checks passed, including unauthenticated 401; alumni/Admin Employer success; ordinary Employer, Registrar, and pending-alumni 403; invalid IDs 400; missing record 404; invalid submit/draft 400. Application count remained unchanged.
- Actual shared PDF rendering: standard complete application produced 2 A4 pages; an overflow fixture produced 7 A4 pages. Native Windows PDF loading, A4 dimensions, and page rendering passed; representative first, second, middle overflow, and final pages were visually inspected.
- Repeated migration runner: already applied and verified.
- Focused `git diff --check`: passed (Windows line-ending warnings only).

## Remaining verification limits

Interactive desktop/mobile browser tests and the physical print dialog could not be exercised: the browser connection fails with `Cannot redefine property: process`. Responsive CSS and request/state guards were reviewed, and real PDF pagination was verified, but this is not a claim that every browser interaction was tested. The document uses the official text transcription; exact photographic positioning cannot be matched without the two original form images. No existing membership applications were fabricated or committed for testing.
