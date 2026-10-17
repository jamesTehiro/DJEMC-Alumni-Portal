# Message attachment retrieval and deployment

The local database inspection found `messages.file_url` and
`employermessages.attachment` still defined as VARCHAR(255), despite their TEXT
model declarations. Two sampled Cloudinary references were truncated at 255
characters, before their delivery URLs ended. The old download controller could
not decode these values and treated them as local filenames, producing
"Stored file not found." Local records also lost their directory information
because retrieval searched only a single private directory by basename.

Both download controllers now use `messageAttachmentStorage.js` after their
existing conversation authorization. It resolves local upload paths, old machine
paths, backend URLs, API paths and bare filenames within the existing chat and
admin_employer directories. The shared filesystem resolver checks containment,
real paths and symlinks. Original filenames use safe UTF-8 response headers.
Cloud assets are proxied; authenticated Cloudinary references use signed delivery.
Responses remain private and are never redirected to a public upload route.

For truncated Cloudinary chat references, recovery requires a complete provider,
resource type, delivery type and public ID. An authenticated read of Cloudinary's
resource API verifies that the asset exists and returns its real secure URL.
Incomplete identifiers and missing assets return 404. Provider failures return a
temporary storage error. Recovery does not create, replace, delete or rewrite an
asset or database record. It uses Cloudinary Admin API quota for each legacy
lookup. It cannot restore files already lost from disk or deleted from Cloudinary.

New production uploads use the existing Cloudinary storage engine with
`deliveryType: authenticated`. Configure the backend with:

- `OBJECT_STORAGE_PROVIDER=cloudinary`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Credentials remain server-side. Without configured object storage, attachment
writes are rejected in production/Render with a useful 503 response; text-only
messages continue working. There is no fallback to Render's temporary disk.
Render documents its filesystem persistence rules at https://render.com/docs/disks.
No Render account/deployment configuration is present in this workspace, so its
actual environment variables and disk mounts require verification there.

Apply the existing [reference-column migration](chat-attachment-reference-migration.md)
to the intended Render/Aiven database. From the backend directory, inspect first:

```sh
node scripts/applyChatAttachmentReferenceMigration.js --database ACTUAL_DB_NAME --host ACTUAL_AIVEN_HOST
```

Then apply with the same reviewed identity and `--apply`. Preserve normal backup
and deployment procedures. This only widens the reference columns and preserves
rows. The connected local development database was widened and all attachment
references compared before and after; its reference snapshot is under `tmp/`.
Deploy the backend and rebuilt frontend together. Verify an authorized upload,
preview and download in production, then verify denial for an unrelated user.

Frontend attachment actions now use the existing `fetchFile` URL resolver and
status-specific errors, with separate Open and Download actions. No storage path
or Cloudinary reference is used as a client attachment identifier: the API returns
the message-ID endpoint for each attachment.

Admin Alumni routes share `AdminAlumniLayout`, keeping the sidebar and its
server-confirmed membership grant mounted while the main route changes, including
lazy loading. Existing page shells supply header/logout data through context.
Employer and Registrar retain their existing layout behavior. Membership still
requires the backend's verified Admin Alumni account and active administrator grant.

Regression checks:

```sh
# backend
node --test tests/messageAttachmentStorage.test.js tests/chatAttachmentAccess.test.js tests/chatAttachmentRoundTrip.test.js tests/chatAttachmentMigration.test.js tests/objectStorageReferences.test.js tests/messageDeletionPermissions.test.js
# frontend/alumni-portal
node --test tests/messageAttachments.test.js tests/adminSidebar.browser.test.js tests/apiConnection.test.js tests/portalDrawer.test.js tests/membershipManagement.test.js
npm run build
```

The browser regression uses the installed Puppeteer dependency, fixture accounts
and a local test server. It checks actual sidebar/link DOM identity, active links,
headers, delayed route loading, denied membership access, and Employer/Registrar
menu order. Set `CHAT_ATTACHMENT_DB_TEST=1` for the existing database round-trip
test, which uses a connection-local temporary table rather than application rows.
If Puppeteer's cached Chrome is unavailable, set `PUPPETEER_EXECUTABLE_PATH` to
a working Chrome executable. Tests use a temporary browser profile.

## Verified results

- Backend command above with `CHAT_ATTACHMENT_DB_TEST=1`: 26 passed, 0 failed,
  0 skipped. This includes the real local database temporary-table round trip.
- New frontend attachment tests: 3 passed. Sidebar Chrome regression: 2 passed.
  It observed zero sidebar/membership-link removals and exactly one sidebar
  permission request across all seven menu destinations, including a delayed
  lazy route. Employer/Registrar menu order and denied membership access passed.
- Related frontend suite (`messageAttachments`, `apiConnection`, `portalDrawer`,
  `membershipManagement`): 21 passed, 3 failed. The failures are existing
  membership-management expectations for a status query filter, summary-response
  validation, and a Status table column. Their implementation files and test
  contents are unchanged by this fix. Sidebar/authorization assertions passed.
- Frontend production build: passed. `git diff --check`: passed.
- Actual existing attachment records 77 and 78: recovered from their truncated
  references and delivered 77,761 and 247,809 bytes respectively through the
  storage service using read-only provider requests. No assets or rows rewritten.
- Local schema: both attachment reference columns widened to TEXT. Before/after
  reference values matched. Snapshot retained at
  `tmp/uploads/chat-reference-backup-1792275440177.json` (ignored by Git).
- Render production deployment, its environment variables/disk mounts and its
  database were not accessed or modified. Deploy and apply the identity-checked
  migration there before declaring the deployed issue resolved.

## Files changed

- `backend/controllers/messageController.js`
- `backend/controllers/adminEmployerMessageController.js`
- `backend/middleware/uploadMiddleware.js`
- `backend/services/objectStorage.js`
- `backend/services/messageAttachmentStorage.js` (new)
- `backend/tests/messageAttachmentStorage.test.js` (new)
- `backend/docs/message-attachment-storage.md` (new)
- `frontend/alumni-portal/src/App.jsx`
- `frontend/alumni-portal/src/components/AdminShell.jsx`
- `frontend/alumni-portal/src/components/AdminAlumniLayout.jsx` (new)
- `frontend/alumni-portal/src/components/AdminShellContext.js` (new)
- `frontend/alumni-portal/src/components/MessageAttachment.jsx`
- `frontend/alumni-portal/src/pages/MessagesPage.jsx`
- `frontend/alumni-portal/src/pages/EmployerMessagesPage.jsx`
- `frontend/alumni-portal/src/pages/AdminAlumniMessagesPage.jsx`
- `frontend/alumni-portal/tests/adminSidebar.browser.test.js` (new)
- `frontend/alumni-portal/tests/messageAttachments.test.js` (new)
