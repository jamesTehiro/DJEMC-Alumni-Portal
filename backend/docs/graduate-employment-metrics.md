# Graduate Tracking employment metrics

Updated November 3, 2026. Changes are local; no commit, push, deployment, migration or production data operation was performed by this task.

## Authoritative source

The component titled **Digital Resume Preview** is in `frontend/alumni-portal/src/features/profiles/pages/ProfilePage.jsx`. Its form is initialized from `profile.AlumniProfile.employment_status`. The Alumni Employment Status selector saves that value with authenticated `PUT /api/profile`; authenticated `GET /api/profile` (or `GET /api/profile/:userId` for an authorized viewer) retrieves it.

The persisted field is **`alumniprofiles.employment_status`**, model `AlumniProfile.employment_status`. This preview is the profile's Digital Resume Preview, not the separate Resume Builder tables. Unsaved form changes can appear in the preview while editing; graduate metrics deliberately use only the saved database value.

The account link is `alumniprofiles.user_id = users.id`, and the official record link is `users.alumni_record_id = alumnirecords.id`. Summary counting uses these existing Sequelize associations. No name/email guesses, employment-history inference, company/title inference, or unrelated resume fields are used. Unlinked official records remain part of Total Graduates and do not contribute a reported employment category.

Admin Alumni Records retrieves its cards through **`GET /api/admin/alumni/tracking-summary`**. Newer Alumni details are retrieved through **`GET /api/admin/alumni/users/:userId/tracking`**, which now triggers a fresh summary request. Both endpoints retain existing Alumni Admin authorization.

## Root cause and repair

The existing summary already selected the same persisted column as the preview. The definite synchronization defect was that the frontend requested the summary only during initial page loading. Fetching a newer saved profile updated the profile drawer without refreshing employment cards. The old summary also lacked explicit account/graduate deduplication and recognized a narrower range of status separators.

The backend now normalizes capitalization, whitespace, underscores and common Unicode hyphens for the three recognized categories. Missing, non-string and unknown statuses contribute to none of them. Each linked account and official graduate can contribute once, to one category only. An existing employment-history entry never substitutes for a missing status. The summary response is marked `Cache-Control: no-store`.

After an Alumni tracking detail refresh, and after the existing profile-update-request workflow retrieves details again, the frontend fetches current summary data and replaces only `employed`, `unemployed` and `selfEmployed`. A failed or malformed refresh preserves the previous counts and displays an error in the existing tracking feedback area.

## Total Graduates preserved

The master-list query's model, attributes, left joins and filtering are unchanged. The calculation remains exactly:

```js
totalGraduates: masterRecords.length
```

No official master-list counting, database source, association, schema, total filter, or total card markup was modified. Employment-only refreshes explicitly preserve the previously loaded `totalGraduates`. There is no runtime hardcoded value of 31. Tests use a 31-record master-list fixture, assert the exact original query shape, and verify that 31 remains unchanged through saved employment changes. No claim of an independent live production recount is made.

The card design/layout, table fields, search, course/year filters, pagination, profile permissions and existing profile-update-request action remain unchanged.

## Files changed for this task

| File | Purpose |
| --- | --- |
| `backend/controllers/adminController.js` | Use employment-only normalization/deduplication; add no-store header; keep original total query/calculation |
| `backend/utils/graduateEmploymentMetrics.js` | Pure three-category counting from the saved joined profile field |
| `backend/tests/graduateEmploymentMetrics.test.js` | Saved profile update/read/summary integration, status variants, missing/unknown cases, duplicate prevention, exact unchanged query and 31-record total |
| `backend/tests/graduateTrackingMajor.test.js` | Repair existing fixture for current authentication's account lookup and directory audit lookup; retain role and academic-field checks |
| `frontend/alumni-portal/src/features/alumni-records/pages/AdminUsersPage.jsx` | Refresh only employment cards after fresh tracking data |
| `frontend/alumni-portal/tests/graduateEmploymentMetrics.browser.test.js` | Render actual Digital Resume Preview and tracking cards; test all statuses, missing/unknown values, refreshed saved data, unchanged total and table/search |
| `backend/docs/graduate-employment-metrics.md` | This report |

Other working-tree changes were preserved. The earlier Employer OTP report was separately updated to record its completed 15 passing browser checks; it is not part of this metric implementation.

## Verification

- Backend: **33 passed, 0 failed**. Includes the actual profile update controller -> profile GET -> tracking summary flow, existing profile-update tracking, role restrictions/academic fields, and resume regressions. The first run exposed a stale auth fixture in the existing major test; its DB lookups were mocked consistently with current authentication, without changing runtime authorization.
- Existing Alumni Records/Graduate Tracking browser regressions: **13 passing checks** for table fields, filters, responsive layout, pagination, academic search and profile/update-request workflows.
- New Digital Resume/card browser check: **1 passed, 0 failed** (`tmp/graduate-employment-browser-focused.log`), covering all three saved categories, missing/unknown status, latest detail refresh, preserved total and table/search state. The initial combined run had a test-harness failure; the corrected focused rerun uses the owner's full preview, the dynamic profile route and the page's existing duplicate-init window. Combined with the 13 existing passing checks above, **14 frontend browser checks pass on the final source**.
- Production build: **passed** (`tmp/graduate-employment-build.log`).
- Frontend lint: new test has no errors and the changed page introduces no new findings. The existing `Date.now()` render-purity error is present identically in HEAD and the working copy; it was left untouched as unrelated behavior (`tmp/graduate-employment-lint-comparison.log`).

All database data and browser APIs in these tests were isolated fixtures/mocks. No production account/profile records were read or written, and no email was sent.

From `backend/`:

```powershell
node --test --test-concurrency=2 tests/graduateEmploymentMetrics.test.js tests/alumniProfileTracking.test.js tests/graduateTrackingMajor.test.js tests/resumeWorkflow.test.js tests/resumeSchemaReadPaths.test.js
```

From `frontend/alumni-portal/`:

```powershell
$env:PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test --test-concurrency=1 tests/graduateEmploymentMetrics.browser.test.js tests/graduateTrackingMajor.browser.test.js tests/alumniRecordsTable.browser.test.js
node node_modules/eslint/bin/eslint.js src/features/alumni-records/pages/AdminUsersPage.jsx tests/graduateEmploymentMetrics.browser.test.js
node node_modules/vite/bin/vite.js build --mode production
```

The lint command reports the existing page error noted above. Test invocations in this session set dummy DB connection variables to a non-service port. Detailed logs are `tmp/graduate-employment-backend-final.log`, `tmp/graduate-employment-browser.log`, `tmp/graduate-employment-browser-focused.log`, `tmp/graduate-employment-lint.log`, `tmp/graduate-employment-lint-comparison.log` and `tmp/graduate-employment-build.log`.
