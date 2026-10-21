const db = require("../models");
const { validateAcademicProgram } = require("../utils/academicPrograms");
const lockRecordWrites = require("../utils/alumniRecordsWriteLock");
const { parseCsv, validateCsv, classifyDuplicates, csvError } = require("../utils/alumniRecordsCsv");

exports.importCsv = async (req, res) => {
    try {
        const mode = req.body?.mode;
        if (!["preview", "import"].includes(mode)) throw csvError("Choose preview or import mode.");
        if (!req.file?.buffer) throw csvError("Choose a CSV file to import.");
        const parsed = parseCsv(req.file.buffer);
        const validation = validateCsv(parsed, { deferAcademicValidation: true });
        const review = async (transaction, persist = false) => {
            const duplicates = classifyDuplicates(validation.validRows, []);
            const accepted = [];
            const academicIssues = [];
            // Database equality is authoritative: its case/accent collation may
            // differ from JavaScript. Importing inside this loop also catches
            // collation-equivalent names within the same file.
            for (const row of duplicates.accepted) {
                const record = row.record;
                const conditions = [{ full_name: record.full_name, course: record.course, batch_year: record.batch_year }];
                if (record.student_id) conditions.push({ student_id: record.student_id });
                if (record.email) conditions.push({ email: record.email });
                const existing = await db.AlumniRecord.findOne({
                    where: { [db.Sequelize.Op.or]: conditions }, attributes: ["id"],
                    ...(transaction ? { transaction } : {})
                });
                if (existing) {
                    duplicates.issues.push({ row: row.row, kind: "duplicate", message: "This alumni record already exists and will be skipped." });
                } else {
                    try { Object.assign(record, validateAcademicProgram(record.course, record.major)); }
                    catch (error) { academicIssues.push({ row: row.row, kind: "invalid", message: error.message }); continue; }
                    if (persist) await db.AlumniRecord.create(record, { transaction, validate: true });
                    accepted.push(row);
                }
            }
            const issues = [...validation.issues, ...academicIssues, ...duplicates.issues].sort((a, b) => a.row - b.row);
            return {
                total: parsed.rows.length,
                valid: accepted.length,
                duplicates: duplicates.issues.length,
                errors: validation.issues.length + academicIssues.length,
                issues,
                accepted
            };
        };
        if (mode === "preview") {
            const result = await review();
            const { accepted, ...summary } = result;
            return res.json({ msg: "CSV reviewed. Confirm to save the valid records.", mode: "preview", ...summary, preview: accepted.slice(0, 20).map(({ row, record }) => ({ row, full_name: record.full_name, course: record.course, major: record.major, batch_year: record.batch_year })) });
        }

        const result = await db.sequelize.transaction(async (transaction) => {
            await lockRecordWrites(transaction);
            const result = await review(transaction, validation.issues.length === 0);
            if (result.errors) throw Object.assign(csvError("Fix all invalid rows and review the CSV again before importing.", 422), { details: result });
            if (result.accepted.length) {
                await db.AuditLog.create({
                    actor_id: req.user.id, actor_role: "admin", action: "alumni.records.csv_imported",
                    target_type: "alumni_records", target_id: null,
                    metadata: { total: result.total, inserted: result.accepted.length, duplicates: result.duplicates },
                    ip_address: req.ip || null
                }, { transaction });
            }
            return result;
        });
        return res.status(result.accepted.length ? 201 : 200).json({
            msg: result.accepted.length ? `Imported ${result.accepted.length} alumni record(s). ${result.duplicates} duplicate row(s) skipped.` : "No new records imported; all rows already exist.",
            mode: "import", total: result.total, inserted: result.accepted.length, duplicates: result.duplicates, errors: 0, issues: result.issues
        });
    } catch (error) {
        if (error.details) {
            const { accepted, ...details } = error.details;
            return res.status(error.status).json({ msg: error.message, ...details });
        }
        if (error.name === "SequelizeUniqueConstraintError") return res.status(409).json({ msg: "Records changed while importing. No rows were saved. Review the CSV again." });
        if (error.status) return res.status(error.status).json({ msg: error.message });
        console.error("[alumni-csv-import] Import failed:", error.name);
        return res.status(500).json({ msg: "The import could not be saved. No rows were imported. Please try again." });
    }
};
