# Registrar alumni CSV import

The Import CSV button is beside Add Alumni Record at `/admin/registrar/records`.
The existing manual-add and verification workflows continue to use AlumniRecord.
No database migration or new package is required.

## CSV format

Save as UTF-8 CSV with the required headers `full_name,course,batch_year`.
Optional headers are `student_id,email`; their empty values are stored as NULL.
Columns may be in any order. Unknown or repeated headers are rejected.

Example:

```csv
full_name,course,batch_year,student_id,email
"Dela Cruz, Maria",BSIT,2024,2024-001,maria@example.com
```

Limits: 2 MB per upload and 1,000 data rows. Text fields must fit the existing
255-character columns. Batch years must be four digits between 1900 and next
year. Invalid email addresses, control characters, and formula-leading cells
(`=`, `+`, `-`, `@`) are rejected. Quoted commas and escaped double quotes are
supported. Non-empty multiline field values fail record validation.

## API and behavior

`POST /api/alumni-records/import-csv` accepts multipart field `file` and field
`mode` (`preview` or `import`). Existing authentication, admin role, and registrar
scope middleware run before upload parsing. Files stay in memory and are not
published or saved to disk.

Preview returns counts, row issues, and up to 20 ready records without writes.
Import revalidates the file and checks current database duplicates. Any invalid
row blocks the whole import. Duplicates by student ID, email, or name/program/
batch are skipped. Database case and accent comparisons are authoritative for
insertion, so a final count can differ from preview when equivalent values or
new records are detected at confirmation.

All inserts and the import audit event commit in one transaction. Failed writes
roll back every inserted row. Import and manual creation lock the same registrar
account row before duplicate checks to serialize concurrent writes. Reposting
the same file skips the already imported records. Existing records and linked
accounts are never updated by an import; importing does not verify accounts.

## Verification

From `backend`: `node --test tests/alumniCsvImport.test.js`

From `frontend/alumni-portal`: `npm.cmd run build`
