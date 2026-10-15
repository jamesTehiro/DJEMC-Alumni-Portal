# Membership modal and Registrar management update

**Historical implementation report:** Staff access described below has been superseded by [the Admin Alumni transfer](membership-admin-alumni-transfer.md). The current management page belongs exclusively to authorized Admin Alumni; Registrar and Admin Employer management access is disabled. The alumni modal and shared document workflow remain in place.

## Alumni workflow

The existing six-section membership form now opens in a centered, scrollable modal over the current alumni page. The section navigation, Next/Back, repeatable entries, draft saving, review and consent are reused. Closing with unsaved edits requires confirmation; closing during a save is prevented. Mobile uses the available full screen height. The old `/membership-application` URL redirects to the dashboard and opens this modal, preserving existing bookmarks.

The alumni sidebar entry is shown only for a backend-confirmed eligible alumni account with no submitted application. It disappears after the server acknowledges submission and stays absent after refresh. A response-generation guard prevents an older status request from bringing the entry back. Closing the invitation or form never marks it submitted. Alumni can proceed to the existing Profile page; they are not redirected to an administrative list. Their submitted data becomes available in that list through the same membership API.

## Staff management

The shared management page is available at:

- `/admin/registrar/membership-applications`
- `/admin/employer/membership-applications` (existing authorized Admin Employer access retained)

The page preserves AdminShell, school navbar/logos, fixed role-specific sidebar, active links and the profile corner. It adds four database-backed summary cards, a compact striped/hover table, independent table scrolling, name/email search, status/year/Manila submission-date filters, Clear Filters, pagination, rows per page, and loading/empty/error/retry states.

Columns are exactly `#`, `Name`, `Email`, `Graduation Year`, `Date Submitted`, `Status`, `Actions`. `#` is the visible position across pagination. No Application Number column is present. Newest submissions are ordered first, with database ID as an internal tie-breaker only.

View opens a panel on the right on desktop, or a full-screen modal on smaller screens. Application Form displays the existing read-only official document; Application Details displays saved name, email, academic program, year, date and status. Reviewer/date appear only if actually recorded. No review information is fabricated. Download (PDF), Print and Close stay accessible beneath the preview. Closing/changing a preview invalidates pending requests so results cannot attach to a different applicant.

## Backend reuse and permissions

No duplicate membership tables, submission system, document renderer or PDF endpoint were introduced. Existing `/api/membership` routes are reused:

- `GET /access`: includes `can_view` and `can_approve: false` alongside the existing `can_manage` compatibility field.
- `GET /admin`: supports `search`, `status`, `graduation_year`, `submitted_date`, `page`, `page_size`; returns minimal name/email/academic/date/status summaries plus real aggregate counts and year options.
- `GET /admin/:id`, `/admin/:id/document`, `/admin/:id/pdf`: same saved application and protected exports.
- Own alumni draft/submission/profile APIs remain in place.

The new `20261014-grant-registrar-membership-access.js` migration grants the existing verified Registrar read-only membership viewing through the existing explicit grant table. It has been applied with `node scripts/applyMembershipMigration.js`. The migration creates no new application rows and modifies no user, academic, verification or association approval records. Future accounts still need an explicit grant. All endpoints recheck current database role, verification, and active grant; ordinary employers, ungranted administrators and other alumni cannot access staff records. No approval or edit endpoint was added.

Existing `submitted` records display as **Pending Review**. Approved and For Correction counts/filtering read actual stored values if present; this update does not create such statuses or an approval process. Drafts are excluded from the management list and summary cards. Summary cards cover all submitted applications, while filters affect the table. TIN, religion, blood type, birth date and other full-form details are excluded from list queries and remain available only in authorized document/detail views.

Real MariaDB testing uncovered Sequelize v6 escaping the JSON path `$.email` as `$$.email` when used as a plain `fn` string argument. The query now uses a fixed SQL literal for that constant path; user search values remain escaped by Sequelize. This fixes both list email display and email search without rewriting saved applications. A query-generator regression and real database email search verify the correction.

## PDF and print

Preview, printing and PDF export share `services/membershipDocument.js`. It renders all six official sections and the stored declaration, with blank official signature/BOT/committee approval fields. Print writes only that document into an isolated popup and waits for fonts; no dashboard/sidebar/navbar/buttons are included. PDF uses the existing Puppeteer renderer, with JavaScript disabled and external requests blocked, on A4 portrait pages. Download rejects JSON/HTML/error responses and validates the PDF signature.

## Files

Modified frontend: `src/App.jsx`, `components/AdminShell.jsx`, `components/DashboardLayout.jsx`, `components/membership/MembershipOnboarding.jsx`, `pages/MembershipApplicationPage.jsx`, `pages/admin/AdminMembershipApplicationsPage.jsx`, `utils/membershipDocument.js`.

Created frontend: `context/MembershipFlowContext.jsx`, `context/membershipFlow.js`, `components/membership/MembershipApplicationModal.jsx/.css`, `components/membership/MembershipApplicationPreviewPanel.jsx`, `pages/admin/MembershipManagement.css`, `utils/membershipManagement.js`, `tests/membershipManagement.test.js`. Updated the membership PDF/date tests.

Modified backend: `controllers/membershipController.js`, `scripts/applyMembershipMigration.js`, `scripts/checkMembershipWorkflow.js`, `scripts/checkMembershipApi.js`, `tests/membershipWorkflow.test.js`.

Created backend: `services/membershipListing.js`, `migrations/20261014-grant-registrar-membership-access.js`, `tests/membershipListing.test.js`, and this report.

## Verification and limits

Final results: **63 frontend tests passed**, **67 focused backend tests passed**, **18 live HTTP checks passed**, and the frontend build passed. The genuine MariaDB workflow/combined-filter check and both native A4 PDF checks passed. Targeted membership component lint passed with no errors or warnings.

- Frontend build passed with 617 modules; the existing empty React chunk warning remains.
- Membership frontend regression tests cover navigation visibility, modal route compatibility, exact table columns, pagination numbers, combined filter encoding, response validation, consent/data preservation, PDF error handling and Manila dates.
- Backend tests cover current-role/grant authorization, immutable submissions, retry/transaction behavior, minimal list responses, JSON SQL path escaping, status/year/date filters, real count mapping and existing profile/auth/privacy behavior.
- The MariaDB workflow check validates saved email, combined email/status/year/date search, Registrar detail access without approval permission, draft/submission/retries, sections and profile completion. All test fixtures are rolled back, with unchanged counts and grants verified in `finally`.
- Live HTTP checks verify Registrar/Admin Employer access and alumni/ordinary Employer/pending-account denial, useful invalid-ID/filter errors and unchanged application counts.
- Actual PDF generation and native Windows PDF loading/rendering passed: a standard complete form is 2 A4 pages; the long fixture is 7 A4 pages. Existing section/escaping/consent/blank approval tests pass.
- Targeted membership component lint and focused diff checks are included. App.jsx has an unrelated pre-existing public-page `setState`-in-effect lint error; this update does not refactor the landing-page behavior.
- Interactive desktop/mobile browser behavior and the physical print dialog remain unverified because browser tooling fails with `Cannot redefine property: process`. Responsive layout and request guards were reviewed, and actual generated PDFs were verified. The official form uses the supplied transcription; no replacement photographic form was fabricated.
