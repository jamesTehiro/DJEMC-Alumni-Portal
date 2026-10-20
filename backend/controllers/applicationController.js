const db = require("../models");
const { Op } = require("sequelize");
const notificationController = require("./notificationController");
const { encrypt, decrypt } = require("../utils/fieldEncryption");
const { toSecureFileUrl } = require("./fileController");
const auditService = require("../services/auditService");
const { isStoredFileReference, getStoredFileOriginalName, sendStoredFile } = require("../services/objectStorage");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const INVITATION_DETAIL_COLUMNS = {
    venue: "interview_venue",
    place: "interview_place",
    date: "interview_date",
    time: "interview_time",
    contact_info: "interview_contact_info",
    what_to_bring: "interview_what_to_bring"
};

const getJobInvitationDetails = (job) => Object.fromEntries(
    Object.entries(INVITATION_DETAIL_COLUMNS).map(([key, column]) => [key, String(job?.[column] || "").trim()])
);

const getMissingInvitationField = (details) =>
    ["venue", "place", "date", "time", "contact_info"].find((key) => !details[key]) || null;

const canUseEmployerInvitationWorkflow = (user) =>
    user?.role === "employer" || (user?.role === "admin" && user?.admin_scope === "employer");

const formatInvitationDate = (value) => {
    const [year, month, day] = String(value || "").split("-").map(Number);
    if (!year || !month || !day) return value;
    return new Date(year, month - 1, day).toLocaleDateString("en-PH", {
        year: "numeric", month: "long", day: "numeric"
    });
};

const buildInterviewInvitation = ({ applicantName, jobTitle, organizationName, details }) =>
    `Congratulations, ${applicantName}! You have been approved for an interview for the position of ${jobTitle}${organizationName ? ` at ${organizationName}` : ""}.\n\n` +
    `Interview Details\nVenue: ${details.venue}\nAddress: ${details.place}\nDate: ${formatInvitationDate(details.date)}\nTime: ${details.time}\nContact: ${details.contact_info}\nPlease bring: ${details.what_to_bring || "No additional items specified."}\n\n` +
    `Please contact the employer using the provided contact information if you have any questions.`;
const {
    Resume, ResumePersonalInfo, ResumeSummary, ResumeEducation, ResumeWorkExperience,
    ResumeSkill, ResumeProject, ResumeCertification, ResumeTraining, ResumeSeminar,
    ResumeAward, ResumeOrganization, ResumeVolunteerWork, ResumeLanguage, ResumeReference
} = require("../models");

const applicationFileMimeTypes = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png"
};

const getApplicationFileName = (storedPath) => {
    const originalName = getStoredFileOriginalName(storedPath);
    if (originalName) return path.posix.basename(String(originalName).replace(/\\/g, "/"));
    if (!storedPath || isStoredFileReference(storedPath)) return null;
    const normalizedPath = String(storedPath).replace(/\\/g, "/");
    try {
        return decodeURIComponent(path.posix.basename(new URL(normalizedPath).pathname)) || null;
    } catch {
        return path.posix.basename(normalizedPath) || null;
    }
};

const getApplicationFileMimeType = (fileName) =>
    applicationFileMimeTypes[path.extname(String(fileName || "")).toLowerCase()] || null;

const hydrateSensitiveFields = (application) => {
    const plain = application.toJSON ? application.toJSON() : { ...application };
    ["sss_no", "philhealth_no", "pagibig_no", "tin"].forEach((key) => {
        plain[key] = decrypt(plain[key]);
    });
    // Legacy applications keep the upload's original name inside the object-storage
    // reference. Local uploads predating document records only retain a stored name.
    plain.resume_file_name = getApplicationFileName(plain.resume_path);
    plain.resume_mime_type = getApplicationFileMimeType(plain.resume_file_name);
    plain.resume_path = plain.resume_path && plain.id
        ? `/api/applications/${plain.id}/resume/file`
        : toSecureFileUrl(plain.resume_path);
    plain.transcript_path = toSecureFileUrl(plain.transcript_path);
    plain.certificate_path = toSecureFileUrl(plain.certificate_path);
    // Normalize ApplicationDocument file_path values
    if (plain.ApplicationDocuments && Array.isArray(plain.ApplicationDocuments)) {
        plain.ApplicationDocuments = plain.ApplicationDocuments.map((doc) => {
            if (doc && doc.file_path) {
                return {
                    ...doc,
                    file_path: plain.id && doc.id
                        ? `/api/applications/${plain.id}/documents/${doc.id}/file`
                        : toSecureFileUrl(doc.file_path)
                };
            }
            return doc;
        });
    }
    return plain;
};

// Helper: build resume snapshot
const createResumeSnapshot = async (resumeId) => {
    const resume = await Resume.findByPk(resumeId);
    if (!resume) return null;

    const [personalInfo, summary, education, workExperience, skills, projects, certifications,
        trainings, seminars, awards, organizations, volunteerWork, languages, references] = await Promise.all([
            ResumePersonalInfo.findOne({ where: { resume_id: resumeId } }),
            ResumeSummary.findOne({ where: { resume_id: resumeId } }),
            ResumeEducation.findAll({ where: { resume_id: resumeId } }),
            ResumeWorkExperience.findAll({ where: { resume_id: resumeId } }),
            ResumeSkill.findAll({ where: { resume_id: resumeId } }),
            ResumeProject.findAll({ where: { resume_id: resumeId } }),
            ResumeCertification.findAll({ where: { resume_id: resumeId } }),
            ResumeTraining.findAll({ where: { resume_id: resumeId } }),
            ResumeSeminar.findAll({ where: { resume_id: resumeId } }),
            ResumeAward.findAll({ where: { resume_id: resumeId } }),
            ResumeOrganization.findAll({ where: { resume_id: resumeId } }),
            ResumeVolunteerWork.findAll({ where: { resume_id: resumeId } }),
            ResumeLanguage.findAll({ where: { resume_id: resumeId } }),
            ResumeReference.findAll({ where: { resume_id: resumeId } })
        ]);

    return {
        resume: resume.toJSON(),
        personalInfo: personalInfo?.toJSON(),
        summary: summary?.toJSON(),
        education: education.map(e => e.toJSON()),
        workExperience: workExperience.map(e => e.toJSON()),
        skills: skills.map(e => e.toJSON()),
        projects: projects.map(e => e.toJSON()),
        certifications: certifications.map(e => e.toJSON()),
        trainings: trainings.map(e => e.toJSON()),
        seminars: seminars.map(e => e.toJSON()),
        awards: awards.map(e => e.toJSON()),
        organizations: organizations.map(e => e.toJSON()),
        volunteerWork: volunteerWork.map(e => e.toJSON()),
        languages: languages.map(e => e.toJSON()),
        references: references.map(e => e.toJSON()),
        captured_at: new Date()
    };
};

// Helper: build snapshot data from job requirements
const buildSnapshotData = async (jobId, version) => {
    const requirements = await db.JobRequirement.findAll({
        where: { job_id: jobId, version },
        order: [["sort_order", "ASC"]]
    });

    const groups = await db.RequirementGroup.findAll({
        where: { job_id: jobId, version },
        order: [["sort_order", "ASC"]]
    });

    const groupedPreview = groups.map((group) => ({
        group_label: group.group_label,
        sort_order: group.sort_order,
        requirements: requirements
            .filter((r) => r.group_id === group.id)
            .map((r) => ({
                requirement_code: r.requirement_code,
                label: r.label,
                description: r.description,
                requirement_type: r.requirement_type,
                value_type: r.value_type,
                value_options: r.value_options,
                required: r.required,
                allowed_types: r.allowed_types,
                max_file_size: r.max_file_size,
                sort_order: r.sort_order
            }))
    }));

    const ungrouped = requirements
        .filter((r) => !r.group_id)
        .map((r) => ({
            requirement_code: r.requirement_code,
            label: r.label,
            description: r.description,
            requirement_type: r.requirement_type,
            value_type: r.value_type,
            value_options: r.value_options,
            required: r.required,
            allowed_types: r.allowed_types,
            max_file_size: r.max_file_size,
            sort_order: r.sort_order
        }));

    return { version, groups: groupedPreview, ungrouped };
};

// APPLY TO JOB
exports.applyJob = async (req, res, next) => {
    try {
        const {
            job_id,
            position_applied_for,
            department_office,
            employment_type,
            preferred_work_location,
            expected_salary,
            start_date,
            full_name,
            email,
            dob,
            place_of_birth,
            gender,
            contact_number,
            nationality,
            address,
            professional_summary,
            civil_service_eligibility,
            rating,
            license_number,
            validity,
            education,
            school,
            degree,
            years_attended,
            honors,
            company,
            position,
            employment_period,
            responsibilities,
            achievements,
            reason_for_leaving,
            skills,
            soft_skills,
            certifications,
            leadership_role,
            people_managed,
            leadership_achievements,
            training_title,
            training_organization,
            training_duration,
            training_date,
            reference_name,
            reference_position,
            reference_company,
            reference_contact,
            civil_status,
            disability,
            disability_other,
            employment_status,
            employment_type_detail,
            ofw,
            former_ofw,
            four_ps,
            preferred_occupation,
            preferred_work_type,
            preferred_location_type,
            preferred_location_detail,
            languages,
            currently_in_school,
            education_level,
            work_status,
            other_skills,
            other_skills_other,
            convicted_of_crime,
            dismissed_from_service,
            currently_employed,
            can_work_overtime,
            why_join,
            good_fit,
            career_goals,
            declaration_confirmed,
            notes,
            sss_no,
            philhealth_no,
            pagibig_no,
            tin
        } = req.body;

        const jobId = Number(job_id);
        if (!jobId) return res.status(400).json({ msg: "job_id is required." });

        const alumni = await db.User.findByPk(req.user.id);
        if (!alumni || alumni.role !== "alumni") {
            return res.status(403).json({ msg: "Alumni access only." });
        }

        if (alumni.account_status !== "verified") {
            return res.status(403).json({ msg: "Your alumni account must be verified before applying." });
        }

        const job = await db.Job.findByPk(jobId);
        if (!job) {
            return res.status(404).json({ msg: "Job not found." });
        }

        if (job.recruitment_status === "closed") {
            return res.status(403).json({ msg: "Recruitment for this job has been stopped." });
        }

        const existing = await db.Application.findOne({
            where: { job_id: jobId, alumni_id: req.user.id }
        });

        if (existing) {
            return res.status(400).json({ msg: "You already applied to this job." });
        }

        // ── BRANCH A: Legacy job (no requirements) ──
        if (!job.has_requirements || job.current_requirement_version === 0) {
            const resumeFile = req.files?.resume?.[0];
            const transcriptFile = req.files?.transcript?.[0];
            const certificateFile = req.files?.certificate?.[0];

            const resumeId = req.body?.resume_id;
            let resumePath = null;
            let resumeSnapshot = null;

            if (resumeId) {
                const alumniResume = await db.Resume.findOne({ where: { id: resumeId, user_id: req.user.id } });
                if (!alumniResume) {
                    return res.status(400).json({ msg: "Selected resume not found." });
                }
                resumePath = `/uploads/resumes/${alumniResume.id}.json`;
                resumeSnapshot = await createResumeSnapshot(alumniResume.id);
            } else if (resumeFile) {
                resumePath = resumeFile.storageRef || resumeFile.path || `/uploads/resumes/${resumeFile.filename}`;
            }

            const toStoredPath = (file, folder) =>
                file
                    ? file.storageRef || file.path || `/uploads/${folder}/${file.filename}`
                    : null;

            const currentCycle = await db.Application.max("recruitment_cycle", { where: { job_id: jobId } }) || 1;

            const application = await db.Application.create({
                job_id: jobId,
                alumni_id: req.user.id,
                position_applied_for,
                department_office,
                employment_type,
                preferred_work_location,
                expected_salary,
                start_date,
                full_name: full_name || alumni.name,
                email: email || alumni.email,
                dob, place_of_birth, gender, contact_number, nationality, address,
                professional_summary,
                civil_service_eligibility, rating, license_number, validity,
                education, school, degree, years_attended, honors,
                company, position, employment_period, responsibilities, achievements, reason_for_leaving,
                skills, soft_skills, certifications,
                leadership_role, people_managed, leadership_achievements,
                training_title, training_organization, training_duration, training_date,
                reference_name, reference_position, reference_company, reference_contact,
                civil_status, disability, disability_other,
                employment_status, employment_type_detail, ofw, former_ofw, four_ps,
                preferred_occupation, preferred_work_type, preferred_location_type, preferred_location_detail,
                languages, currently_in_school, education_level, work_status,
                other_skills, other_skills_other,
                convicted_of_crime, dismissed_from_service, currently_employed, can_work_overtime,
                why_join, good_fit, career_goals, declaration_confirmed, notes,
                sss_no: encrypt(sss_no),
                philhealth_no: encrypt(philhealth_no),
                pagibig_no: encrypt(pagibig_no),
                tin: encrypt(tin),
                resume_path: resumePath,
                resume_snapshot: resumeSnapshot,
                transcript_path: toStoredPath(transcriptFile, "documents"),
                certificate_path: toStoredPath(certificateFile, "documents"),
                status: "pending",
                recruitment_cycle: currentCycle
            });

            return res.json(hydrateSensitiveFields(application));
        }

        // ── BRANCH B: Job has dynamic requirements ──
        const resumeId = req.body?.resume_id;
        let resumeSnapshot = null;
        if (resumeId) {
            const alumniResume = await db.Resume.findOne({ where: { id: resumeId, user_id: req.user.id } });
            if (!alumniResume) {
                return res.status(400).json({ msg: "Selected resume not found." });
            }
            resumeSnapshot = await createResumeSnapshot(alumniResume.id);
        }

        const version = job.current_requirement_version;
        const jobRequirements = await db.JobRequirement.findAll({
            where: { job_id: jobId, version }
        });

        if (!jobRequirements.length) {
            return res.status(400).json({ msg: "This job has no requirements configured." });
        }

        // Validate required document uploads
        const docRequirements = jobRequirements.filter((r) => r.requirement_type === "document_upload" && r.required);
        for (const requirement of docRequirements) {
            const fieldName = `requirement_${requirement.requirement_code}`;
            const file = req.files?.[fieldName]?.[0];

            if (!file) {
                return res.status(400).json({
                    msg: `Required document "${requirement.label}" is missing.`,
                    requirement_code: requirement.requirement_code
                });
            }
        }

        // Validate required information fields
        const infoRequirements = jobRequirements.filter((r) => r.requirement_type === "information_field" && r.required);
        for (const requirement of infoRequirements) {
            const fieldName = `requirement_${requirement.requirement_code}`;
            const value = req.body?.[fieldName] || req.body?.[`requirement_${requirement.requirement_code}`];
            if (!value || !String(value).trim()) {
                return res.status(400).json({
                    msg: `Required information "${requirement.label}" is missing.`,
                    requirement_code: requirement.requirement_code
                });
            }
        }

        // Build snapshot
        const snapshotData = await buildSnapshotData(jobId, version);

        // Create application with snapshot
        const currentCycle = await db.Application.max("recruitment_cycle", { where: { job_id: jobId } }) || 1;

        const application = await db.sequelize.transaction(async (transaction) => {
            const app = await db.Application.create({
                job_id: jobId,
                alumni_id: req.user.id,
                full_name: full_name || alumni.name,
                email: email || alumni.email,
                status: "pending",
                recruitment_cycle: currentCycle
            }, { transaction });

            // Save snapshot
            await db.JobRequirementSnapshot.create({
                application_id: app.id,
                job_id: jobId,
                version,
                snapshot_data: snapshotData
            }, { transaction });

            // Save document uploads
            const docReqs = jobRequirements.filter((r) => r.requirement_type === "document_upload");
            for (const requirement of docReqs) {
                const fieldName = `requirement_${requirement.requirement_code}`;
                const file = req.files?.[fieldName]?.[0];
                if (file) {
                    const filePath = file.storageRef || file.path || `/uploads/documents/${file.filename}`;
                    await db.ApplicationDocument.create({
                        application_id: app.id,
                        requirement_code: requirement.requirement_code,
                        file_path: filePath,
                        file_name: file.originalname || file.filename,
                        file_size: file.size || null,
                        mime_type: file.mimetype || null,
                        review_status: "pending_review",
                        version: 1
                    }, { transaction });
                }
            }

            // Save information field responses
            const infoReqs = jobRequirements.filter((r) => r.requirement_type === "information_field");
            for (const requirement of infoReqs) {
                const fieldName = `requirement_${requirement.requirement_code}`;
                const value = req.body?.[fieldName] || req.body?.[`requirement_${requirement.requirement_code}`];
                if (value !== undefined && value !== null) {
                    await db.ApplicationResponse.create({
                        application_id: app.id,
                        requirement_code: requirement.requirement_code,
                        response_value: String(value),
                        review_status: "pending_review",
                        version: 1
                    }, { transaction });
                }
            }

            return app;
        });

        // Audit log
        auditService.log({
            actorId: req.user.id,
            actorRole: "alumni",
            action: "application.submitted",
            targetType: "application",
            targetId: application.id,
            metadata: { job_id: jobId, snapshot_version: version },
            ipAddress: req.ip
        });

        // Fetch and return the full application with snapshot
        const result = await db.Application.findByPk(application.id, {
            include: [
                { model: db.JobRequirementSnapshot },
                { model: db.ApplicationDocument },
                { model: db.ApplicationResponse }
            ]
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
};

// GET ALL APPLICATIONS FOR USER
exports.getApplications = async (req, res, next) => {
    try {
        const apps = await db.Application.findAll({
            where: { alumni_id: req.user.id },
            include: [
                { model: db.Job },
                { model: db.JobRequirementSnapshot },
                { model: db.ApplicationDocument },
                { model: db.ApplicationResponse }
            ]
        });
        res.json(apps.map(hydrateSensitiveFields));
    } catch (err) {
        next(err);
    }
};

// GET APPLICANTS FOR A SPECIFIC JOB
exports.getJobApplicants = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const isEmployerAdmin = req.user.role === "admin" && req.user.admin_scope === "employer";
        if (req.user.role !== "employer" && !isEmployerAdmin) {
            return res.status(403).json({ msg: "Employer access only." });
        }

        console.log("=== GET JOB APPLICANTS DEBUG ===");
        console.log("Endpoint: GET /api/applications/jobs/:jobId/applicants");
        console.log("Authenticated user:", JSON.stringify({ id: req.user?.id, role: req.user?.role, admin_scope: req.user?.admin_scope }));
        console.log("Requested jobId:", jobId);

        const job = await db.Job.findByPk(jobId);
        if (!job) {
            return res.status(404).json({ msg: "Job not found." });
        }

        if (Number(job.employer_id) !== Number(req.user.id) && !isEmployerAdmin) {
            return res.status(403).json({ msg: "Not allowed." });
        }

        const currentCycle = await db.Application.max("recruitment_cycle", { where: { job_id: jobId } }) || 1;

        const appWhere = {
            job_id: jobId,
            recruitment_cycle: currentCycle,
            [Op.or]: [{ is_archived: false }, { is_archived: null }]
        };

        const apps = await db.Application.findAll({
            where: appWhere,
            include: [
                {
                    model: db.User,
                    as: "alumni",
                    attributes: ["id", "name", "email", "role"],
                    include: [
                        {
                            model: db.AlumniProfile,
                            include: [{ model: db.EmploymentHistory }]
                        }
                    ]
                },
                { model: db.JobRequirementSnapshot },
                { model: db.ApplicationDocument },
                { model: db.ApplicationResponse }
            ],
            order: [["createdAt", "DESC"]]
        });

        console.log("=== GET JOB APPLICANTS DEBUG ===");
        console.log("Applications returned:", apps.length);
        console.log("Application job ids:", JSON.stringify(apps.map((app) => app.job_id)));

        res.json(apps.filter(app => app.status !== "not_verified").map(hydrateSensitiveFields));
    } catch (err) {
        next(err);
    }
};

// GET APPLICATIONS RECEIVED BY EMPLOYER
exports.getEmployerApplications = async (req, res, next) => {
    try {
        const isEmployerAdmin = req.user.role === "admin" && req.user.admin_scope === "employer";
        if (req.user.role !== "employer" && !isEmployerAdmin) {
            return res.status(403).json({ msg: "Employer access only." });
        }

        const jobWhere = { employer_id: req.user.id };
 
        console.log("=== GET EMPLOYER APPLICATIONS DEBUG ===");
        console.log("Request path:", req.originalUrl);
        console.log("Authenticated user:", JSON.stringify({ id: req.user?.id, role: req.user?.role, admin_scope: req.user?.admin_scope }));
        console.log("Job where clause:", JSON.stringify(jobWhere));

        const archived = String(req.query.archived || "false").toLowerCase() === "true";
        const apps = await db.Application.findAll({
            where: archived
                ? { is_archived: true }
                : { [Op.or]: [{ is_archived: false }, { is_archived: null }] },
            include: [
                {
                    model: db.Job,
                    where: jobWhere
                },
                {
                    model: db.User,
                    as: "alumni",
                    attributes: ["id", "name", "email", "role"],
                    include: [
                        {
                            model: db.AlumniProfile,
                            include: [{ model: db.EmploymentHistory }]
                        }
                    ]
                },
                { model: db.JobRequirementSnapshot },
                { model: db.ApplicationDocument },
                { model: db.ApplicationResponse }
            ],
            order: [["createdAt", "DESC"]]
        });

        const filtered = archived ? apps : apps.filter((app) => {
            const job = app.Job;
            if (!job || app.status === "not_verified") return false;
 
            if (job.recruitment_status === "closed") {
                return app.status === "verified";
            }
 
            return true;
        });

        console.log("=== GET EMPLOYER APPLICATIONS DEBUG ===");
        console.log("Applications returned after filtering:", filtered.length);
        console.log("Returned application job employer_ids:", JSON.stringify(filtered.map((app) => app.Job?.employer_id)));
 
        res.json(filtered.map(hydrateSensitiveFields));
    } catch (err) {
        next(err);
    }
};

const updateEmployerApplicationArchive = async (req, res, next, isArchived) => {
    try {
        if (req.user?.role !== "employer") {
            return res.status(403).json({ msg: "Only the employer who owns this application may archive or restore it." });
        }

        const application = await db.Application.findByPk(req.params.id, {
            include: [{ model: db.Job, attributes: ["id", "employer_id"] }]
        });
        if (!application) return res.status(404).json({ msg: "Application not found." });
        if (Number(application.Job?.employer_id) !== Number(req.user.id)) {
            return res.status(403).json({ msg: "You can only manage applications for your own jobs." });
        }

        const previouslyArchived = application.is_archived === true;
        if (previouslyArchived !== isArchived) {
            await application.update({ is_archived: isArchived });
            auditService.log({
                actorId: req.user.id,
                actorRole: req.user.role,
                action: isArchived ? "application.archived" : "application.restored",
                targetType: "application",
                targetId: application.id,
                metadata: { previous_is_archived: previouslyArchived, is_archived: isArchived },
                ipAddress: req.ip
            });
        }

        return res.json({
            msg: isArchived ? "Application archived." : "Application restored.",
            application: hydrateSensitiveFields(application)
        });
    } catch (err) {
        return next(err);
    }
};

exports.archiveEmployerApplication = (req, res, next) => updateEmployerApplicationArchive(req, res, next, true);
exports.restoreEmployerApplication = (req, res, next) => updateEmployerApplicationArchive(req, res, next, false);

// REVIEW A SINGLE REQUIREMENT (employer only)
exports.reviewRequirement = async (req, res, next) => {
    try {
        const isEmployerAdmin = req.user.role === "admin" && req.user.admin_scope === "employer";
        if (req.user.role !== "employer" && !isEmployerAdmin) {
            return res.status(403).json({ msg: "Employer access only." });
        }

        const { id, code } = req.params;
        const { status, notes } = req.body;

        const allowedStatuses = ["approved", "rejected", "needs_revision"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ msg: "Invalid review status. Use: approved, rejected, or needs_revision." });
        }

        const application = await db.Application.findByPk(id, {
            include: [{ model: db.Job }]
        });

        if (!application) {
            return res.status(404).json({ msg: "Application not found." });
        }

        if (application.Job?.employer_id !== req.user.id && !isEmployerAdmin) {
            return res.status(403).json({ msg: "You can only review applications for your own jobs." });
        }

        // Try to update document or response
        let updated = false;

        const doc = await db.ApplicationDocument.findOne({
            where: { application_id: id, requirement_code: code }
        });

        if (doc) {
            doc.review_status = status;
            doc.review_notes = notes || null;
            doc.reviewed_by = req.user.id;
            doc.reviewed_at = new Date();
            await doc.save();
            updated = true;

            auditService.log({
                actorId: req.user.id,
                actorRole: "employer",
                action: status === "needs_revision" ? "application.document.revision_requested" : `application.document.${status}`,
                targetType: "document",
                targetId: doc.id,
                requirementCode: code,
                metadata: { notes },
                ipAddress: req.ip
            });
        }

        const resp = await db.ApplicationResponse.findOne({
            where: { application_id: id, requirement_code: code }
        });

        if (resp) {
            resp.review_status = status;
            resp.review_notes = notes || null;
            resp.reviewed_by = req.user.id;
            resp.reviewed_at = new Date();
            await resp.save();
            updated = true;

            auditService.log({
                actorId: req.user.id,
                actorRole: "employer",
                action: status === "needs_revision" ? "application.response.revision_requested" : `application.response.${status}`,
                targetType: "response",
                targetId: resp.id,
                requirementCode: code,
                metadata: { notes },
                ipAddress: req.ip
            });
        }

        if (!updated) {
            return res.status(404).json({ msg: `Requirement "${code}" not found in this application.` });
        }

        // Notify applicant if revision requested
        if (status === "needs_revision") {
            await notificationController.createNotification({
                userIds: [application.alumni_id],
                type: "application",
                message: `Your ${code} requires revision. ${notes ? `Notes: ${notes}` : ""}`,
                subject: "Application Revision Required"
            });
        }

        res.json({ msg: `Requirement "${code}" reviewed as "${status}".` });
    } catch (err) {
        next(err);
    }
};

// GET REVIEW STATUS FOR ALL REQUIREMENTS
exports.getRequirementReviewStatus = async (req, res, next) => {
    try {
        const application = await db.Application.findByPk(req.params.id, {
            include: [
                { model: db.JobRequirementSnapshot },
                { model: db.ApplicationDocument },
                { model: db.ApplicationResponse }
            ]
        });

        if (!application) {
            return res.status(404).json({ msg: "Application not found." });
        }

        const snapshot = application.JobRequirementSnapshot;
        if (!snapshot) {
            return res.json({ has_requirements: false, message: "Legacy application without dynamic requirements." });
        }

        const snapshotData = snapshot.snapshot_data;
        const allRequirements = [
            ...(snapshotData.groups || []).flatMap((g) => g.requirements || []),
            ...(snapshotData.ungrouped || [])
        ];

        const statuses = allRequirements.map((req) => {
            const doc = (application.ApplicationDocuments || []).find((d) => d.requirement_code === req.requirement_code);
            const resp = (application.ApplicationResponses || []).find((r) => r.requirement_code === req.requirement_code);

            return {
                requirement_code: req.requirement_code,
                label: req.label,
                requirement_type: req.requirement_type,
                required: req.required,
                review_status: doc?.review_status || resp?.review_status || "not_submitted",
                review_notes: doc?.review_notes || resp?.review_notes || null,
                version: doc?.version || resp?.version || 0,
                has_file: !!doc,
                has_response: !!resp
            };
        });

        res.json({
            application_id: application.id,
            snapshot_version: snapshot.version,
            overall_status: application.status,
            requirements: statuses
        });
    } catch (err) {
        next(err);
    }
};

// Persist an application decision independently of interview invitations.
exports.reviewApplication = async (req, res, next) => {
    try {
        if (!canUseEmployerInvitationWorkflow(req.user)) return res.status(403).json({ msg: "Employer access only." });
        const { status, job_id, recruitment_cycle } = req.body;
        if (!["verified", "not_verified"].includes(status)) return res.status(400).json({ msg: "Invalid review status." });
        if (!job_id || !recruitment_cycle || !Number.isInteger(Number(job_id)) || !Number.isInteger(Number(recruitment_cycle))) return res.status(400).json({ msg: "Job and recruitment cycle are required." });
        const result = await db.sequelize.transaction(async (transaction) => {
            const fail = (code, message) => { const error = new Error(message); error.status = code; throw error; };
            const job = await db.Job.findByPk(job_id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!job) fail(404, "Job not found.");
            const admin = req.user.role === "admin" && req.user.admin_scope === "employer";
            if (Number(job.employer_id) !== Number(req.user.id) && !admin) fail(403, "You can only review applications for your own jobs.");
            const application = await db.Application.findByPk(req.params.id || req.params.applicationId, { transaction, lock: transaction.LOCK.UPDATE });
            if (!application) fail(404, "Application not found.");
            const cycle = await db.Application.max("recruitment_cycle", { where: { job_id: job.id }, transaction }) || 1;
            if (Number(application.job_id) !== Number(job.id) || Number(application.recruitment_cycle) !== Number(recruitment_cycle) || Number(cycle) !== Number(recruitment_cycle)) fail(409, "Application does not belong to the selected job and current recruitment cycle.");
            if (application.is_archived) fail(409, "Restore this application before reviewing it.");
            if (application.status === status) return { application };
            if (!["pending", "pending_review", "submitted"].includes(application.status)) fail(409, "This application already has a final decision or is processing.");
            const previousStatus = application.status;
            // Compare-and-set inside the transaction: only the winner emits side effects.
            const [changed] = await db.Application.update({ status }, {
                where: {
                    id: application.id,
                    job_id: job.id,
                    recruitment_cycle: Number(recruitment_cycle),
                    is_archived: false,
                    status: { [Op.in]: ["pending", "pending_review", "submitted"] }
                },
                transaction
            });
            if (changed !== 1) fail(409, "This application has already been decided or changed. Refresh before continuing.");
            application.status = status;
            const message = status === "verified"
                ? "Your application for " + (job.title || "the job") + " has been approved. Please await further instructions from the employer."
                : "Your application for " + (job.title || "the job") + " was not selected for the current recruitment process.";
            await db.Notification.create({ userId: application.alumni_id, type: "application", message, isRead: false }, { transaction });
            await db.AuditLog.create({ actor_id: req.user.id, actor_role: req.user.role, action: status === "verified" ? "application.approved" : "application.declined", target_type: "application", target_id: application.id, metadata: { previous_status: previousStatus, status, job_id: job.id, recruitment_cycle: cycle }, ip_address: req.ip }, { transaction });
            return { application };
        });
        res.json({ msg: status === "verified" ? "Application approved." : "Application declined.", application: hydrateSensitiveFields(result.application) });
    } catch (err) { next(err); }
};

const loadEmployerInvitationApplication = async (applicationId, employerId, transaction) => {
    const application = await db.Application.findByPk(applicationId, {
        include: [
            { model: db.Job, include: [{ model: db.User, include: [{ model: db.EmployerProfile }] }] },
            { model: db.User, as: "alumni", attributes: ["id", "name", "email"] }
        ],
        ...(transaction ? { transaction } : {})
    });
    if (!application) return { error: { status: 404, msg: "Application not found." } };
    if (Number(application.Job?.employer_id) !== Number(employerId)) {
        return { error: { status: 403, msg: "You can only manage applications for your own jobs." } };
    }
    return { application };
};

exports.getInterviewInvitationDetails = async (req, res, next) => {
    try {
        if (!canUseEmployerInvitationWorkflow(req.user)) return res.status(403).json({ msg: "Employer access only." });
        const { application, error } = await loadEmployerInvitationApplication(req.params.id, req.user.id);
        if (error) return res.status(error.status).json({ msg: error.msg });

        const details = getJobInvitationDetails(application.Job);
        const employerUser = application.Job?.User;
        const organizationName = employerUser?.EmployerProfile?.organization_name || employerUser?.name || "";
        const existingInterview = await db.Interview.findOne({
            where: { application_id: application.id },
            order: [["createdAt", "DESC"]]
        });
        const emailJob = existingInterview
            ? await db.EmailQueueJob.findOne({ where: { dedupe_key: `interview-invitation:${existingInterview.id}` } })
            : null;
        return res.json({
            application_id: application.id,
            applicant_name: application.alumni?.name || application.full_name || "Applicant",
            job: { id: application.Job.id, title: application.Job.title },
            organization_name: organizationName,
            interview_details: details,
            complete: !getMissingInvitationField(details),
            already_invited: application.status === "verified" || Boolean(existingInterview),
            email_status: emailJob?.status || (application.status === "verified" ? "unknown" : null)
        });
    } catch (err) {
        return next(err);
    }
};

exports.sendInterviewInvitation = async (req, res, next) => {
    try {
        if (!canUseEmployerInvitationWorkflow(req.user)) return res.status(403).json({ msg: "Employer access only." });

        const result = await db.sequelize.transaction(async (transaction) => {
            const application = await db.Application.findByPk(req.params.id, {
                include: [
                    { model: db.Job, include: [{ model: db.User, include: [{ model: db.EmployerProfile }] }] },
                    { model: db.User, as: "alumni", attributes: ["id", "name", "email"] }
                ],
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!application) {
                const error = new Error("Application not found."); error.status = 404; throw error;
            }
            if (Number(application.Job?.employer_id) !== Number(req.user.id)) {
                const error = new Error("You can only manage applications for your own jobs."); error.status = 403; throw error;
            }
            const priorInterview = await db.Interview.findOne({
                where: { application_id: application.id }, transaction, lock: transaction.LOCK.UPDATE
            });
            if (application.status === "verified" || priorInterview) {
                const error = new Error("This application already has an interview invitation."); error.status = 409; throw error;
            }
            if (!["pending", "pending_review", "submitted"].includes(application.status)) {
                const error = new Error("This application already has a final decision or is processing."); error.status = 409; throw error;
            }

            const details = getJobInvitationDetails(application.Job);
            const missing = getMissingInvitationField(details);
            if (missing) {
                const error = new Error(`Configure the job's interview ${missing.replaceAll("_", " ")} before approving this applicant.`);
                error.status = 400;
                throw error;
            }
            if (!application.alumni?.email) {
                const error = new Error("The applicant does not have a registered email address."); error.status = 400; throw error;
            }

            const employerUser = application.Job?.User;
            const organizationName = employerUser?.EmployerProfile?.organization_name || employerUser?.name || "";
            const invitationMessage = buildInterviewInvitation({
                applicantName: application.alumni?.name || application.full_name || "Applicant",
                jobTitle: application.Job?.title || "the position",
                organizationName,
                details
            });
            const interview = await db.Interview.create({
                application_id: application.id,
                venue: details.venue,
                place: details.place,
                date: details.date,
                time: details.time,
                contact_info: details.contact_info,
                what_to_bring: details.what_to_bring || null
            }, { transaction });

            application.status = "verified";
            await application.save({ transaction });
            await db.Notification.create({
                userId: application.alumni_id,
                type: "interview",
                interview_id: interview.id,
                message: invitationMessage,
                isRead: false
            }, { transaction });
            await db.EmailQueueJob.create({
                to: application.alumni.email,
                subject: `Interview Invitation: ${application.Job?.title || "Job Application"}`,
                message: invitationMessage,
                dedupe_key: `interview-invitation:${interview.id}`,
                status: "pending",
                attempts: 0,
                scheduled_at: new Date()
            }, { transaction });

            return { application, interview, applicant_name: application.alumni.name, email_status: "pending" };
        });

        auditService.log({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: "application.interview_invitation.sent",
            targetType: "application",
            targetId: result.application.id,
            metadata: { interview_id: result.interview.id },
            ipAddress: req.ip
        });
        return res.status(201).json({
            msg: "Applicant approved. The in-app invitation was saved and the email is queued for delivery.",
            application: hydrateSensitiveFields(result.application),
            interview: result.interview,
            applicant_name: result.applicant_name,
            email_status: result.email_status
        });
    } catch (err) {
        return next(err);
    }
};

exports.retryInterviewInvitationEmail = async (req, res, next) => {
    try {
        if (!canUseEmployerInvitationWorkflow(req.user)) return res.status(403).json({ msg: "Employer access only." });
        const { application, error } = await loadEmployerInvitationApplication(req.params.id, req.user.id);
        if (error) return res.status(error.status).json({ msg: error.msg });
        const interview = await db.Interview.findOne({
            where: { application_id: application.id }, order: [["createdAt", "DESC"]]
        });
        if (!interview) return res.status(404).json({ msg: "No interview invitation exists for this application." });

        const dedupeKey = `interview-invitation:${interview.id}`;
        const emailJob = await db.EmailQueueJob.findOne({ where: { dedupe_key: dedupeKey } });
        if (!emailJob) return res.status(404).json({ msg: "The invitation email is not in the delivery queue." });
        if (emailJob.status === "sent") return res.json({ msg: "The email provider has accepted the invitation. Inbox delivery is not confirmed.", email_status: "sent" });
        if (emailJob.status !== "failed") return res.json({ msg: "The invitation email is already queued for delivery.", email_status: emailJob.status });

        if (require("../utils/emailDiagnostics").requiresDeliveryReview(emailJob.last_error)) {
            return res.status(409).json({
                msg: "This email may already have been accepted. Contact the administrator to review the provider logs before retrying.",
                code: "EMAIL_REVIEW_REQUIRED", email_status: "failed"
            });
        }

        const [requeued] = await db.EmailQueueJob.update({
            status: "pending", attempts: 0, scheduled_at: new Date(),
            last_error: null, processing_started_at: null
        }, { where: { id: emailJob.id, status: "failed", attempts: emailJob.attempts, last_error: emailJob.last_error } });
        const refreshed = await db.EmailQueueJob.findByPk(emailJob.id);
        const emailStatus = refreshed?.status || "pending";
        if (!requeued && emailStatus === "failed") return res.status(409).json({
            msg: "The email state changed. Ask the administrator to review the latest failure before retrying.",
            code: "EMAIL_REVIEW_REQUIRED", email_status: "failed"
        });
        return res.json({
            msg: emailStatus === "pending" ? "Invitation email queued for retry." : "Invitation email delivery is already in progress.",
            email_status: emailStatus
        });
    } catch (err) {
        return next(err);
    }
};

const canReadApplicationFile = (user, application) =>
    (user.role === "admin" && user.admin_scope === "employer") ||
    (user.role === "employer" && Number(application.Job?.employer_id) === Number(user.id)) ||
    (user.role === "alumni" && Number(application.alumni_id) === Number(user.id));

const sendPrivateApplicationFile = async (storedValue, mimeType, res) => {
    const storedPath = String(storedValue || "").trim();
    const safeMimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(mimeType || "")) ? mimeType : null;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (isStoredFileReference(storedPath) || /^https?:\/\//i.test(storedPath)) {
        return await sendStoredFile(storedPath, res, null, safeMimeType);
    }

    const normalizedPath = storedPath.replace(/\\/g, "/");
    const uploadsMarker = normalizedPath.toLowerCase().lastIndexOf("/uploads/");
    const relativePath = uploadsMarker >= 0
        ? normalizedPath.slice(uploadsMarker + "/uploads/".length)
        : normalizedPath.toLowerCase().startsWith("uploads/")
            ? normalizedPath.slice("uploads/".length)
            : "";
    const pathParts = relativePath.split("/").filter(Boolean);
    if (!pathParts.length || pathParts.some((part) => part === "." || part === "..")) {
        return res.status(404).json({ msg: "Application document file not found." });
    }

    const uploadsRoot = path.resolve(__dirname, "..", "uploads");
    const absolutePath = path.resolve(uploadsRoot, ...pathParts);
    if (!absolutePath.startsWith(`${uploadsRoot}${path.sep}`)) {
        return res.status(400).json({ msg: "Invalid application document path." });
    }

    try {
        await fs.promises.access(absolutePath, fs.constants.R_OK);
    } catch {
        return res.status(404).json({ msg: "Application document file not found." });
    }

    if (safeMimeType) res.setHeader("Content-Type", safeMimeType);
    return res.sendFile(absolutePath);
};

// Both file readers use the same participant checks and private storage handling.
exports.getApplicationDocumentFile = async (req, res, next) => {
    try {
        const application = await db.Application.findByPk(req.params.id, {
            include: [{ model: db.Job, attributes: ["id", "employer_id"] }]
        });
        if (!application) return res.status(404).json({ msg: "Application not found." });
        if (!canReadApplicationFile(req.user, application)) {
            return res.status(403).json({ msg: "Not allowed to access this application document." });
        }

        const document = await db.ApplicationDocument.findOne({
            where: { id: req.params.documentId, application_id: application.id }
        });
        if (!document) return res.status(404).json({ msg: "Application document not found." });
        return await sendPrivateApplicationFile(document.file_path, document.mime_type, res);
    } catch (err) {
        return next(err);
    }
};

exports.getApplicationResumeFile = async (req, res, next) => {
    try {
        const application = await db.Application.findByPk(req.params.id, {
            include: [{ model: db.Job, attributes: ["id", "employer_id"] }]
        });
        if (!application) return res.status(404).json({ msg: "Application not found." });
        if (!canReadApplicationFile(req.user, application)) {
            return res.status(403).json({ msg: "Not allowed to access this application document." });
        }
        if (!application.resume_path) return res.status(404).json({ msg: "Application resume not found." });
        const fileName = getApplicationFileName(application.resume_path);
        return await sendPrivateApplicationFile(application.resume_path, getApplicationFileMimeType(fileName), res);
    } catch (err) {
        return next(err);
    }
};

// DOWNLOAD ALL APPLICATION DOCUMENTS AS ZIP
exports.downloadApplicationDocuments = async (req, res, next) => {
    try {
        const application = await db.Application.findByPk(req.params.id, {
            include: [
                { model: db.Job },
                { model: db.ApplicationDocument }
            ]
        });

        if (!application) {
            return res.status(404).json({ msg: "Application not found." });
        }

        // Authorization
        const isOwner = req.user.role === "employer" && application.Job?.employer_id === req.user.id;
        const isApplicant = req.user.role === "alumni" && application.alumni_id === req.user.id;
        const isAdmin = req.user.role === "admin";
        if (!isOwner && !isApplicant && !isAdmin) {
            return res.status(403).json({ msg: "Not allowed." });
        }

        const documents = application.ApplicationDocuments || [];
        if (documents.length === 0) {
            return res.status(400).json({ msg: "No documents available for download." });
        }

        // Set response headers
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="application-${application.id}-documents.zip"`);

        const archive = archiver("zip", { zlib: { level: 5 } });
        archive.on("error", (err) => { throw err; });

        archive.pipe(res);

        let fileCount = 0;
        const missingFiles = [];

        for (const doc of documents) {
            const filePath = doc.file_path;
            // Handle both local and cloud storage paths
            if (filePath && !filePath.startsWith("http") && !filePath.startsWith("stored://")) {
                const absolutePath = path.isAbsolute(filePath)
                    ? filePath
                    : path.join(__dirname, "..", filePath);

                try {
                    if (fs.existsSync(absolutePath)) {
                        const archiveName = `${doc.requirement_code}_${doc.file_name}`;
                        archive.file(absolutePath, { name: archiveName });
                        fileCount++;
                    } else {
                        missingFiles.push(doc.requirement_code);
                    }
                } catch {
                    missingFiles.push(doc.requirement_code);
                }
            } else if (filePath && filePath.startsWith("http")) {
                // For cloud URLs, we'd need to fetch and stream — skip for now
                missingFiles.push(doc.requirement_code);
            }
        }

        if (fileCount === 0) {
            archive.abort();
            return res.status(400).json({ msg: "No downloadable files found." });
        }

        await archive.finalize();

        // Audit log
        auditService.log({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: "application.documents.downloaded",
            targetType: "application",
            targetId: application.id,
            metadata: { total_files: fileCount, missing_files: missingFiles },
            ipAddress: req.ip
        });
    } catch (err) {
        next(err);
    }
};
