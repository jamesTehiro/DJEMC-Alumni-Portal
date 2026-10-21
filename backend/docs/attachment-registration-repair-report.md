# Messaging attachments and registration documents: local repair report

2026-10-20. Code and tests are local. No application database records were
changed, and no commit, push, deployment or production migration was executed.
The only schema writes were to a separately created disposable **local** test
database and connection-local test tables; those fixtures were removed afterward.

## 1. Messaging root cause and evidence

The exact text originates in `middleware/messagingErrorHandler.js`. It maps
`ER_BAD_FIELD_ERROR`, `ER_NO_SUCH_TABLE`, `ER_DATA_TOO_LONG`, and
`MESSAGE_METADATA_NOT_PERSISTED` to a safe 503 response. The latter is raised
by `services/messagePersistence.js` if the saved attachment reference/name/MIME/
size differs from its read-back inside the transaction. A Cloudinary failure
does not by itself establish any of these schema errors.

Current clients send a `client_message_id`. `persistMessage` reads the
`MessageSendRequest` retry ledger before inserting the message. The connected
**local** database lacks `message_send_requests`; a keyed send therefore cannot
complete locally until that schema is migrated. This also affects text sends
with retry IDs, not only files. Both local message reference columns are already
TEXT with their metadata columns present. Sampled historical `messages` records
still contain 255-character truncated `cld:` references from an older schema.
Widening a column cannot restore already truncated bytes.

| Send API | Originating function and storage |
| --- | --- |
| `POST /api/messages/:conversationId` | `messageController.sendConversationMessage` → `persistMessage`, `messages` and `message_send_requests` |
| `POST /api/admin-employer/messages` | `adminEmployerMessageController.sendEmployerMessage` → `persistMessage`, `employermessages` and the same retry ledger |

Alumni, Employer and Admin Alumni use the unified API. Admin Employer also uses
the unified API for forum threads and the existing employer/admin API for its
employer conversations. No new message API or conversation system was added.
Existing messages and nullable attachment metadata remain compatible.

**Aiven's exact missing/incompatible element is not yet established.** The local
evidence must not be presented as a production finding. Render Shell is not
available on the user's plan. The separately reviewable
[temporary deployment diagnostic](production-messaging-diagnostic.md) obtains
schema evidence through runtime Logs without a public endpoint or DDL.

## 2. Registration/viewer findings and code corrections

- Private legacy paths were reduced to a simple file URL, while authorization
  looked up an exact stored path. An old Windows reference could consequently
  fail ownership matching. Private serializers now preserve the exact stored
  reference in an opaque, authorization-checked URL token.
- Registration viewers separately guessed types from response MIME/filenames.
  Office files had no common fallback. A shared viewer now inspects signatures
  of the returned original bytes; a PDF remains a PDF even if a legacy MIME
  says image/octet-stream. Images retain aspect ratio and can be enlarged.
  PDFs use the browser's original-document viewer; Office files offer download.
- Remote buffered delivery now recognizes original PDF bytes and emits
  `application/pdf` even when the provider labels them generically.
- Chat documents previously opened a popup after asynchronous fetching and
  revoked its URL after 60 seconds. They now use the same modal viewer with
  object URLs retained until preview cleanup. PDF MIME also takes precedence
  over misleading image filename extensions.
- Alumni proof retrieval accepted any admin scope. It now requires registrar
  scope. Employer permits retain employer-admin scope and messaging retains
  conversation authorization. Proof uploads now require matching extension,
  declared MIME and supported signature instead of accepting either MIME or
  extension alone. Existing upload-size limits remain unchanged.
- Protected `fetchFile` calls reject external origins before forwarding tokens.
  Loading/error states, secure downloads and URL cleanup are shared.

Existing Cloudinary uploads send PDFs/Office documents as original raw files,
not image conversions. This inspection found no new conversion step to remove.
A missing/deleted original, a legacy converted image with no remaining PDF,
or an incomplete unrecoverable reference cannot be repaired by a viewer.
Per-file production failures still need the deployment evidence and controlled
authorized review; this report does not claim all originals exist in production.

## 3. Affected schema and minimum migration

| Table | Relevant columns/indexes |
| --- | --- |
| `messages` | `file_url` TEXT; `file_name`, `file_mime`, `file_size`; conversation/sender/read indexes |
| `employermessages` | `attachment` TEXT; `file_name`, `file_mime`, `file_size` |
| `message_send_requests` | sender/channel/conversation/request identity, payload hash, message ID, timestamps; unique identity index |
| `conversations`, `employerconversations` | `last_message_text`, `last_message_at`; existing identity/relationships |
| `conversationparticipants` | `unread_count`, `last_read_at`; participant composite key/indexes |
| `alumniprofiles` | `proof_document_path` TEXT |
| `employerprofiles` | `business_permit_path` TEXT, `business_permit_documents` TEXT |

The existing `20261018-repair-messaging-storage.js` migration is sufficient for
the confirmed local missing ledger. It adds missing supported metadata/summary
columns, widens supported reference columns while preserving definitions, and
creates only the missing retry table. It does not replace messaging tables or
rewrite records. It refuses unsupported mappings/definitions for manual review.
Its second application was verified inert against a separate MySQL database.
No duplicate migration was introduced. Registration viewer changes need no DDL
when the existing reference columns already have their declared TEXT types.

The existing permit reference/documents migrations may be needed on an older
deployment; their necessity is unverified in Aiven. Index/engine drift may need
separate review. MySQL DDL is not transactional: a partially applied migration
requires inspection, not an assumed transaction rollback.

## 4. Storage and persistence

Local environment inspection found all three Cloudinary variables present and
Cloudinary enabled. This does not establish Render's actual environment values.
Messages and alumni proofs use authenticated Cloudinary storage when configured.
Messaging rejects new local attachment writes in production/Render when shared
storage is absent. Alumni proofs can still fall back to local disk if Cloudinary
is unavailable. Employer permits deliberately use `uploads/business-permits`
through a separate disk engine even when Cloudinary is enabled.

No storage provider was automatically changed. Only files below a Render
persistent disk mount survive restarts/redeployments; the remainder of the
filesystem is ephemeral. See [Render's disk documentation](https://render.com/docs/disks).
The actual disk mount and existing file inventory require owner verification.

Before a storage change, inventory references without exposing them, securely
back up all still-accessible originals and their SHA-256 hashes, and test a
copy on isolated staging. Choose a persistent disk covering the actual upload
directory, or an explicitly approved copy to authenticated Cloudinary. Verify
byte hashes, MIME, owner access and download before updating any reference.
Retain the old file/reference for rollback. Never infer missing filenames or
delete originals. Legacy Cloudinary `type:upload` assets can remain public at
the provider even when the portal route is protected; copying these to
authenticated storage requires a separately approved migration. Cloudinary
describes its [access modes here](https://cloudinary.com/documentation/control_access_to_media).

## 5. Files changed or added for this task

Backend:

- `controllers/fileController.js`
- `middleware/uploadMiddleware.js`
- `services/objectStorage.js`
- `package.json`
- `scripts/diagnoseMessaging.js`
- `scripts/repairMessagingStorage.js` (optional reporting callback only)
- `scripts/preflightPrivateFiles.js`
- `scripts/diagnoseMessagingSchema.js`
- `scripts/startWithMessagingDiagnostic.js`
- `tests/graduationProofPreview.test.js`
- `tests/secureFiles.test.js`
- `tests/messagingMigration.integration.test.js`
- `tests/productionMessagingDiagnostic.test.js`
- This report and `docs/production-messaging-diagnostic.md`

Frontend, under `frontend/alumni-portal`:

- `src/components/DocumentPreview.jsx`
- `src/components/GraduationProofPreview.jsx`
- `src/components/BusinessPermitPreview.jsx`
- `src/components/MessageAttachment.jsx`
- `src/utils/documentPreview.js`
- `src/utils/messageAttachments.js`
- `src/services/api.js`
- `tests/documentPreview.test.js`
- `tests/documentPreview.browser.test.js`
- `tests/messageAttachments.test.js`

Pre-existing Firebase cache, EmployerPage CSS and unrelated temporary files were
preserved. OTP, notification, membership, job, resume and verification-decision
implementations were not changed.

## 6. Tests and practical limits

- Full backend suite: **448 passed, 15 skipped, 0 failed**. Opt-in database tests
  are intentionally not enabled by the default suite.
- Separate SQL run: **2 passed**. Verified idempotent additive migration on an
  isolated local database, row preservation, long-reference round trips, and real
  message transactions/retry behavior in both messaging channels.
- Focused secure-storage/messaging run: **36 passed, 1 skipped, 0 failed** after
  the final delivery changes. Additional diagnostic/migration tests: **7 passed**,
  covering absent metadata/ledger/indexes, unsupported schema, safe logging,
  failed child processes and timeout continuation.
- Focused frontend attachment/viewer/retry/permit tests: **11 passed**.
- Final security/diagnostic regression after response-header cleanup: **22 passed**.
- Chrome regression: **1 passed**, using a valid two-page PDF. It verifies registrar/permit/chat preview, image enlargement,
  Office download fallback, missing-document feedback, mobile sizing and object
  URL cleanup. Chrome must run outside this sandbox; in-sandbox launch timed out.
- Frontend production build completes; Vite retains its existing empty React
  chunk warning. Whitespace/diff checks pass.

The native browser PDF viewer supplies multipage scrolling and, where supported,
zoom, print and save. Mobile/browser PDF support varies; Open Document and
Download remain available. Browser checks use controlled fixtures, not production
credentials or real registration documents. Production restart durability,
provider policy and real-account acceptance remain unverified.

## 7. Render environment and deployment sequence

No new secret or environment variable is required by the temporary diagnostic.
Reuse the existing production database variables. For existing Cloudinary-backed
message/proof storage verify `OBJECT_STORAGE_PROVIDER=cloudinary`,
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` privately in
Render. Preserve existing upload limits and Vite API configuration.

1. Review and approve a diagnostic-only commit/deployment using the exact
   commands in the [Render runbook](production-messaging-diagnostic.md).
2. Collect schema-only runtime Logs; identify Aiven's actual missing/incompatible
   components. Restore the original Start Command after collection.
3. Separately review the migration plan and back up the database and accessible
   files. Aiven documents [backup/restore with mysqldump](https://aiven.io/docs/products/mysql/howto/migrate-database-mysqldump).
   Use password prompting and TLS/CA verification, keep backups outside Git,
   and test restore to a separate database. Do not restore over production for
   a routine code rollback.
4. Wait for explicit approval of the exact production schema changes. Apply
   only that reviewed additive migration through an approved secure connection;
   no `--apply` is part of the diagnostic deployment.
5. Re-run read-only checks, then separately approve backend/frontend releases.
   Exercise controlled accounts for all four roles, direct/group/course/batch
   history, images/PDF/Office, denied access, oversized/missing files and refresh.
6. Verify permitted originals survive a controlled restart on the selected
   persistent storage. Do not claim production fixed until those checks pass.

On code rollback, keep widened reference columns and the retry ledger; narrowing
or dropping them risks data loss. Disable the temporary startup command first.
If database recovery is necessary, restore to a separate reviewed target and
reconcile post-backup messages before any approved cutover. This task performs
none of those production actions.
