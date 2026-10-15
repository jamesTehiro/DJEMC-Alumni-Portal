# Resume Builder upgrade

## Workflow

The existing `/resume-builder` now has three steps: Resume Information, Choose Template, and Preview & Download. The existing editor and every supported section remain. New resumes start as local drafts, prefilled from the authenticated profile. Required name and email fields are validated before continuing or saving.

Template selection retains the existing five IDs. The gallery shows actual React-rendered thumbnails. Modern Professional has a section rail, Executive Corporate uses formal serif typography, University Green has a DJEMC green header, Minimal Black & White is monochrome, and Creative Professional has flowing columns.

Save Progress and Save & Generate use POST once for new drafts, and PUT for acknowledged existing IDs. A stable client draft identifier in the existing settings JSON makes a retried creation idempotent. Backend transactions cover parent data and all fourteen section models. After saving, the frontend reloads the owned record and uses that confirmed snapshot for preview, print and PDF. Editing a saved version requires another save. Undo/redo, My Resumes, New Resume and Duplicate remain available.

Unsaved edits are kept in session storage under the account ID. Closing the browser warns about unsaved changes; opening another resume or starting a new one asks before discarding changes. Cache write failures are shown clearly.

## Confirmed fixes

- Creation previously ignored supplied resume sections.
- Updates mapped several form fields to nonexistent model attributes, dropping school names, project names, current flags, certification dates, training/seminar names, organization positions, language names and reference relationships.
- Section replacement lacked a transaction, allowing partial saves.
- Duplication treated one-to-one sections as arrays and could leave an incomplete copy.
- Undo/redo did not update the editor.
- Download PDF previously opened a print dialog with a separate layout that lost fields and selected-template styling.

No database migration is required. The configured MariaDB schema was checked for the parent and every section model; all expected columns exist.

## PDF export

The shared ResumePreviewTemplate, stylesheet and measured pagination helper serve preview, print and export. A4 pages repeat compact continuation headings, preserve section ordering, move entries intact where possible and split oversized text at word boundaries. Empty optional sections are omitted. The preview scales proportionally for smaller screens.

`POST /api/resumes/:id/pdf` verifies ownership and the saved template, then renders the self-contained document to a PDF attachment using the project's existing Puppeteer dependency. JavaScript and external/network/filesystem resource loading are disabled in the renderer; only embedded raster images are permitted. The frontend inlines photos, sending bearer credentials only to the API server origin. Temporary blob photo URLs cannot be persisted. The existing GET PDF data endpoint remains compatible.

The runtime reuses Puppeteer's installed browser or an installed Chrome/Chromium/Edge executable. `PUPPETEER_EXECUTABLE_PATH` can configure a deployed server browser. A deployment must include the existing Puppeteer package, available in either the backend or frontend package directory, and a compatible browser. Missing runtime dependencies produce a useful error.

## Files changed

Frontend:

- `src/pages/ResumeBuilderPage.jsx` and `.css`
- `src/components/resume/ResumeEditor.jsx`
- `src/components/resume/ResumePreview.jsx`
- `src/components/resume/TemplateSelector.jsx` and `.css`
- `src/components/resume/ResumeTemplates.css`
- `src/components/resume/sections/ResumePersonalInfo.jsx`
- `src/components/resume/sections/ResumeOrganizations.jsx`
- `src/components/resume/templates/ResumePreviewTemplate.jsx`
- `src/components/resume/templates/resumeTemplateConfig.js`
- `src/components/resume/templates/resumeTemplateData.js`
- `src/components/resume/templates/paginateResumeDocument.js`
- `src/components/resume/templates/resumeDocumentExport.jsx`
- `src/utils/resumeWorkflow.js`
- `tests/resumeWorkflow.test.js`, `tests/resumeTemplates.test.js`, `tests/resumePagination.test.js`

Backend:

- `controllers/resumeController.js`
- `routes/resumeRoutes.js`
- `services/resumePersistence.js`, `services/resumePdf.js`
- `tests/resumeWorkflow.test.js`
- Resume-photo mock in `tests/security.test.js`
- Database safety guard in `tests/verificationEmailFlow.test.js`
- `scripts/checkResumeWorkflow.js`, `scripts/checkResumeApi.js`, `scripts/checkResumePdf.js`, `scripts/renderResumePdfChecks.ps1`
- This report

## Checks

From `frontend/alumni-portal`:

```text
node --test tests/resume*.test.js tests/portalDrawer.test.js
npm.cmd run build
```

33 tests passed, including 27 resume regressions and 6 existing drawer regressions. Frontend production build passed.

From `backend`:

```text
node --test tests/resumeWorkflow.test.js tests/security.test.js
node scripts/checkResumeWorkflow.js
node scripts/checkResumeApi.js
node scripts/checkResumePdf.js
npm.cmd test
```

- Resume and security regressions: 26 passed.
- Configured MariaDB integration: creation, all sections, retry, update, photo removal, reload, selected template and duplication passed. The transaction was rolled back and the existing resume count remained two.
- Live API: list/detail, authentication, ownership, unsaved-template rejection and PDF download checks.
- All five templates generated actual two-page PDF fixtures. Windows native PDF checks confirmed two A4 pages for each. First pages were rendered and visually inspected.
- Backend suite after its database safety guard: 109 passed; 10 legacy database verification tests skipped.

Browser automation was unavailable because its runtime initialization raised `Cannot redefine property: process`. Full interactive desktop/mobile step navigation, file picking and browser printing still need manual verification. Pagination placement has deterministic DOM regression coverage; real PDFs were checked separately.

## Test-suite incident and recovery

The initial full backend suite ran the existing verificationEmailFlow cleanup against the working database. Its cleanup deletes notifications matching `%verified%` and email-queue subjects matching `%DJEMC%`. The fixture then failed a unique student ID constraint. The cleanup may have affected existing matching records; their original rows cannot be identified from the current database alone.

The suite now skips that file unless a separate database ending in `_test` and `RUN_DATABASE_INTEGRATION_TESTS=true` are configured. MariaDB binary logging is off and no project SQL backup was found. The user confirmed that a backup exists; its path/date is still required to compare and recover affected rows. Do not import an entire backup over the working database. Queue restoration also needs review of delivery states to prevent sending already delivered mail again.
