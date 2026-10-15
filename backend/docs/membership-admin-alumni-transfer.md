# Membership Applications transfer to Admin Alumni

## Changes

The existing management page now belongs to Admin Alumni at `/admin/alumni/membership-applications`. Its sidebar entry is beside Alumni Records, with a clipboard icon. The breadcrumb is Home → Admin Alumni → Membership Applications. The Admin profile corner, fixed sidebar and school navbar remain intact.

The former `/admin/registrar/membership-applications` and `/admin/employer/membership-applications` URLs redirect to the new, guarded route. A Registrar or Admin Employer account cannot pass that guard. Their sidebars have no membership management entry.

The same page, list, filters, summary cards, pagination, visible row numbering and two-tab preview panel are reused. No Application Number column was added. The backend API URLs and document/PDF renderer were preserved.

## Authorization and deployment

All staff operations under `/api/membership/admin` now recheck the database account for `role=admin`, `admin_scope=alumni`, `account_status=verified`, and an active MembershipAdministrator grant. JWT role/scope claims alone cannot grant access. Registrar, Admin Employer, Employer and regular Alumni receive 403 from list, detail, document and PDF endpoints. Unauthenticated requests receive 401. Access responses expose only capability flags and the account scope; no application data.

The existing request logger was also logging private name/email searches in membership query strings. Logging now omits query strings for membership routes only, retaining route, method, status and duration. Unrelated route logging is unchanged. Regression tests cover both behaviors.

The additive migration `20261014-transfer-membership-access-to-admin-alumni.js` revokes the former Registrar and Admin Employer grants by timestamp, retaining their history, and creates an explicit read-only grant for existing verified Admin Alumni accounts without an existing grant. Previously revoked Alumni grants remain revoked; future accounts do not receive automatic grants. These permission updates run in one transaction. Reapplying the migration cannot duplicate grants or rewrite original revocations. No association approval/edit capability was added.

Run from `backend` on another deployment:

```powershell
npm.cmd run migrate:membership
```

The runner checks the existing schema and unique indexes and uses SequelizeMeta to apply only missing migrations. Historical migrations remain unchanged. Restart the backend after deploying the controller change. Database sync/alter is not required.

## Preserved workflow and data

Regular verified Alumni retain their owner-scoped `/api/membership/me` draft, submit, document and PDF access. Their floating six-section form, invitation, consent, duplicate-safe submission, profile navigation and profile completion behavior are unchanged. Submitted applications remain immutable and are not automatically approved.

Admin Alumni can list actual submitted data, search name/email, combine status/year/submission-date filters, paginate, and open the selected saved application. List summaries exclude sensitive full-form fields. Authorized View/Print uses the same read-only server document containing all six official sections and the consent statement; PDF uses the existing A4 renderer. No public document URL or replacement membership system was introduced.

This migration modifies only membership permission records and the migration ledger. It does not modify applications, IDs, statuses, submitted form data, AlumniProfile or AlumniRecord tables. The configured local database had zero membership applications before transfer; its application-table digest is checked again after validation. Rollback-only fixtures provide the nonempty submission/list/document/PDF checks without retaining synthetic records.

## Files changed for this transfer

Frontend:

- `src/App.jsx`
- `src/components/AdminShell.jsx`
- `src/pages/admin/AdminMembershipApplicationsPage.jsx`
- `src/pages/admin/MembershipManagement.css`
- `src/utils/membershipManagement.js`
- `tests/membershipManagement.test.js`

Backend:

- `controllers/membershipController.js`
- `middleware/requestLogger.js`
- `migrations/20261014-transfer-membership-access-to-admin-alumni.js` (new)
- `scripts/applyMembershipMigration.js`
- `scripts/checkMembershipApi.js`
- `scripts/checkMembershipWorkflow.js`
- `tests/membershipWorkflow.test.js`
- `tests/membershipAccessTransfer.test.js` (new)
- `tests/membershipRequestPrivacy.test.js` (new)
- `docs/membership-management-ui.md` (marked as historical)
- `docs/membership-admin-alumni-transfer.md` (this report)

## Verification

Frontend: 66 tests passed, targeted shell/page/helper/test ESLint passed, and the production build passed (617 modules). The existing empty React chunk warning remains.

Backend: 75 focused tests passed, including former-scope rejection despite old active grants/forged JWT scope, revoked-grant denial, transfer idempotency/rollback, private-query log redaction, immutable owner submissions, safe list filtering, official document layout, and profile/auth/privacy regressions.

Live API: 38 HTTP checks passed against the restarted backend, including Admin Alumni access, combined search/status/year query handling, 403 for each other role's list/detail/document/PDF requests, 401 for unauthenticated requests, and 400/404 validation/empty-record responses. Live server logs were checked separately to confirm membership search/filter values were omitted.

The genuine MariaDB workflow passed: save a six-section alumni draft, submit once, safely repeat submission, reopen it, find it in Admin Alumni, combine uppercase-email/status/year/Manila-date filters, paginate, view the same saved application, export real owner/admin PDFs, and save/complete the existing alumni profile. Registrar and Admin Employer document/list/export requests were denied. All fixtures stayed inside one transaction and were rolled back; checked application/user/academic/profile/history/audit/grant counts and the original Admin Alumni grant were verified unchanged in `finally`.

The first restricted PDF workflow run timed out launching Chrome, fully rolled back, and was rerun outside the sandbox successfully. The shared renderer needed no change. The standalone real-PDF check passed: standard form 2 pages and overflow form 7 pages. Native Windows PDF inspection confirmed A4 dimensions for every page and rendered all pages. Its existing script required a process-only execution-policy bypass; no system-wide policy was changed.

The transfer was applied locally using `npm.cmd run migrate:membership`; a second run confirmed the ledger prevented reapplication. The final application count and SHA-256 digest matched the pre-transfer baseline. Existing former-role grant rows were retained with revocation timestamps, and Admin Alumni was the only active management scope. The backend was restarted with database sync disabled.

Commands used from `backend`: the focused named `node --test` suites, `node scripts/checkMembershipApi.js`, `node scripts/checkMembershipWorkflow.js`, `node scripts/checkMembershipPdf.js`, `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\renderMembershipPdfChecks.ps1`, and `npm.cmd run migrate:membership`. Frontend commands were `node --test tests/*.test.js`, targeted `npx eslint`, and `npm.cmd run build`. Focused diff and syntax checks passed. No full legacy database test suite was executed.

Interactive desktop/mobile browser operations and the physical print dialog remain unverified: the in-app browser runtime previously failed with `Cannot redefine property: process`. The preview/print/download components and renderer were not changed by this relocation.
