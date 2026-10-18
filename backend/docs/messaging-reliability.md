# Messaging reliability investigation

## Confirmed defects and limits

This change is verified locally. Production Render exceptions and an authenticated
production browser session were not available. The observed IDs have not been
assumed to identify users or to share a cause.

| Observed request | Evidence and conclusion |
| --- | --- |
| `GET /api/admin-employer/messages/6` | The actual history serializer referenced `getStoredFileOriginalName` without importing it. A regression test reproduced `ReferenceError` on text-only and legacy attachment rows. Importing the helper fixes this path. Confirm the production exception in Render logs. |
| `POST /api/messages/26` with attachment | Exact production exception remains unknown. The multipart integration path now passes. Local oldest/newest attachment rows contained 255-character truncated `cld:` references, although the current local reference columns are TEXT. This establishes historical truncation locally, not that production conversation 26 has the same defect. |
| `POST /api/messages/3` | Exact production exception remains unknown. Numeric parameters resolve conversation primary keys; employer direct-send authorization and sending pass regression tests. Check Render's database error code and deployed schema. |
| `POST /api/messages/1` | Exact production exception remains unknown. Scoped alumni-admin sending and history pass regression tests. Check Render logs and schema rather than inferring a relationship from the number. |
| `GET /api/messages/files/80` | The configured local database has no Message 80. Its production record/storage state is unverified. A missing message row, a genuinely absent local file and a provider-confirmed missing object remain 404; malformed references are 400 and provider outages/rejections are safe 502/503. |

Additional confirmed defects: the employer serializer generated attachment links
for text-only rows; both send controllers committed a message before separately
updating the conversation summary; and the old attachment migration runner targeted
uppercase names despite the models targeting lowercase tables. A summary error
could therefore return 500 after insertion, permitting duplicate messages on retry.
Missing production columns have not been asserted without the production schema.

## Final behavior

Messages, conversation summaries and optional retry identities commit in one
transaction under a conversation row lock. All four clients submit a stable
`client_message_id`, reused when retrying the same failed draft. A replay returns
the original message and does not rebroadcast it. The identity is scoped to sender,
channel and conversation; changed payloads with the same identity receive 409.
Older clients without this field remain compatible, but need a retry identity to
deduplicate after a lost response. Re-uploading an attachment on retry can leave an
unused storage asset; no automatic file deletion was introduced.

After insertion the service reads back attachment metadata within the transaction.
Any silent truncation causes rollback and a safe schema-update response. Uploads
continue to save the provider's actual returned storage reference. Legacy `cld:`,
Cloudinary URL, local path, filename and historical backend/API reference handling
is retained. Existing complete-identity recovery checks Cloudinary metadata before
retrieving a truncated legacy reference; it never guesses missing identifiers.
The two sampled local legacy assets returned HTTP 200 using read-only metadata and
HEAD probes. No document contents were read by that diagnostic.

Authorization, scoped admin checks and conversation membership precede attachment
retrieval. Employer parameter scope is checked before creating/hydrating a legacy
conversation. Text-only rows return no attachment link. Legacy local filenames
provide MIME inference where metadata is absent; provider MIME remains available
for remote files. Responses use `private, no-store`, vary by Authorization and
ignore conditional cache validators. No public static attachment route was added.

Messaging logs report route templates, error class, sanitized database codes and
source filename/line; storage logs report classified provider failures, status and
an opaque reference fingerprint. They exclude message bodies, SQL values,
authorization headers, signed URLs and filesystem paths. Messaging search queries
are omitted from request logs.

## Files

- Controllers/routes: `controllers/messageController.js`,
  `controllers/adminEmployerMessageController.js`, `routes/messageRoutes.js`,
  `routes/adminEmployerMessageRoutes.js`.
- Persistence/model: `services/messagePersistence.js`,
  `models/MessageSendRequest.js`, `models/index.js`.
- Storage/diagnostics: `services/messageAttachmentStorage.js`,
  `services/objectStorage.js`, `middleware/uploadMiddleware.js`,
  `middleware/messagingErrorHandler.js`, `middleware/privateMessagingResponse.js`,
  `middleware/requestLogger.js`, `scripts/diagnoseMessaging.js`.
- Schema tooling: `migrations/20261018-repair-messaging-storage.js`,
  `scripts/repairMessagingStorage.js`, `scripts/applyMessageAttachmentMigrations.js`,
  `package.json`.
- Frontend: the four `*MessagesPage.jsx` pages and `utils/messageSendRequest.js`.
- Regression coverage: `tests/messagingReliability.test.js`,
  `tests/messagingRoutes.test.js`, `tests/messagingSchema.test.js`,
  `tests/messagePersistence.integration.test.js`, updates to attachment, forum and
  model mapping tests; frontend `tests/messageSendRequest.test.js`.

## Database and deployment

A migration is required for the new retry ledger. Missing messaging metadata and
short reference columns are repaired only when detected. There is no message-row
or attachment-reference rewrite, and no file migration/deletion. The repair refuses
missing/ambiguous canonical tables and unsupported constraints instead of creating
parallel history tables. Participant tables with their established composite key
are supported. MySQL DDL is not transactional; a failed additive step should be
reviewed and rerun. Retain widened fields and the ledger on code rollback.

Before releasing the frontend, run against the **actual backend database
environment** in the Render shell:

```sh
node scripts/diagnoseMessaging.js
npm run migrate:messaging-storage
# Review the check-only plan and confirm the configured database identity.
npm run migrate:messaging-storage -- --apply --database <actual_database_name> --host <actual_database_host>
npm run migrate:messaging-storage
```

The final command must report no changes. The old
`migrate:message-attachments` command now delegates to the same guarded runner and
defaults to check-only. Verify existing messaging tables use InnoDB so transactions
provide rollback; no table-engine conversion is performed automatically.
Deploy the backend and then the frontend. Confirm Cloudinary credentials and
durable storage are configured; local development files absent from Render cannot
be reconstructed by this fix. Optional `diagnoseMessaging.js --probe` performs
read-only provider metadata/HEAD checks and prints no references or URLs.

Collect sanitized Render exception class/code/location for each original failing
POST and the employer history request. Recheck the production Message 80 record
using the diagnostic under production environment settings. Then test text sends,
attachment sends, refresh/history, retry after a dropped response, both admin
scopes, employer/alumni direct conversations, and one valid legacy attachment in
the deployed UI. Verify access denials and private response headers. Production
must remain described as unverified until those checks succeed.

## Validation commands

```sh
cd backend
npm test
# Local MySQL only; writes exclusively to connection-local TEMPORARY tables.
# PowerShell: $env:MESSAGING_DB_TEST='1'; node --test tests/messagePersistence.integration.test.js
MESSAGING_DB_TEST=1 node --test tests/messagePersistence.integration.test.js
cd ../frontend/alumni-portal
node --test tests/messageAttachments.test.js tests/messageSendRequest.test.js
npm run build
cd ../..
git diff --check
```

The opt-in MySQL test checks actual SQL commits, rollback after a real SQL summary
failure, persisted history/metadata, concurrent retry deduplication, sender/thread
scope, payload conflicts and rollback on silent VARCHAR truncation in both channels.
HTTP tests use the real authenticated routers, multipart validation, upload/parser/
signing/retrieval code and serializer; only provider transport and database
boundaries are fixtures. They cover all four roles, text/attachment sends, history,
retries, unauthenticated/unauthorized and cross-conversation access, and safe
database/provider failures. Existing tests cover historical file formats and
missing content. The integration test is skipped during the default suite unless
explicitly enabled.

Validated locally on 2026-10-18: full backend suite **371 passed, 13 skipped,
0 failures**; opt-in MySQL test **1 passed**; frontend attachment/retry tests
**5 passed**; production build **exit 0** (existing empty React chunk warning);
`git diff --check` **passed**. Final targeted backend checks also passed after
sanitizing legacy display filenames. The local schema check requested only
creation of `message_send_requests`; no application schema migration was applied
by this investigation. Pre-existing registration and Firebase cache edits were
preserved.
