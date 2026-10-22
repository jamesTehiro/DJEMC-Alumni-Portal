# Alumni registration uploads

## Existing behavior found and preserved

- Employer registration actually allows **one to five** business permits, not six. Both employer pages, `BusinessPermitInput`, its validator, the controller and Multer enforce five. None of those employer rules were changed.
- Employer files are PNG, JPG, JPEG or PDF. The frontend checks extension/MIME agreement, nonempty files and the configured per-file limit (`VITE_MAX_UPLOAD_MB`, then `VITE_MAX_ATTACHMENT_MB`, default 10 MB). The backend uses `MAX_UPLOAD_MB`, default 10 MB, verifies extension/MIME agreement and checks file signatures.
- Employer selection appends batches, rejects an invalid batch without discarding prior selections, lists filenames and supports removal. Permits use the existing local business-permit storage and metadata/primary-path association.
- The routed alumni form is `AlumniRegisterPage.jsx`; `RegisterPage.jsx` is a separate legacy form. The routed form previously accepted one optional proof and sent it under `proof_document`; the legacy form had no attachment control and sent JSON.
- Alumni's frontend already accepted PDF, DOC, DOCX, PNG, JPG, JPEG and WEBP. These formats remain available. The backend's existing additional GIF support also remains unchanged.
- Both alumni forms allow registration without attachments. No required field, academic-program/year rule, password rule, consent component or consent handler was removed or relaxed.
- Gmail OTP verification, authorizations, rate limits, pending-account status, registration transactions, API routes, upload field names, legacy `proof_document_path`, model relationships and storage locations remain in place.
- The existing signature validation, file-size enforcement, failed-registration cleanup, authenticated storage and Registrar-only proof authorization remain in use.

## Added behavior

- Both alumni forms accept up to six proofs. The counter displays `0/6` through `6/6`.
- Selection accumulates across batches; an invalid or excessive batch is rejected in full and leaves previous selections intact.
- Every selected filename is displayed with a Remove button. A removed document can be selected again, including the same filename.
- The input is reset after selection so repeated selection and replacement work. Files remain in React state through consent/OTP interactions and server validation errors.
- The frontend reuses the employer size configuration and error/list styling, with extension/MIME, empty-file and size checks for the preserved alumni formats.
- Every accepted file is appended under the existing `proof_document` multipart field. The legacy form still sends its original JSON fields when no attachments are selected.
- The real registration middleware and the exported alumni parser independently cap `proof_document` at six. The controller also rejects seven when called without middleware.
- The first proof still occupies `proof_document_path`. A nullable `proof_documents` TEXT column stores names, MIME types, sizes and storage references for the whole list on the same alumni profile, inside the existing registration transaction.
- Metadata is excluded from ordinary profile queries. Registrar responses expose secure document URLs, and additional files require an exact reference match plus the existing Registrar admin scope.
- The existing Registrar proof modal can switch among all submitted files using the existing viewer; old single-document records still work.

## Files changed

Paths below are relative to the repository root.

| File | Purpose |
| --- | --- |
| `frontend/alumni-portal/src/pages/RegisterPage.jsx` | Add optional document state/control and conditional multipart submission while retaining original registration fields and JSON submission without files. |
| `frontend/alumni-portal/src/pages/AlumniRegisterPage.jsx` | Extend the existing first-proof field with additional proofs and append them to the existing OTP-authorized submission. |
| `frontend/alumni-portal/src/components/AlumniDocumentInput.jsx` | Add cumulative selection, file counter, filenames, removal/replacement and inline errors using existing upload conventions. |
| `frontend/alumni-portal/src/utils/alumniDocuments.js` | Validate six optional proofs using existing size configuration and preserved alumni formats. |
| `backend/middleware/uploadMiddleware.js` | Raise only the proof field limit to six, add its count error, and reuse existing content validation/cleanup for the alumni parser. |
| `backend/controllers/authController.js` | Add a defensive count check and persist all proof metadata while preserving the first-proof path and transaction. |
| `backend/models/AlumniProfile.js` | Define nullable metadata and exclude it from ordinary queries. |
| `backend/services/alumniProofDocuments.js` | Build metadata and read both new document lists and legacy single-proof records. |
| `backend/migrations/20261022-add-alumni-proof-documents.js` | Prepare an idempotent additive migration; preserve existing rows and refuse destructive rollback. |
| `backend/controllers/fileController.js` | Authorize additional proofs by exact stored reference while preserving Registrar-only access. |
| `backend/controllers/registrarController.js` | Return all submitted proofs as secure URLs with display metadata. |
| `frontend/alumni-portal/src/pages/RegistrarVerificationQueuePage.jsx` | Add document switching inside the existing proof modal. |
| `backend/tests/alumniRegistrationUploads.test.js` | Test real multipart parsing, persistence via stubbed models, optional uploads, six/seven files, preserved formats, invalid/empty/oversized files, cleanup, private access, controller enforcement and migration behavior. |
| `frontend/alumni-portal/tests/alumniDocuments.test.js` | Test optional counts, all preserved frontend types, MIME mismatches and size boundaries. |
| `frontend/alumni-portal/tests/alumniDocuments.browser.test.js` | Test both alumni forms, cumulative selections, seven-file rejection, removal/replacement, errors, exact submitted bytes, consent and attachment-free submission. |
| `frontend/alumni-portal/tests/alumniProofReview.browser.test.js` | Test all six files in the Registrar viewer and legacy single-proof preview. |
| `frontend/alumni-portal/tests/registrationValidation.browser.test.js` | Read selected alumni filenames from the state-backed list, preserving existing validation and retention assertions. |
| `frontend/alumni-portal/tests/registrationOtpUi.test.mjs` | Preserve its upload-retention assertion against the selected-file list after the native picker is reset. |
| `backend/docs/alumni-registration-uploads.md` | Record inspected rules, implementation, verification and the unapplied migration. |

Existing unrelated working-tree changes were left in place. No employer page, employer upload component/validator, privacy modal, route name, existing database column or relationship was renamed or replaced.

## Verification

All browser tests use local fixture servers and mocked API/storage responses. The new backend upload tests stub model operations and Cloudinary; they make no live registration or storage writes.

| Check | Result | Log |
| --- | --- | --- |
| Backend registration/OTP, employer permits, proof previews, privacy and model mappings (11 test files) | 55 passed, 1 intentionally skipped | `tmp/alumni-upload-backend-final.log` |
| Updated backend upload tests, including independent controller enforcement and all existing backend formats | 3 passed | `tmp/alumni-upload-backend-additional.log` |
| Frontend upload, employer, registration validation, preview and API unit tests | 15 passed | `tmp/alumni-upload-frontend-unit.log` |
| Both alumni forms, employer registration and desktop/mobile registration validation browser tests | 7 passed | `tmp/alumni-upload-browser-final.log` |
| Academic workflow, protected preview and desktop/mobile/expired OTP browser regressions | 10 passed | `tmp/alumni-upload-ui-final.log` |
| Multi-proof and legacy single-proof Registrar browser test | 1 passed | `tmp/alumni-upload-proof-review.log` |
| ESLint on all new frontend source/tests | Passed | `tmp/alumni-upload-lint-final.log` |
| `npm.cmd run build` | Passed, exit 0; existing empty `react` chunk warning | `tmp/alumni-upload-build-final.log`, `tmp/alumni-upload-build-warnings.log` |
| `git diff --check` | Passed | Terminal output |

The updated upload tests overlap with two tests in the 11-file backend run; these rows are separate executions, not additive unique test totals.

Sandboxed browser launches timed out, and Puppeteer's configured Chrome binary was unavailable. Final browser checks used installed Chrome with pipes outside the sandbox. The runtime helper is `tmp/alumni-upload-browser-runtime.mjs`; for example, from `frontend/alumni-portal`:

```powershell
node --import ../../tmp/alumni-upload-browser-runtime.mjs --test --test-concurrency=1 tests/alumniDocuments.browser.test.js tests/businessPermits.browser.test.js tests/registrationValidation.browser.test.js
```

Two additional existing test failures were reproduced against unchanged HEAD implementations using a read-only module-loader baseline, without reverting workspace files:

- `backend/tests/secureFiles.test.js`: its multipart registration fixture omits the already-required academic program and receives `400 Program is required` instead of `201`. Other subtests continued to run. See `tmp/alumni-upload-baseline-secure-files.log`.
- `backend/tests/security.test.js`: `forgot password ignores admin role and returns a generic response` calls the error path unexpectedly. See `tmp/alumni-upload-baseline-security.log`.

Neither failure was fixed or bypassed by changing application behavior or weakening tests. The opt-in MySQL permit-metadata integration test remains skipped; no live database integration was attempted.

## Remaining setup

The new nullable metadata column requires review and application of `20261022-add-alumni-proof-documents.js` before deploying or using this version against an existing database. The migration is prepared only: no migration was executed, no production database was modified, and no commit, push or deployment was performed.

The employer's actual five-file maximum remains unchanged, as required by the preservation constraint. Alumni now have the explicitly requested six-file maximum.
