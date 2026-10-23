const { Op } = require("sequelize");
const { programs, validateAcademicProgram } = require("../utils/academicPrograms");
const db = require("../models");
const lockRecordWrites = require("../utils/alumniRecordsWriteLock");
const { tolerantNameWhere } = require("../utils/alumniNameSearch");

exports.getAlumniRecords = async (_req, res) => {
    try {
        // Official Master List hierarchy (Course → Batch → Students)
        // Source of truth: AlumniRecord only (course, batch_year, full_name)
        // Overlays: AlumniProfile (address, employment_status, current_company, job_title)

        const records = await db.AlumniRecord.findAll({
            attributes: ["id", "full_name", "student_id", "email", "course", "major", "batch_year", "createdAt"],
            include: [
                {
                    model: db.User,
                    required: false,
                    attributes: ["id", "account_status"],
                    include: [
                        {
                            model: db.AlumniProfile,
                            required: false,
                            attributes: ["employment_status", "current_company", "job_title", "address"]
                        }
                    ]
                }
            ],
            order: [["course", "ASC"], ["batch_year", "DESC"], ["full_name", "ASC"]]
        });

        console.log("[ALUMNI_RECORDS]", records.length, "records payload", records.slice(0, 2));
        res.json(records);
    } catch (err) {
        console.error("[GET_ALUMNI_RECORDS_ERR]", err);
        res.status(500).json({ msg: err.message });
    }
};

exports.searchAlumniRecords = async (req, res) => {
    try {
        const name = String(req.query.name || "").trim();
        if (!name) return res.json([]);

        const where = {
            [Op.or]: [
                { full_name: { [Op.like]: `%${name}%` } },
                { course: { [Op.like]: `%${name}%` } },
                { major: { [Op.like]: `%${name}%` } }
            ]
        };

        const matchingPrograms = programs.filter(program => [program.value, program.label, ...program.aliases].some(value => value.toLowerCase().includes(name.toLowerCase())));
        if (matchingPrograms.length) where[Op.or].push({ course: { [Op.in]: matchingPrograms.flatMap(program => [program.value, program.label, ...program.aliases]) } });

        const batchYear = Number(name);
        if (!Number.isNaN(batchYear)) {
            where[Op.or].push({ batch_year: batchYear });
        }

        const searchOptions = {
            where,
            attributes: ["id", "full_name", "course", "major", "batch_year"],
            include: [
                {
                    model: db.User,
                    required: false,
                    attributes: ["id"],
                    include: [
                        {
                            model: db.AlumniProfile,
                            required: false,
                            attributes: ["address"]
                        }
                    ]
                }
            ],
            order: [["full_name", "ASC"]],
            limit: 25
        };
        let records = await db.AlumniRecord.findAll(searchOptions);
        if (!records.length) {
            const fallback = tolerantNameWhere(name);
            if (fallback) records = await db.AlumniRecord.findAll({ ...searchOptions, where: fallback });
        }

        res.json(records);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};


exports.createAlumniRecord = async (req, res) => {
    let transaction;
    try {
        const { full_name, student_id, course, batch_year, email } = req.body;
        if (!full_name || !course || !batch_year) {
            return res.status(400).json({ msg: "Full name, course, and batch year are required." });
        }
        const academic = validateAcademicProgram(course, req.body.major);
        transaction = await db.sequelize.transaction();
        await lockRecordWrites(transaction);

        // Duplicate prevention: Priority 1 - Check student_id (strict unique)
        if (student_id) {
            const existingByStudentId = await db.AlumniRecord.findOne({
                transaction,
                where: { student_id: String(student_id).trim() }
            });
            if (existingByStudentId) {
                await transaction.rollback();
                return res.status(409).json({
                    success: false,
                    message: "Alumni record already exists."
                });
            }
        }

        // Duplicate prevention: Priority 2 - Check email (case-insensitive unique)
        if (email) {
            const existingByEmail = await db.AlumniRecord.findOne({
                transaction,
                where: {
                    email: { [Op.like]: email.trim() }
                }
            });
            if (existingByEmail) {
                await transaction.rollback();
                return res.status(409).json({
                    success: false,
                    message: "Alumni record already exists."
                });
            }
        }

        // Duplicate prevention: Priority 3 - Check full_name + course + batch_year (fallback)
        const existingByCombination = await db.AlumniRecord.findOne({
            transaction,
            where: {
                full_name: String(full_name).trim(),
                course: String(course).trim(),
                batch_year: Number(batch_year)
            }
        });
        if (existingByCombination) {
            await transaction.rollback();
            return res.status(409).json({
                success: false,
                message: "Alumni record already exists."
            });
        }

        const record = await db.AlumniRecord.create({
            full_name,
            student_id: student_id || null,
            ...academic,
            batch_year,
            email: email || null
        }, { transaction });

        // Fetch the created record with overlays to match getAlumniRecords response format
        const createdWithOverlays = await db.AlumniRecord.findByPk(record.id, {
            transaction,
            attributes: ["id", "full_name", "student_id", "email", "course", "major", "batch_year", "createdAt"],
            include: [
                {
                    model: db.User,
                    required: false,
                    attributes: ["id", "account_status"],
                    include: [
                        {
                            model: db.AlumniProfile,
                            required: false,
                            attributes: ["employment_status", "current_company", "job_title", "address"]
                        }
                    ]
                }
            ]
        });

        await transaction.commit();
        res.status(201).json(createdWithOverlays);
    } catch (err) {
        if (transaction && !transaction.finished) await transaction.rollback();
        res.status(err.status || 500).json({ msg: err.message });
    }
};

exports.deleteAlumniRecord = async (req, res) => {
    let transaction;
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({ msg: "Valid alumni record ID is required." });
        }

        transaction = await db.sequelize.transaction();
        const record = await db.AlumniRecord.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (!record) {
            await transaction.rollback();
            return res.status(404).json({ msg: "Alumni record not found." });
        }

        const linkedAccounts = await db.User.count({
            where: { alumni_record_id: id },
            transaction
        });
        if (linkedAccounts > 0) {
            await transaction.rollback();
            return res.status(409).json({
                msg: "This alumni record is linked to a registered account and cannot be deleted."
            });
        }

        await record.destroy({ transaction });
        await transaction.commit();

        console.log("[DELETE_ALUMNI_RECORD] Deleted record ID:", id);
        res.json({ success: true, msg: "Alumni record deleted successfully." });
    } catch (err) {
        if (transaction && !transaction.finished) await transaction.rollback();
        console.error("[DELETE_ALUMNI_RECORD_ERR]", err);
        if (err.name === "SequelizeForeignKeyConstraintError") {
            return res.status(409).json({ msg: "This alumni record has linked data and cannot be deleted." });
        }
        res.status(500).json({ msg: "Unable to delete alumni record. Please try again." });
    }
};

exports.updateAlumniRecord = async (req, res) => {
    let transaction;
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ msg: "Valid alumni record ID is required." });
        transaction = await db.sequelize.transaction();
        await lockRecordWrites(transaction);
        const record = await db.AlumniRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!record) {
            await transaction.rollback();
            return res.status(404).json({ msg: "Alumni record not found." });
        }
        const has = field => Object.prototype.hasOwnProperty.call(req.body, field);
        const course = has("course") ? req.body.course : record.course;
        const major = has("major") ? req.body.major : course === record.course ? record.major : null;
        const academic = validateAcademicProgram(course, major, { previous: record });
        const values = { ...academic, full_name: String(req.body.full_name ?? record.full_name).trim(), batch_year: Number(req.body.batch_year ?? record.batch_year) };
        if (!values.full_name || values.full_name.length > 255 || !Number.isInteger(values.batch_year)) {
            throw Object.assign(new Error("Enter a full name and valid batch year."), { status: 400 });
        }
        for (const field of ["student_id", "email"]) if (has(field)) values[field] = String(req.body[field] || "").trim() || null;
        const identities = [{ full_name: values.full_name, course: academic.course, batch_year: values.batch_year }];
        const student = has("student_id") ? values.student_id : record.student_id;
        const email = has("email") ? values.email : record.email;
        if (student) identities.push({ student_id: student });
        if (email) identities.push({ email: { [Op.like]: email } });
        const duplicate = await db.AlumniRecord.findOne({ where: { id: { [Op.ne]: id }, [Op.or]: identities }, transaction });
        if (duplicate) throw Object.assign(new Error("Alumni record already exists."), { status: 409 });
        await record.update(values, { transaction });
        await transaction.commit();
        res.json(record);
    } catch (error) {
        if (transaction && !transaction.finished) await transaction.rollback();
        res.status(error.status || 500).json({ msg: error.message });
    }
};
