# File upload, PDF preview and Cloudinary verification

Verified 23 October 2026 (Asia/Manila). Project: DJEMC Alumni Tracking and Job Portal.

The verification found and corrected remaining defects, including a **live Cloudinary 401 affecting legacy PDFs**. New authenticated PDF/PNG retrieval and legacy raw PDF retrieval now preserve the tested content. This report does **not** certify the deployed Firebase-to-Render application: deployed sessions, real application-record persistence, and Render filesystem durability remain unverified.

No deployment, commit, push, production migration, production record update, deletion of an existing upload, or Cloudinary setting change was performed. Five small synthetic Cloudinary assets were created and retained. Their nonsigned identifiers are recorded in the evidence JSON files for review. No real user documents were used.

## 1. Original bugs, causes and corrections

| Reported bug | Finding and correction | Evidence and resolution |
| --- | --- | --- |
| Cloudinary PDF HTTP 401 | Authenticated raw PDFs need the signed private-download path already present in the workspace. A live synthetic **legacy `raw/upload` PDF still failed with 401**, because the previous fix handled authenticated assets only. Added a server-side signed private API retry after a legacy raw PDF CDN 401/403. It validates the configured account and asset identity and handles both `cld:` references and plain raw PDF URLs. Stored references and account settings remain unchanged. | The same legacy synthetic object failed before the correction and returned its original 604 bytes afterward. Its CDN URL still returns 401. New authenticated PDF and PNG retrieval also returned identical hashes. **Resolved for the tested resource/delivery types and configured account; deployed Render requests remain unverified.** |
| Backend HTTP 502 | An authorized request could reach Cloudinary but receive a denied PDF response, which became a backend storage error. Fixing only the status would leave the document inaccessible; the legacy fallback now retrieves the actual PDF. Applicant endpoints also incorrectly exposed upstream 401/403 as application authorization errors and could retain download headers on JSON errors. They now retain meaningful 404/400/503 responses, map provider failures to safe 502 responses, and remove file headers on errors. | Real applicant HTTP routes retrieved Cloudinary bytes successfully. Focused negative cases exercise provider 401, 403, 404 and 500. Provider outages still fail; they are never represented as successful file downloads. **Resolved for tested retrieval; original deployed Render logs were unavailable.** |
| Applicant document retrieval | The document reader correctly binds `documentId` to its application, but upload validation accepted extension **or** MIME and did not check applicant file signatures. New applicant objects also used public `upload` delivery. Bulk ZIPs skipped cloud references, admitted other admin scopes, and called the removed Archiver factory API despite installed Archiver 8. Download query parameters lacked attachment disposition. | Reproduced forged PDF acceptance (200 instead of 415), public upload metadata, and admin scope bypasses before corrections. Added matching MIME/extension and signature validation in cloud/local applicant storage; authenticated delivery for new applicant files; shared file reading for ZIPs; `ZipArchive`; consistent admin scope and download headers. Tests extract ZIP entries and compare actual PDF/PNG bytes. **Local and live-provider HTTP checks pass; real persisted applicant records remain unverified.** |
| Messaging attachments | The existing persistence, complete-reference handling, legacy recovery and participant checks were retained. Two PDF test doubles still expected CDN delivery and incorrectly rejected the current private API request. Updated them to verify the signed API path; expanded route tests to images, PDFs, downloads and retry/history behavior for all four roles. | Actual message routers run with fixture persistence/provider responses. Alumni, Employer, Admin Alumni and Admin Employer send text/PDF/PNG, replay retries, read history and retrieve identical bytes. Unrelated users and wrong admin scopes are denied before storage. Legacy local/truncated references and missing files are covered. **Local component/integration verification passes; deployed conversation reload/new-login persistence and Socket.IO behavior remain unverified.** |
| Registration documents | Six-proof handling, legacy primary proof, transactional association, OTP and consent flows were traced and retained. Registrar access uses exact stored references and Registrar scope. Employer permits continue to use the existing local business-permit storage, even when Cloudinary is configured. | Alumni tests exercise zero, one and six proofs, all listed metadata, every retrieval, rejection of seven, failed-save cleanup, legacy formats and role denial. Employer tests cover one-to-five permits, previews/downloads, replacement, scope checks, invalid files and failure cleanup. Browser suites exercise both alumni forms, permit review and consent/OTP interactions. **Local verification passes; actual database writes and employer permit durability on Render are unverified.** |

An additional oversized-upload regression surfaced while adding local signature validation: a truncated disk upload must return its storage metadata to Multer so cleanup completes. That path was corrected and both cloud/local oversize and count cases now pass. No size or count limit was changed.

### Reviewed lifecycle and interfaces

- Reviewed working-tree diffs and recent storage/preview commits, including `da8f9b2` and `6b877fc`, while preserving unrelated edits.
- Upload functions: `applicationUpload`, `dynamicRequirementFilter`, cloud/disk storage engines, registration parsers, `uploadBuffer`, proof/permit metadata helpers, registration transactions and `applyJob` document persistence.
- Retrieval functions: `getApplicationDocumentFile`, `getApplicationResumeFile`, bulk ZIP download, secure file authorization, `sendStoredFile`, `streamStoredFile`, signed URL construction, message attachment resolution and permit retrieval.
- Frontend: multipart file selection, `fetchFile` authentication/origin enforcement, document signature/MIME preparation, shared preview object URL cleanup, applicant requirement switching, Registrar proof switching and permit review. UI code was not changed by this verification.
- Application metadata still saves full storage references plus original filenames, MIME types, sizes and application associations. The reviewed `applyJob` writes were not executed against production records.

## 2. Workflow verification matrix

Status meanings:

- **PASS – Verified end-to-end**
- **LOCAL PASS – Verified locally only**
- **PARTIAL – Some functions remain unverified**
- **FAIL – Bug still exists**
- **BLOCKED – Cannot verify due to missing access or configuration**

`LOCAL PASS` below identifies local router/controller/component tests with explicit fixture database/provider substitutions. It is **not** a claim of real database persistence or production end-to-end verification. The overall workflow remains `PARTIAL` for that reason. Browser previews were tested separately from the mocked backend integration tests.

| Workflow | Image | PDF | Preview | Download | Authorization | Complete workflow |
| --- | --- | --- | --- | --- | --- | --- |
| Alumni Messages | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Employer Messages | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Admin Alumni Messages | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Admin Employer Messages | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Alumni Registration | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Employer Registration | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Registrar Verification | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Admin Employer Verification | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Employer Applicants | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |
| Admin Employer Applicants | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | PARTIAL |

The isolated **Cloudinary upload/retrieval lifecycle** is **PASS – Verified end-to-end** for the generated authenticated PDF/PNG. The legacy raw PDF storage retrieval is also verified against the real provider. These narrower results do not upgrade any complete application workflow to production PASS.

### Concrete endpoint evidence

| Endpoint / interface | Input and expected result | Actual result | Limitation |
| --- | --- | --- | --- |
| `GET /api/applications/:id/documents/:documentId/file` | Authorized Employer/Admin Employer receive PDF or PNG bytes; `?download=1` sets attachment headers. | **21 real HTTP assertions passed:** 12 authorized previews/downloads across authenticated PDF, authenticated PNG and legacy raw PDF; 9 denials for missing credentials, unrelated employer and Registrar admin. Bytes, MIME, disposition and no-store headers checked. | Real router, JWT validation and Cloudinary; database records are synthetic objects in memory and database queries are forbidden by this harness. Not a deployed Render test. |
| Same document endpoint | Other application's document ID returns 404, unrelated role returns 403, absent token returns 401. | Local actual-router tests pass; unauthorized calls do not contact the fixture provider. | No production records used. |
| `GET /api/applications/:id/resume/file` | Applicant, owning Employer and Admin Employer retrieve saved resume; wrong identity/scope denied. | Local byte comparisons, filenames/MIME, missing legacy paths, scope and download headers pass. | Provider/database fixture responses. |
| `GET /api/applications/:id/documents/download` | ZIP contains both stored Cloudinary originals; unrelated admin scopes denied. | Extracted ZIP entries equal uploaded PDF/PNG buffers; tests also verify upstream failure JSON and attachment-header removal. | Small local fixtures; maximum-size concurrent ZIP memory use not load-tested. |
| `POST /api/messages/:conversationId`, `GET /api/messages/:conversationId`, `GET /api/messages/files/:messageId` | All four roles send/reload PDF/PNG and download identical content. | Actual routers pass with persistence/provider fixtures; retry replay and conditional-header requests retain correct files. | Fixture history is not an actual database reconnect; Socket.IO delivery is not independently exercised. |
| `POST /api/admin-employer/messages`, `GET /api/admin-employer/messages/:employerId`, `GET /api/admin-employer/messages/files/:messageId` | Employer/Admin Employer attachment operations; other scopes denied. | PDF/PNG send/history/preview/download and scope cases pass locally. | Fixture persistence/provider responses. |
| `POST /api/auth/register` and registration parser/controller fixtures | Supported documents, zero/one/six alumni proofs, one-to-five employer permits; reject invalid, excessive and oversized inputs. | Metadata association, primary legacy reference, retrieval and failure cleanup assertions pass. Local tests use a 1 MB configured limit to exercise rejection economically. | Model writes and most provider operations are mocked; real OTP inbox delivery not tested. |
| `GET /api/files/secure/:token` | Registrar-only proof access, correct bytes, no validators/public cache, malformed tokens denied. | Actual HTTP fixture tests pass, including all six proof references, legacy paths, conditionals and denial before provider access. | Complete deployed Registrar queue not tested. |
| `GET /api/admin/employer/users/:userId/business-permits/:documentId` | Employer admin previews/downloads each permit; wrong scopes denied. | Local real-router/controller and browser review tests pass, including existing/local references. | No verification that Render retains local business-permit files after restart. |

## 3. File integrity

Real-provider evidence is in `tmp/file-verification-live-storage.json`, `tmp/file-verification-live-legacy-before.json`, `tmp/file-verification-live-legacy.json` and `tmp/file-verification-live-http.json`.

| Synthetic file | Upload/retrieval length | Upload and retrieval SHA-256 | Result |
| --- | --- | --- | --- |
| Authenticated PDF | 604 / 604 bytes | `7975ce3230c98acea4ba5ed691d9d44b78556d3bdfac3d60b2afc36930315ea0` | Identical buffered, streamed and repeat retrievals. Full generated PDF has header, objects, xref and trailer. |
| Authenticated PNG | 69 / 69 bytes | `fdf040aaee9270aef6cf03752d51615cf6025c72081820fe0945f0c9c9cbdd9c` | Identical buffered, streamed and repeat retrievals. Fixture generated with valid PNG chunks and CRCs. |
| Legacy raw/upload PDF | 604 / 604 bytes | `7975ce3230c98acea4ba5ed691d9d44b78556d3bdfac3d60b2afc36930315ea0` | Before correction: CDN/storage retrieval 401. After correction: identical PDF through signed fallback, including streaming and repeat requests. |

Browser tests use a complete two-page PDF and check document switching, blob content, PDF iframe selection, decoded image display, mobile width, Office download fallback, error display and object URL release. These checks do not certify every PDF in existing production records or a particular external desktop PDF reader.

The first 68-byte PNG sample in the initial live probe was returned as 67 bytes by Cloudinary. That observation is retained in `tmp/file-verification-live-storage-initial.json`; it is not counted as byte-identical success. The generated CRC-valid PNG was then used for the successful 69-byte comparison. Do not infer universal byte preservation for every image accepted/normalized by the provider.

## 4. Security verification

- Actual JWT middleware rejected missing credentials. Local suites also cover invalid credentials, wrong roles, malformed tokens, unrelated conversations, unrelated employers and wrong admin scopes.
- Document IDs are constrained to the authorized application. The generic secure-file route and ZIP route now apply the same Employer admin scope as individual applicant readers.
- New applicant requirements, resumes, transcripts and certificates use authenticated Cloudinary delivery. A folder called `private_uploads` alone did not provide that protection previously.
- Removing signatures from the new live PDF and PNG URLs returned **401**. Authorized signed retrieval worked. The legacy test PDF CDN URL also remains 401 after the fix.
- The fallback signs only supported raw PDFs in the configured Cloudinary account. Tests prove no retry for another account, provider 404 or provider 500. A failed signed fallback remains an error and never returns provider error bytes as a document.
- Existing legacy `type: upload` assets were not changed. This verification does not certify the privacy of every historical asset; legacy public images may still require a separately reviewed asset audit/remediation.
- Tests verify safe diagnostics, no signed URL/key leakage in responses/logs, private no-store headers and removal of file disposition on JSON errors. Live evidence files contain hashes and nonsigned synthetic identifiers, not credentials or signed URLs.
- Applicant files now require matching extension/MIME and a supported byte signature. Renamed HTML masquerading as PDF/PNG is rejected with 415. Existing size/count settings remain unchanged: configurable file size, application count, six alumni proofs and five employer permits.
- Existing local message/proof traversal handling, missing-file responses, cleanup and legacy reference recovery pass focused regression tests. References with irretrievably missing identifiers or missing provider/local content cannot be reconstructed by a viewer fix.

## 5. Files changed by this verification

| File | Additional change |
| --- | --- |
| `backend/services/objectStorage.js` | Shared buffered reader and validated legacy raw PDF signed fallback; preserved the pre-existing authenticated PDF fix. |
| `backend/middleware/uploadMiddleware.js` | Applicant extension/MIME/signature validation in both engines, authenticated applicant delivery, truncated-upload handling. Preserved pre-existing debug-log removal. |
| `backend/controllers/applicationController.js` | Individual download headers, safe provider errors, cloud ZIP entries, installed Archiver 8 API and consistent ZIP authorization. |
| `backend/controllers/fileController.js` | Employer admin scope for applicant files; removed duplicated legacy URL conversion while preserving complete references. |
| `backend/tests/applicationUploadVerification.test.js` | New actual-router upload/download, ZIP, role and provider-failure regressions. |
| `backend/tests/legacyPdfDelivery.test.js` | New legacy cld/plain-URL fallback, signature, account isolation and failure regressions. |
| `backend/tests/graduationProofPreview.test.js` | Verify current signed PDF API request instead of an outdated CDN-only test double. |
| `backend/tests/messagingRoutes.test.js` | Current PDF retrieval contract plus all-role image/PDF/history/retry/download coverage. |
| This report and `tmp/` evidence helpers/logs | Reviewable verification evidence, external-connection guard, synthetic live provider/HTTP checks and read-only schema audit. |

Other changes present at the start, including migration runner, registration UI, Registrar UI, resume UI, Firebase cache and existing test edits, were preserved. This task made no frontend source changes and no migration changes.

## 6. Exact final test results

| Final run | Total | Pass | Fail | Skip | Cancelled |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full backend tests | 526 | 506 | 2 | 18 | 0 |
| Focused file verification (subset of backend total) | 55 | 54 | 0 | 1 | 0 |
| All frontend `.test.js` unit tests excluding browser suites | 184 | 181 | 3 | 0 | 0 |
| Five relevant browser suites | 9 | 9 | 0 | 0 | 0 |
| Production-build OTP browser suite | 3 | 3 | 0 | 0 | 0 |
| Separate live-provider applicant HTTP assertions | 21 | 21 | 0 | 0 | 0 |

The 21 live assertions are a separate verification harness, not additional Node test-runner tests. The focused suite is a subset and must not be added to the backend total.

- Frontend production build: **passed**, Vite completed successfully.
- Frontend lint: **failed**, **128 errors and 11 warnings**. This was run before any verification edits to frontend code; none were subsequently made. Left unrelated lint cleanup untouched.
- `git diff --check` for the files edited by this task: passed. The full workspace check also reports an existing extra blank line in `ResumeBuilderPage.css`, outside this task.

Unresolved full-suite failures:

1. Backend `notificationWorkflows.test.js`: announcement graduation-year targeting expected 200, received 500. Announcement code/test was not modified by this task; the failure was present in the earlier broad verification run.
2. Backend `security.test.js`: password-reset generic-response test calls an unstubbed database-backed rate limiter. It fails under the verification network/database guard. The initial baseline also failed this test. This is not evidence that production password reset fails.
3. Frontend `membershipManagement.test.js`: three existing failures concern status query serialization, malformed list response rejection and the membership Status column. Reproduced separately: 7 pass, 3 fail. No relevant frontend source was changed by this task.

The 18 backend skips comprise eight opt-in database integration cases and ten disabled notification/email cases. They remain unverified, not successful real-world tests. The focused skip is the real MySQL permit metadata round trip. No isolated local/staging database was configured; using production application tables for test writes was excluded.

Initial Chrome runs in the sandbox timed out. Retrying the existing suites outside the sandbox passed all 12 browser tests. The in-app Browser runtime failed before initialization with `Cannot redefine property: process`; the results above come from the repository's existing Puppeteer suites. Browser fixtures intercept API traffic; they did not contact production registration or send real OTP email. Passing suites assert their expected browser errors are absent; expected backend errors from negative cases remain visible in the test logs.

Key evidence files, relative to repository root:

- `tmp/file-verification-backend-baseline.log`: 53 pass, 2 fail, 1 skip before corrections.
- `tmp/file-verification-new-regressions-before.log`: four reproduced applicant upload/privacy/scope failures.
- `tmp/file-verification-legacy-regression-before.log`: 1 pass, 2 fail before legacy fallback; corresponding `-after.log`: 3 pass.
- `tmp/file-verification-backend-release-check.log`: final complete backend run.
- `tmp/file-verification-focused-final.log`: final focused run.
- `tmp/file-verification-frontend-all-unit.log`, `tmp/file-verification-preexisting-frontend.log`.
- `tmp/file-verification-browser-approved.log`, `tmp/file-verification-otp-browser.log`.
- `tmp/file-verification-build.log`, `tmp/file-verification-lint.log`.
- `tmp/file-verification-live-storage*.json`, `tmp/file-verification-live-legacy*.json`, `tmp/file-verification-live-http.json`.
- `tmp/file-verification-schema-readonly.json`.

## 7. Production readiness and remaining blockers

The targeted file corrections have local regression evidence and real-provider evidence. **The complete production release is not certified ready.** Remaining requirements are deployed Firebase-to-Render smoke tests, real staging persistence/relogin tests, Render environment/log inspection, permit durability verification and review of the unrelated failing checks.

The existing CA certificate at `backend/cert/ca.pem` enabled a successful read-only schema check with TLS certificate validation enabled. An earlier attempt without that CA failed; certificate validation was never disabled. Only `information_schema.COLUMNS` was queried; no application records were read or changed. The configured database has:

| Table.column | Observed type | Nullable |
| --- | --- | --- |
| `alumniprofiles.proof_document_path` | TEXT | YES |
| `alumniprofiles.proof_documents` | TEXT | YES |
| `applicationdocuments.file_path` | TEXT | NO |
| `messages.file_url` | TEXT | YES |
| `employermessages.attachment` | TEXT | YES |
| `employerprofiles.business_permit_path` | TEXT | YES |
| `employerprofiles.business_permit_documents` | TEXT | YES |

This confirms compatibility of the already-applied proof metadata column and long-reference storage on the configured database. It does not prove Render uses the same database/environment. The additive proof migration's existing-column/idempotence behavior also passes fixture tests. **No migration rerun is required for these corrections.**

Explicitly unverified:

- Render's deployed version, credentials, service health, request logs, proxy/CORS configuration and behavior during a redeploy/cold start.
- Actual Firebase production bundle and users' deployed preview/download/session behavior. The local production build passed.
- Real database transactions, reconnect persistence and a fresh authenticated session across every workflow. Read-only column inspection is not a persistence test.
- Employer business permits are written to the existing local `uploads/business-permits` directory. A persistent disk covering that exact resolved path has not been verified. Render local files are ephemeral unless covered by a persistent disk; this is a deployment blocker until checked. [Render persistent disk documentation](https://render.com/docs/disks).
- Existing real user documents, irrecoverably truncated references, deleted objects, legacy PDFs stored as `image` resources, every historical public asset's privacy, and actual mailbox OTP delivery were not exercised.
- ZIP maximum-size/concurrent request memory behavior was not load-tested. Remote ZIP entries are buffered before archive response starts.

The new fallback follows Cloudinary's documented signed private-download interface, which supports `resource_type`, original delivery `type`, asset identity and expiry; signed URLs stay on the backend. [Cloudinary access control documentation](https://cloudinary.com/documentation/control_access_to_media).

## 8. Deployment requirements

| Component | Requirement |
| --- | --- |
| Render backend | **Update required** to use these source fixes. Deploy only after review; inspect real environment and permit persistent-disk coverage. No deployment was performed. Local Node 22.19 satisfies the repository's Node >=22.12 requirement; actual Render runtime was not inspected. |
| Firebase Hosting | **No frontend update is required by this task's additional fixes.** If releasing the pre-existing registration/proof-preview UI work reviewed here, publish its reviewed build separately if it is not already deployed. The local build alone does not publish it. |
| Cloudinary configuration | **No account-setting change required for the verified cases.** Signed API retrieval works while unsigned authenticated delivery stays denied. Do not enable public PDF delivery to work around authorization. Historical public assets require separate review if remediation is needed. |
| Aiven migration | **None required for these fixes.** All seven inspected storage columns are already TEXT. Preserve the applied proof migration and existing records; do not rerun migrations as a verification step. |

After a reviewed deployment, use authorized synthetic/staging accounts to repeat the endpoint matrix through the actual Firebase origin, refresh and reauthenticate, restart/redeploy the backend where appropriate, and confirm persistence and byte integrity. Do not use the local fixture results as a substitute for those remaining checks.
