# Employer registration permit documents

The connected development database had only
`employerprofiles.business_permit_path VARCHAR(255)`. Two of its five non-empty
permit references were Cloudinary references truncated at 255 characters. The
admin serializer discarded references it could not turn into a secure-file URL,
so the verification modal incorrectly reported that no permit was uploaded.
Registration, upload middleware, and the modal also supported only one file.

Registration now accepts one through five PNG, JPG/JPEG, or PDF files using the
existing `business_permit` multipart field and existing storage engine. Each file
retains its reference, original filename, MIME type, and byte size in
`business_permit_documents` (a JSON array in a nullable TEXT column). The existing
`business_permit_path` remains the first/original reference for compatibility.
All metadata is saved in the existing registration transaction and reloaded to
verify persistence before a successful registration response.

The Business Permit Documents section in Employer Registration Details displays
each submitted filename and type, with View and Download actions. It reuses
`BusinessPermitPreview` for images/PDFs and authenticated blob fetching. The
replacement-upload section has been removed. The legacy upload endpoint remains
available and now appends documents within the five-file limit, preserving the
original reference and verification status.

Document URLs contain employer/document identifiers rather than storage paths:

```
GET /api/admin/employer/users/:userId/business-permits/:documentId
GET /api/admin/employer/users/:userId/business-permits/:documentId?download=1
```

The existing JWT, admin-role, and Employer scope guards protect these routes. The
controller also validates the role/scope, employer identity, and document ID.
`original` supports legacy registrations. Responses use private/no-store caching,
safe UTF-8 filenames, and nosniff headers. Local paths pass the shared containment
and symlink checks. Raw references are excluded from ordinary profile queries and
are replaced with protected document URLs in the admin response.

Legacy records are read without rewriting their references. When a truncated
Cloudinary reference retains a complete asset identity, the existing provider
recovery service verifies the asset through a read-only Cloudinary resource API
request and uses its actual delivery URL. No asset is recreated. Missing or
unrecoverable assets return 404; provider failures return a temporary storage
error. If an old original filename was lost, the stored asset filename is used.
This recovery consumes Cloudinary Admin API quota for each legacy lookup.

## Deployment

The backend's standard Render start command is `npm start` (`node server.js`).
Startup applies `20261018-add-employer-permit-documents.js`
before schema readiness checks and before the HTTP server accepts requests. This
reuses the earlier reference-width migration to widen `business_permit_path` to
TEXT and adds `business_permit_documents TEXT NULL`. It does not update or
delete existing rows, references, or verification flags. Rerunning is safe; a
rollback deliberately retains the columns to avoid losing document references.

Render must use the backend package's standard start command so the startup
migration runs. The migration is additive and idempotent. For a manual
pre-deployment run, inspect the intended Render/Aiven database identity and
schema from the backend directory:

```sh
node scripts/applyEmployerPermitDocumentsMigration.js --database ACTUAL_DB_NAME --host ACTUAL_DB_HOST
```

After verifying that identity and following the normal database backup process,
the manual migration can be applied with:

```sh
node scripts/applyEmployerPermitDocumentsMigration.js --apply --database ACTUAL_DB_NAME --host ACTUAL_DB_HOST
```

This standalone runner does not replay unrelated migrations or rewrite
SequelizeMeta. Deploy the backend and rebuilt frontend together. Existing single
permit registrations require no data conversion.

Keep the existing backend Cloudinary settings configured:
`OBJECT_STORAGE_PROVIDER=cloudinary`, `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. New permits use authenticated
delivery. Production/Render rejects new permits when shared storage is missing;
it does not silently save them to temporary disk. The backend per-file limit is
`MAX_UPLOAD_MB` (default 10). If changed, set frontend `VITE_MAX_UPLOAD_MB` to the
same value before building; the backend remains authoritative.

The connected local database was migrated after saving a reference/verification
snapshot to `tmp/uploads/employer-permit-backup-1792278631347.json` (ignored by
Git). Every original reference and verification flag matched after migration.
No production database or Render deployment was changed.

## Verification

```sh
# backend; enable the connection-local temporary-table round trip
EMPLOYER_PERMIT_DB_TEST=1 node --test tests/employerPermitWorkflow.test.js tests/employerPermitMigration.test.js tests/employerPermitDocuments.test.js tests/authDatabaseFlow.test.js tests/graduationProofPreview.test.js tests/objectStorageReferences.test.js tests/messageAttachmentStorage.test.js tests/modelTableMappings.test.js
# frontend/alumni-portal
node --test tests/businessPermits.test.js tests/apiConnection.test.js tests/profilePhotoUpload.test.js
node --test tests/businessPermits.browser.test.js
npm run build
```

On PowerShell, set the optional database-test flag with
`$env:EMPLOYER_PERMIT_DB_TEST = '1'`. The Chrome regression supports
`PUPPETEER_EXECUTABLE_PATH` if the cached Puppeteer browser is unavailable. It
uses fixture accounts and temporary files; no real account or email is created.

Checks cover one through five uploaded files, six-file rejection, required
permits, extension/MIME/signature/size validation, original names, download bytes,
unauthorized access, legacy paths, migration idempotence, private metadata,
persistence failure, and preserving references through approval/rejection. The
browser check uses the actual registration page and verification modal to select,
remove, re-add, submit, view and download five files.

Read-only checks of actual existing submissions returned HTTP 200 for all five:
three local permits (94,201; 332,512; 5,253,743 bytes) and two recovered Cloudinary
permits (127,691 and 77,761 bytes). The original files and references were unchanged.

Actual test results:

- Backend suite above: 33 passed, 0 failed, 0 skipped, including the real
  connection-local database round trip and private-field query check.
- Final focused backend check after changing the legacy endpoint response to
  document-ID URLs: 5 passed, 0 failed, 1 optional database test skipped (that test
  had already passed in the full run with its environment flag enabled).
- Frontend utility/API/profile-upload checks: 11 passed, 0 failed.
- Chrome registration/verification workflow: 1 passed, 0 failed. It rejected six
  files, removed/re-added a file, submitted five, then viewed and downloaded each
  from Employer Registration Details using authenticated fetches.
- Frontend production build: exit code 0. Vite emitted its existing nonfatal
  empty `react` chunk warning.
- `git diff --check`: passed. Production deployment remains unverified.

## Files changed

- `backend/controllers/authController.js`
- `backend/controllers/adminController.js`
- `backend/controllers/employerPermitController.js`
- `backend/middleware/uploadMiddleware.js`
- `backend/models/EmployerProfile.js`
- `backend/routes/adminRoutes.js`
- `backend/services/objectStorage.js`
- `backend/services/employerPermitDocuments.js` (new)
- `backend/migrations/20261018-add-employer-permit-documents.js` (new)
- `backend/scripts/applyEmployerPermitMigration.js`
- `backend/scripts/applyEmployerPermitDocumentsMigration.js` (new)
- `backend/tests/employerPermitWorkflow.test.js`
- `backend/tests/employerPermitDocuments.test.js` (new)
- `backend/docs/employer-permit-documents.md` (new)
- `frontend/alumni-portal/src/pages/EmployerRegisterPage.jsx`
- `frontend/alumni-portal/src/pages/RegisterEmployerPage.jsx`
- `frontend/alumni-portal/src/pages/admin/AdminVerificationPage.jsx`
- `frontend/alumni-portal/src/components/BusinessPermitInput.jsx` (new)
- `frontend/alumni-portal/src/components/BusinessPermitDocuments.jsx` (new)
- `frontend/alumni-portal/src/utils/businessPermits.js` (new)
- `frontend/alumni-portal/tests/businessPermits.test.js` (new)
- `frontend/alumni-portal/tests/businessPermits.browser.test.js` (new)
