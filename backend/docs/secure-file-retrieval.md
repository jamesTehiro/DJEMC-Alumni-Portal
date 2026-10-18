# Secure proof retrieval: diagnosis and verification

## Root cause and evidence

The secure-file token is base64url of the **exact stored reference**, not a JWT
or a Cloudinary public ID. The registrar serializer calls `toSecureFileUrl`;
the file route authenticates the caller and checks the decoded reference
against application/profile ownership before contacting storage. Registration's
Cloudinary upload engine passes the actual returned storage reference to
`authController.register`, which saves it in `AlumniProfile.proof_document_path`.

New graduation proofs use `type=authenticated`. Cloudinary can return an already
signed `secure_url`, shaped as:

```
https://res.cloudinary.com/<cloud>/image/authenticated/s--<signature>--/v<version>/<asset>.png
```

The old `authenticatedDeliveryUrl` treated everything after `authenticated/`
as the asset path and prepended another signature. The resulting URL had two
`s--...--` segments. Cloudinary interpreted the second as a transformation and
returned HTTP 400. `sendStoredFile` forwarded that upstream status to the client.
The upload itself and its stored asset identity were valid.

Read-only diagnostics on October 18, 2026 found:

| Source | Reference metadata | Result |
| --- | --- | --- |
| Oldest local proof | `cld`, `image/upload`, unsigned versioned URL, matching public ID | HTTP 200 |
| Newest local proof | `cld`, `image/upload`, unsigned versioned URL, matching public ID | HTTP 200 |
| Existing provider proof sample | `image/authenticated`, already signed versioned URL, matching public ID | Original provider URL: HTTP 200 |
| Same authenticated asset, old URL construction | Duplicate signature segments | HTTP 400, sanitized code `invalid_transformation` |
| Same authenticated asset, corrected download helper | Exactly one signature, original asset/version | HTTP 200 |
| Same authenticated asset, private-download API | Original resource type/type/public ID | HTTP 200 |

Both single-signature variants (signing with or without the version) returned
200 for this asset. The demonstrated fault is the duplicate signature, not the
version alone. The corrected signer follows the
[Cloudinary Node SDK's asset-path signing](https://github.com/cloudinary/cloudinary_npm/blob/master/lib/utils/index.js).

The available database is local and contains two legacy proofs, with no
authenticated proof row. The authenticated sample came from a read-only
Cloudinary Admin API lookup scoped to `private_uploads/alumni_proof/`. It has
not been correlated to the reported production user's database row. No document
contents were downloaded by diagnostics; probes used HEAD requests. No files,
accounts, provider assets, or existing references were changed.

## Retrieval and caching changes

- Validate Cloudinary resource type, delivery type, public ID and delivery URL
  together. Read an optional existing signature and version separately, then
  build a URL with exactly one signature. Keep legacy `upload` URLs unchanged.
- Keep actual upload-result public ID, URL, resource type and delivery type;
  also retain returned format/version metadata. Existing local paths and plain
  remote URLs remain supported. Local reads stay inside the existing upload
  roots and reject symlink/path traversal escapes.
- Use canonical base64url/UTF-8 token validation. Invalid tokens/references return
  400; missing authorized assets return 404; authentication and ownership/scope
  failures remain 401/403. Upstream failures, including Cloudinary 400, return a
  safe 502; unavailable signing configuration returns 503.
- Scope `private, no-store`, `Vary: Authorization`, `nosniff` and disabled ETag
  generation to `/api/files`. Disable local Last-Modified/ETag generation too.
  Ignore `If-None-Match`/`If-Modified-Since` on these routes: an authorized
  request retrieves the current file and never reuses a cached representation.
  This also covers authentication errors and JSON storage errors.
- Redact secure tokens and query strings in the request logger. Storage logs
  include only provider/type enums, a reference fingerprint, upstream status,
  and an allowlisted failure category. Raw errors, provider bodies/headers,
  filenames, public IDs, tokens, signed URLs and credentials are excluded.

Previously, Express could generate a byte-derived ETag for a successful buffered
file response and return 304 when `If-None-Match` matched. Ownership checks and
the provider download occurred before `res.send` evaluated freshness. A provider
400 instead threw before the success response. An ETag may also have been
generated on a JSON error, but Express does not convert a 400 response to 304.
There is no captured production request correlation proving that the reported
304 and 400 belonged to the same file; do not attribute one to the other.

## Regression coverage and commands

`tests/secureFiles.test.js` exercises real Express routes, JWT middleware and
multipart registration with mocked provider/database boundaries. It covers
legacy public/truncated/plain URL references, realistic already-signed new PNG
and raw PDF references, registration persistence and registrar token round trips,
local files, malformed tokens/references, unauthorized requests, application
ownership and employer scopes, missing assets, Cloudinary 400/401/403/5xx and
network failures, conditional requests, MIME, cache headers, safe logs and
streamed retrieval/private-download URL construction.

`tests/graduationProofPreview.test.js` additionally models the provider rejecting
duplicate signatures with HTTP 400, checks the exact resource/type/asset path and
signature, and verifies the upload response's actual public ID/format/version
survive serialization. Both already-signed and unsigned PNG/PDF upload responses
are covered. This catches the original defect instead of accepting every mocked
download as a success.

```powershell
# From backend: read-only metadata; --probe adds HEAD requests.
node scripts/diagnoseSecureFiles.js
node scripts/diagnoseSecureFiles.js --probe --provider-sample
# Target a known account using this environment's database (not automatically production):
node scripts/diagnoseSecureFiles.js --user-id 123 --probe
# Anonymous production probe; sends no real token or Authorization header:
node scripts/diagnoseSecureFiles.js --deployment-check
npm.cmd test
# From frontend/alumni-portal:
npm.cmd run build
# From repository root:
git diff --check
```

The diagnostic uses the configured database/storage environment, never assumes
that it is production, and never prints asset URLs, public IDs or references.
Provider sampling is optional and read-only. Per-file fingerprints allow
sanitized failures to be correlated without retaining secure tokens.

Validation completed in this workspace:

- Full backend `npm.cmd test`: 374 tests, 362 passed, 12 skipped, zero failures.
- Frontend `npm.cmd run build`: passed.
- Repository-wide `git diff --check`: passed.

## Production deployment evidence and steps

The reported production response text `Stored file could not be downloaded.` is
absent from the updated backend implementation. An anonymous production probe on
October 18, 2026 returned HTTP 401 **with an ETag**, without `private, no-store`
and without `Vary: Authorization`. Those headers do not match the local updated
secure-file route, including its authentication-failure path. Combined with the
old response text, this indicates that production is serving an earlier build.
The anonymous probe does not identify the exact deployed commit or prove an
authenticated document opens. Browser connection failed before navigation;
no authenticated production registrar session was inspected.

The fix remains in the working tree. Local HEAD was `81283e6` during this audit;
the secure-file patch is not included in that commit. Deploying the same existing
commit again will not include the working-tree changes.

1. Commit only these reviewed fix files; preserve/exclude unrelated staged
   employer-permit tests and Firebase cache changes:
   - `backend/services/objectStorage.js`
   - `backend/controllers/fileController.js`
   - `backend/routes/fileRoutes.js`
   - `backend/middleware/requestLogger.js`
   - `backend/tests/graduationProofPreview.test.js`
   - `backend/tests/secureFiles.test.js`
   - `backend/scripts/diagnoseSecureFiles.js`
   - `backend/docs/secure-file-retrieval.md`
2. Push that commit to the branch configured for the existing Render backend
   service `djemc-alumni-backend`. Check the branch and deployed commit in Render.
3. Deploy the commit containing the fix (automatically or through Render's manual
   deploy control), preserving existing environment variables and `npm start`.
   No storage credential change or database migration is required.
4. Run `node scripts/diagnoseSecureFiles.js --deployment-check`. All four policy
   checks must be true; this is a deployment signal, not document acceptance.
5. In the deployed registrar page, open a controlled newly registered account's
   real proof and an older proof. Check HTTP 200, image/PDF MIME, correct contents,
   private/no-store headers, and unauthorized denial. Only then record production
   acceptance. Use the sanitized failure log's status/type/fingerprint if it fails.

This backend delivery fix requires no frontend source change. The production
frontend build was run as a regression check. Employer-permit features and
unrelated staged work were not modified in this audit.

## Migration and production acceptance

No data migration, re-upload, deletion or reference rewrite is required for valid
existing proofs. `proof_document_path` is already TEXT. The signer accepts valid
existing signed and unsigned references; newly saved references retain actual
provider results.

This workspace patch is not a verified production fix. After deploying it to
Render, use an authorized registrar session in the deployed verification page
to open a newly created account's real PNG/PDF proof and an older proof. Confirm
HTTP 200, correct MIME and `private, no-store`, no ETag/304, and denial for
unauthorized callers. Record only sanitized status/type/fingerprint evidence.
Do not mark production fixed until the real new-account document opens there.
