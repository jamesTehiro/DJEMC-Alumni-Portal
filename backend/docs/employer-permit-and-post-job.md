# Employer permit persistence and Post Job changes

## Findings and scope

Employer and Admin Employer already share JobPostingForm. Salary & Benefits
inputs are removed there; six remaining sections number themselves in render
order. Frontend validation no longer requires compensation, new forms default
to optional negotiable compensation, and legacy API creation no longer requires
expected_salary. Existing supplied salary/benefits, advertisement rendering,
database columns, requirements, interview settings and notification triggers
are retained. Explicitly supplied malformed salary data is still validated by
the backend; omission is allowed.

Employer registration already appended business_permit to FormData and the
backend registration route already parsed that field. The current code exposed
two persistence risks: EmployerProfile.business_permit_path was STRING(255),
too small for encoded Cloudinary JSON; and findOrCreate defaults were ignored
when a profile already existed with a null permit. Registration now updates
and reloads the reference inside its transaction before returning success.
An unsuccessful write rolls back account creation. Storage errors and missing
upload references do not produce a successful registration response.

The local database check confirms the permit column is VARCHAR(255). Production
Aiven was not inspected. A historical null alone cannot prove whether an older
deployment omitted the upload, a profile existed already, or another write path
lost it. No upload can be reconstructed from null without an original asset or
reference. The fixes cover the demonstrated code/schema risks without claiming
an unverified production history.

New permits use authenticated Cloudinary delivery and signature validation.
Production refuses a local-disk fallback for permit uploads when Cloudinary is
unconfigured. PDF/PNG/JPG/JPEG/WEBP/GIF support and MAX_UPLOAD_MB are retained.
Unsupported/mismatched file types and oversized files fail with useful errors.
These permit-specific changes do not alter alumni or messaging upload behavior.

Admin verification previously inferred file type from an encoded secure API
path and eagerly managed preview blobs without guarding stale requests. It now
uses filename metadata plus authenticated Blob fetching in BusinessPermitPreview,
with image/PDF display, loading/error states, Open Document, Download, and object
URL cleanup. JWTs never go into URLs; private Cloudinary credentials/URLs are
not published. Only employer-scoped admins can retrieve permit files.

Admin Employer verification also has an explicit replacement-upload control.
The employer supplies the original document to the admin through the existing
support process; the admin uploads it to that employer's existing profile.
PUT /api/admin/employer/users/:userId/business-permit is protected by existing
JWT, admin-role and employer-scope middleware before upload. It never creates
a duplicate user, changes verification status, or runs approval/rejection/email
actions. Older stored files are not deleted during replacement.

## Required non-destructive migration

The model now uses TEXT. Run the targeted migration through the existing
identity-checked standalone repair process, not sync({ alter:true }). Back up
the intended database and choose a quiet DDL window. From Render's backend
working directory, first review the check-only report:

```sh
node scripts/applyEmployerPermitMigration.js --database ACTUAL_AIVEN_DB --host ACTUAL_AIVEN_HOST
```

Then apply with the same reviewed host/database:

```sh
node scripts/applyEmployerPermitMigration.js --apply --database ACTUAL_AIVEN_DB --host ACTUAL_AIVEN_HOST
```

The runner uses existing DB environment credentials and TLS settings. It is
read-only unless --apply is supplied and refuses mismatched identity. The
migration widens only employerprofiles.business_permit_path and skips existing
TEXT/MEDIUMTEXT/LONGTEXT. It preserves nullability, charset, collation and comments,
and stops for unexpected defaults/indexes. It deletes no data, commits no
account changes and refuses destructive narrowing on rollback. MySQL DDL commits
independently; safe partial application can be rerun.

For the nullable local definition, exact SQL is:

```sql
ALTER TABLE `employerprofiles` MODIFY COLUMN `business_permit_path`
TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '';
```

Production's discovered charset/collation/comment/nullability determine its
equivalent generated statement. Do not substitute a nullable definition for
a NOT NULL column. No migration was applied to local application tables or Aiven
during this task; only the read-only local schema check ran.

## Existing documents

Valid cld: references remain unchanged. Existing /api/files/documents/... and
/uploads/documents/... paths remain supported with authorization. Local files
are accessible only if the bytes still exist on the deployed Render instance;
ephemeral files lost on redeploy cannot be recreated from a path. No production
filesystem was inspected. Restore from an existing backup or use the explicit
admin replacement flow. Null paths continue to display No business permit
uploaded until an actual file is saved.

## Files changed

- frontend/alumni-portal/src/components/jobs/JobPostingForm.jsx
- frontend/alumni-portal/src/utils/jobPosting.js
- frontend/alumni-portal/src/components/BusinessPermitPreview.jsx
- frontend/alumni-portal/src/pages/admin/AdminVerificationPage.jsx
- frontend/alumni-portal/tests/jobPosting.test.js
- backend/controllers/authController.js
- backend/controllers/adminController.js
- backend/controllers/fileController.js
- backend/controllers/employerPermitController.js
- backend/middleware/uploadMiddleware.js
- backend/routes/adminRoutes.js
- backend/models/EmployerProfile.js
- backend/services/jobPosting.js
- backend/migrations/20261017-expand-employer-permit-reference.js
- backend/scripts/applyEmployerPermitMigration.js
- backend/tests/employerPermitWorkflow.test.js
- backend/tests/employerPermitMigration.test.js
- backend/tests/jobPosting.test.js
- backend/docs/employer-permit-and-post-job.md

## Deployment and post-deploy verification

1. Commit the reviewed task files, preserving other workspace changes. Push to
   the branch connected to the existing Render backend service.
2. Deploy the migration/runner commit to Render. Preserve its backend root,
   existing dependency-install build steps and npm start command. Run the
   check-only/apply commands above in Render Shell or an approved pre-deploy
   command. If Shell is unavailable, temporarily append the reviewed command
   to the existing Build Command, preserving existing steps; at repo root use
   node backend/scripts/applyEmployerPermitMigration.js. Remove temporary apply
   suffixes after success. Rerun check-only, confirm TEXT and restart the backend.
3. Retain existing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
   CLOUDINARY_API_SECRET and OBJECT_STORAGE_PROVIDER=cloudinary settings. Never
   commit or print their secret values. Do not change production secrets as
   part of this patch.
4. Build and publish the frontend with its existing Render API base:

```powershell
Set-Location C:\Alumni\frontend\alumni-portal
npm.cmd ci
npm.cmd run build
npx.cmd firebase-tools deploy --only hosting --project djemc-alumni-portal
```

5. Using controlled accounts, register one PNG and one PDF permit. Confirm each
   newly stored reference is non-null in the intended Aiven database, appears in
   the authorized Admin Employer response, and previews/downloads after the
   backend is restarted. Confirm missing/invalid/oversized uploads fail clearly,
   unauthorized users cannot fetch the permit, and explicit replacement leaves
   the account status unchanged. Verify Approve/Reject through the existing
   controlled verification process. Publish a job from both posting roles with
   no salary/benefits input and confirm existing notifications.

Production upload success is not claimed until this controlled registration and
document verification succeeds after deployment. Local HTTP tests mock Cloudinary
and database methods; they do not establish real Aiven/Cloudinary availability.

## Checks

```sh
# backend (no separate backend build script exists)
node --test tests/employerPermitWorkflow.test.js tests/employerPermitMigration.test.js tests/jobPosting.test.js
# frontend
node --test tests/jobPosting.test.js
npm run build
```

The multipart HTTP regression test covers PNG/PDF uploads, an existing null
profile, durable reference metadata, authenticated signed delivery, denied
access, oversized/invalid contents, failed persistence, and admin replacement.
Job tests preserve legacy salary data and notification behavior. Live browser
and production verification remain separate post-deployment checks.
