# Government agency employer registration

## Registration flow

Employer registration remains on `/register/employer` and keeps the existing Gmail OTP and employer approval workflow. New registrations submit `organization_type` as `private_business` or `government_agency`. Missing organization type is treated as `private_business` by the backend for compatibility with existing clients.

Private businesses continue submitting one to five PNG, JPG/JPEG, or PDF permit files through `POST /api/auth/register`. Government agencies submit required agency and authorized-representative details, a required PNG/JPG signature, an optional PNG/JPG seal, the generated authorization PDF, and a short-lived preview token through that same registration endpoint.

`POST /api/auth/employer-government-agency/consent-preview` validates the form and image uploads, generates the A4 PDF, and returns it as base64 with an HMAC token. The token binds the normalized details, signature, optional seal, and exact PDF bytes; it expires after 30 minutes. Registration rejects an absent, expired, or mismatched token/PDF and persists those exact PDF bytes rather than generating a replacement. The preview itself is held in browser memory until registration succeeds; it is not saved as a draft.

The verified Gmail registration, pending employer account, agency details, and document references are committed in the existing registration transaction. New accounts remain pending administrator review. Failed submissions do not create an account; request-owned uploaded images and the uncommitted PDF are cleaned up where storage permits.

## Private document access and storage

Signatures, optional seals, and authorization PDFs are private documents. The admin list returns sanitized metadata and API paths, not provider references. Retrieval is restricted to authenticated administrators with the employer scope at:

`GET /api/admin/employer/users/:userId/government-agency-documents/:documentType`

Allowed document types are `signature`, `seal`, and `authorization_pdf`. Add `?download=1` for an attachment response. No static public URL is issued.

In production, configure the existing private Cloudinary object storage (`OBJECT_STORAGE_PROVIDER=cloudinary`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`). The feature fails closed if private storage is not configured; local-file storage is only a development fallback. This implementation does not detect or depend on a Render persistent disk. Confirm the production storage configuration before enabling government registrations.

## Database rollout

Migration `20261020-add-government-agency-employer-registration.js` adds nullable `organization_type`, `government_agency_details`, and `government_agency_documents` fields to `employerprofiles`. Existing employer rows remain valid. Automatic rollback is intentionally disabled so organization data and private document references cannot be dropped accidentally.

The migration has **not** been applied to any database. Review it against the target schema and follow the approved deployment/migration procedure before deploying code that uses these fields. Do not run it against production without explicit authorization.

## Institutional review

The government declaration is newly introduced and must be reviewed and approved by the institution's authorized privacy/legal reviewers before production use. An uploaded signature image is not treated as proof of legal authority; every account remains subject to administrative verification.
