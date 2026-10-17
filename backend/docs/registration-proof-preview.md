# Registration years and registrar proof preview

## Changes and diagnosis

Registration now accepts only four-digit graduation years 2023–2027, inclusive.
Frontend inline validation and backend validation reject missing, malformed or
out-of-range values before account creation. Existing records are untouched.
The range is explicit in backend/utils/graduationYear.js and
frontend/alumni-portal/src/utils/graduationYear.js; update both deliberately
when the allowed range changes. The backend also checks the graduation_year
alias and rejects contradictory aliases.

The registrar API previously derived the filename by splitting the opaque
`cld:` reference, so the frontend could not recognize its extension. The modal
also put a relative `/api/files/...` path directly into img/iframe/link elements:
on Firebase that targets the frontend host, and those requests cannot attach
the Bearer header required by the backend. Finally, legacy local proof paths
were encoded into the remote-storage endpoint, which cannot serve local files.

The API now reads Cloudinary originalName metadata and uses the existing secure
URL helper for both remote and legacy paths. The preview fetches with fetchFile
and Bearer authentication, creates a browser-local Blob URL, and renders supported
images or PDF in the modal. MIME comes from delivery headers with a filename
fallback for octet-stream responses. Open Document/Download remain available;
PDF rendering depends on browser support. Loading and retrieval errors are shown.
Object URLs are revoked on close, change or unmount, including stale requests.
No JWT goes into a URL and no global CSP/frame policy was relaxed. Blob fetching
also avoids direct cross-origin frame restrictions and attachment dispositions.

Proof delivery is restricted to authenticated admin accounts. An alumni owner
or employer cannot retrieve the proof through the protected endpoint. New proof
uploads now request Cloudinary `authenticated` delivery and are proxied using
server-side signing; older valid upload/authenticated references still work.
Upload size/type restrictions, registration fields, consent and password handling
are preserved. Approval/rejection handlers and email triggers are unchanged.

Official record search first retains the existing substring/course/year query.
If empty, it searches for every significant name token, ignoring punctuation,
spacing, capitalization and single-letter initials. Results are candidates for
manual verification only; no approval or record creation occurs. HTTP 304 by
itself is not a search failure. A read-only check of local djemc_alumni_db found
zero exact and zero tolerant matches for Judyvie E. Novo. Production Aiven
records were not inspected and may differ.

## Files

- backend/controllers/authController.js
- backend/controllers/registrarController.js
- backend/controllers/fileController.js
- backend/controllers/alumniRecordController.js
- backend/middleware/uploadMiddleware.js
- backend/utils/graduationYear.js
- backend/utils/alumniNameSearch.js
- backend/tests/authDatabaseFlow.test.js
- backend/tests/registrationYearAndSearch.test.js
- backend/tests/graduationProofPreview.test.js
- frontend/alumni-portal/src/pages/AlumniRegisterPage.jsx
- frontend/alumni-portal/src/pages/RegistrarVerificationQueuePage.jsx
- frontend/alumni-portal/src/components/GraduationProofPreview.jsx
- frontend/alumni-portal/src/utils/graduationYear.js
- backend/docs/registration-proof-preview.md

## Database and old proofs

No database changes are required by this patch. AlumniProfile.proof_document_path
already uses TEXT in the model. Valid existing references need no migration.
The patch does not publicize or re-upload old objects. Missing local files on
ephemeral Render storage, deleted Cloudinary assets, truncated references or
revoked storage credentials cannot be restored by a UI fix; restore the original
asset/reference or request a new upload after reviewing the failed item.

## Deploy

1. Commit only the reviewed task files, preserving the workspace's other changes.
   Push to the branch connected to the existing Render backend service.
2. In Render, deploy that commit (Manual Deploy → Deploy latest commit, or the
   configured automatic deploy). Preserve the backend root directory, existing
   dependency installation/build command and `npm start` start command. No
   migration command or production secret change is needed. Confirm existing
   Cloudinary environment variables are configured; do not print them.
3. Wait for the backend deployment to become healthy. Verify the registrar
   pending-user API returns a real proof filename and the protected delivery
   route returns appropriate image/PDF Content-Type to an authorized admin.
4. Build and deploy the frontend from PowerShell at the repository root:

```powershell
Set-Location C:\Alumni\frontend\alumni-portal
npm.cmd ci
npm.cmd run build
npx.cmd firebase-tools deploy --only hosting --project djemc-alumni-portal
```

Use the existing authenticated Firebase CLI account and existing Vite API base
configuration pointing to Render. firebase.json publishes dist and the existing
project alias identifies djemc-alumni-portal. This task does not execute deployment.

## Verification

```powershell
Set-Location C:\Alumni\backend
node --test tests/registrationYearAndSearch.test.js tests/graduationProofPreview.test.js tests/authDatabaseFlow.test.js tests/objectStorageReferences.test.js
Set-Location C:\Alumni\frontend\alumni-portal
npm.cmd run build
```

Backend has no separate build script; use syntax checks plus the tests. Tests
mock Cloudinary and database calls and never upload private documents or create
production accounts. The tests exercise accepted boundary-year persistence,
rejected values, official-record fallback, pending API metadata, authenticated
PNG/PDF upload references, signed server delivery, and non-admin denial.

After deployment, use controlled accounts to submit PNG and PDF proofs at the
accepted year boundaries, then open both as a registrar. Check loading, image/PDF
rendering, Open/Download, close/reopen and narrow screens. Verify 2022, 2028 and
non-numeric values fail in both UI and direct API requests; test unauthorized
retrieval and valid older proofs. Search the production official master list
for the reported name, inspect genuine candidates, and manually verify before
using Match on Official Record/Approve/Reject. No production preview success
is claimed until these post-deployment checks pass.
