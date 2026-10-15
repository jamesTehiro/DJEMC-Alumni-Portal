const db = require("../models");
const notificationController = require("./notificationController");
const { Op } = require("sequelize");
const auditService = require("../services/auditService");
const { normalizeEmploymentType } = require("../utils/employmentType");
const { JobPostingError, validateJobFields } = require("../services/jobPosting");

const loadPostingUser = async (req, transaction) => {
    const id = Number(req.user?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new JobPostingError("Authentication is required.", 401);
    const user = await db.User.findByPk(id, {
        attributes: ["id", "name", "role", "admin_scope", "account_status"],
        ...(transaction ? { transaction, lock: transaction.LOCK?.UPDATE } : {})
    });
    const employer = user?.role === "employer" && user.account_status === "verified";
    const administrator = user?.role === "admin" && user.admin_scope === "employer" && user.account_status === "verified";
    if (!employer && !administrator) throw new JobPostingError("Only a verified employer or an authorized Employer Admin can manage job postings.", 403);
    return user;
};

const jobForViewer = (job, user) => {
    const result = typeof job.toJSON === "function" ? job.toJSON() : { ...job };
    const owner = user?.role === "employer" && Number(result.employer_id) === Number(user.id);
    const employerAdmin = user?.role === "admin" && user.admin_scope === "employer";
    if (!owner && !employerAdmin) {
        for (const column of Object.values(interviewDetailFields)) delete result[column];
    }
    if (result.User) {
        // Public company identity never contains account or employer contact fields.
        const identity = result.User;
        result.User = Object.fromEntries(["id", "name", "role", "admin_scope", "admin_avatar_url"].filter(key => identity[key] !== undefined).map(key => [key, identity[key]]));
        if (identity.EmployerProfile) result.User.EmployerProfile = Object.fromEntries(["organization_name", "industry", "logo_url", "verified"].filter(key => identity.EmployerProfile[key] !== undefined).map(key => [key, identity.EmployerProfile[key]]));
        if (identity.AlumniProfile) result.User.AlumniProfile = { avatar_url: identity.AlumniProfile.avatar_url };
    }
    return result;
};

const getExistingAttributes = (tableColumns, preferredAttributes, fallbackAttributes) => {
    if (!tableColumns) return fallbackAttributes;
    const available = preferredAttributes.filter((attribute) => Object.prototype.hasOwnProperty.call(tableColumns, attribute));
    return available.length ? available : fallbackAttributes;
};

const getTableColumns = async (queryInterface, tableName) => {
    try {
        return await queryInterface.describeTable(tableName);
    } catch {
        return null;
    }
};

const getNextRequirementVersion = async (jobId, transaction) => {
    const maxVersion = await db.JobRequirement.max("version", {
        where: { job_id: jobId }, transaction
    });
    return (maxVersion || 0) + 1;
};

const interviewDetailFields = {
    venue: "interview_venue",
    place: "interview_place",
    date: "interview_date",
    time: "interview_time",
    contact_info: "interview_contact_info",
    what_to_bring: "interview_what_to_bring"
};

const normalizeInterviewDetails = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.keys(interviewDetailFields).map((key) => [key, String(value[key] ?? "").trim()]));
};

const validateInterviewDetails = (details) => {
    if (!details) return "Interview details are required before publishing this job.";
    const required = ["venue", "place", "date", "time", "contact_info"];
    const missing = required.find((key) => !details[key]);
    if (missing) return `${missing.replaceAll("_", " ")} is required.`;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(details.date);
    if (!match) return "Interview date must be a valid date.";
    const [, year, month, day] = match.map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        return "Interview date must be a valid date.";
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(details.time)) {
        return "Interview time must use the 24-hour HH:MM format.";
    }
    return null;
};

const detailsFromJob = (job) => Object.fromEntries(
    Object.entries(interviewDetailFields).map(([key, column]) => [key, job[column] || ""])
);

const assignInterviewDetails = (target, details) => {
    for (const [key, column] of Object.entries(interviewDetailFields)) {
        target[column] = details[key] || null;
    }
};

const createRequirementsForJob = async (jobId, requirements, version, transaction) => {
    if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
        return [];
    }

    const created = [];
    for (let i = 0; i < requirements.length; i++) {
        const req = requirements[i];
        let requirementCode = req.requirement_code;

        if (req.library_code) {
            const libItem = await db.RequirementLibrary.findOne({
                where: { requirement_code: req.library_code, is_active: true },
                transaction
            });
            if (!libItem) {
                throw new Error(`Library requirement "${req.library_code}" not found.`);
            }
            requirementCode = libItem.requirement_code;
        } else if (req.is_custom || !requirementCode) {
            requirementCode = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${i}`;
        }

        const jobReq = await db.JobRequirement.create({
            job_id: jobId,
            version,
            group_id: req.group_id || null,
            library_id: req.library_id || null,
            requirement_code: requirementCode,
            label: req.label,
            description: req.description || null,
            requirement_type: req.requirement_type || "document_upload",
            value_type: req.value_type || (req.requirement_type === "information_field" ? "text" : "file"),
            value_options: req.value_options || null,
            required: req.required !== undefined ? req.required : true,
            is_custom: req.is_custom || false,
            allowed_types: req.allowed_types || null,
            max_file_size: req.max_file_size || null,
            sort_order: req.sort_order !== undefined ? req.sort_order : i
        }, { transaction });

        created.push(jobReq);
    }

    return created;
};

const createGroupsForJob = async (jobId, version, groups, transaction) => {
    if (!groups || !Array.isArray(groups) || groups.length === 0) {
        return [];
    }

    const created = [];
    for (let i = 0; i < groups.length; i++) {
        const group = await db.RequirementGroup.create({
            job_id: jobId,
            version,
            group_label: groups[i].label,
            sort_order: groups[i].sort_order !== undefined ? groups[i].sort_order : i
        }, { transaction });
        created.push(group);
    }
    return created;
};

exports.createJob = async (req, res) => {
    try {
        const { title, description, location, employment_type, course_target, expected_salary, requirements, groups, interview_details } = req.body;
        const interviewDetails = interview_details == null ? null : normalizeInterviewDetails(interview_details);
        const interviewDetailsError = interviewDetails ? validateInterviewDetails(interviewDetails) : null;
        if (interviewDetailsError) return res.status(400).json({ msg: interviewDetailsError });
        const normalizedEmploymentType = String(employment_type ?? "").trim()
            ? normalizeEmploymentType(employment_type)
            : "full-time";

        if (!normalizedEmploymentType) {
            return res.status(400).json({ msg: "Employment type must be one of the supported options." });
        }

        const validatedFields = validateJobFields(req.body);

        const hasRequirements = requirements && Array.isArray(requirements) && requirements.length > 0;

        let postingIdentity;
        const job = await db.sequelize.transaction(async (transaction) => {
            const postingUser = await loadPostingUser(req, transaction);
            postingIdentity = postingUser;
            const createPayload = {
                ...validatedFields,
                employment_type: normalizedEmploymentType,
                course_target: validatedFields.course_target || null,
                employer_id: postingUser.id,
                expected_salary: validatedFields.expected_salary,
                has_requirements: hasRequirements,
                current_requirement_version: hasRequirements ? 1 : 0
            };
            if (interviewDetails) assignInterviewDetails(createPayload, interviewDetails);

            const newJob = await db.Job.create(createPayload, { transaction });

            if (hasRequirements) {
                const createdGroups = await createGroupsForJob(newJob.id, 1, groups, transaction);

                const groupMap = {};
                if (groups && Array.isArray(groups)) {
                    for (let i = 0; i < groups.length; i++) {
                        const createdGroup = createdGroups[i];
                        if (createdGroup) {
                            groupMap[groups[i].tempId || i] = createdGroup.id;
                        }
                    }
                }

                const mappedRequirements = (requirements || []).map((req) => ({
                    ...req,
                    group_id: req.group_temp_id !== undefined ? (groupMap[req.group_temp_id] || null) : (req.group_id || null)
                }));

                await createRequirementsForJob(newJob.id, mappedRequirements, 1, transaction);
            }

            return newJob;
        });

        auditService.log({
            actorId: req.user.id,
            actorRole: postingIdentity.role,
            action: hasRequirements ? "job.requirements.created" : "job.created",
            targetType: "job",
            targetId: job.id,
            metadata: { version: job.current_requirement_version, requirement_count: requirements?.length || 0 },
            ipAddress: req.ip
        });

        const result = await db.Job.findByPk(job.id, {
            include: hasRequirements ? [
                { model: db.JobRequirement, where: { version: job.current_requirement_version }, required: false },
                { model: db.RequirementGroup, where: { version: job.current_requirement_version }, required: false }
            ] : []
        });

        // Notify verified alumni about the new job
        try {
            let alumniIds = [];
            const hasNonEmptyCourseTarget = job.course_target && job.course_target.trim().length > 0;

            if (hasNonEmptyCourseTarget) {
                const alumniInclude = [{
                    model: db.AlumniProfile,
                    where: { course: job.course_target },
                    attributes: []
                }];

                const filteredUsers = await db.User.findAll({
                    where: { role: "alumni", account_status: "verified" },
                    include: alumniInclude,
                    attributes: ["id"]
                });
                alumniIds = filteredUsers.map((u) => u.id);

                // If no alumni match the course_target text, fall back to notifying ALL verified alumni
                // This is because course_target often contains full qualification text rather than
                // exact course codes, so exact matching fails silently.
                if (alumniIds.length === 0) {
                    const allVerifiedUsers = await db.User.findAll({
                        where: { role: "alumni", account_status: "verified" },
                        attributes: ["id"]
                    });
                    alumniIds = allVerifiedUsers.map((u) => u.id);
                }
            } else {
                // No course_target: notify all verified alumni
                const allVerifiedUsers = await db.User.findAll({
                    where: { role: "alumni", account_status: "verified" },
                    attributes: ["id"]
                });
                alumniIds = allVerifiedUsers.map((u) => u.id);
            }

            if (alumniIds.length) {
                try {
                    // Fetch employer profile to get company name
                    const employerProfile = await db.EmployerProfile.findOne({
                        where: { user_id: req.user.id }
                    });

                    const companyName = employerProfile?.organization_name || postingIdentity.name || "An employer";

                    // Build a notification message with job details
                    const message = `A new job opportunity has been posted: "${job.title}" by ${companyName}. View the job details and apply if interested.`;

                    await notificationController.createNotification({
                        userIds: alumniIds,
                        message,
                        subject: "New Job Opportunity",
                        type: "job_posting"
                    });
                } catch (profileErr) {
                    // Fallback to simpler message if profile fetch fails
                    const employerName = postingIdentity.name || "An employer";
                    const message = `A new job opportunity has been posted: "${job.title}" by ${employerName}. View the job details and apply if interested.`;

                    await notificationController.createNotification({
                        userIds: alumniIds,
                        message,
                        subject: "New Job Opportunity",
                        type: "job_posting"
                    });
                }
            }
        } catch (notifErr) {
            console.error("Job notification error:", notifErr.message);
        }

        res.json(result);
    } catch (err) {
        res.status(err.status || 500).json({ msg: err.message });
    }
};

exports.updateJob = async (req, res) => {
    try {
        const postingUser = await loadPostingUser(req);
        const job = await db.Job.findByPk(req.params.id);
        if (!job) return res.status(404).json({ msg: "Job not found" });

        const isOwner = postingUser.role === "employer" && Number(job.employer_id) === Number(postingUser.id);
        const isAdmin = postingUser.role === "admin" && postingUser.admin_scope === "employer";
        if (!isOwner && !isAdmin) return res.status(403).json({ msg: "Not allowed." });

        const { title, description, location, employment_type, course_target, expected_salary, requirements, groups, interview_details } = req.body;
        const interviewDetails = interview_details === undefined || interview_details === null
            ? null
            : normalizeInterviewDetails(interview_details);
        const interviewDetailsError = interview_details === undefined || interview_details === null
            ? null
            : validateInterviewDetails(interviewDetails);
        if (interviewDetailsError) return res.status(400).json({ msg: interviewDetailsError });
        const normalizedEmploymentType = employment_type === undefined
            ? undefined
            : String(employment_type ?? "").trim()
                ? normalizeEmploymentType(employment_type)
                : "full-time";

        if (employment_type !== undefined && !normalizedEmploymentType) {
            return res.status(400).json({ msg: "Employment type must be one of the supported options." });
        }

        const validatedFields = validateJobFields(req.body, false);

        const hasRequirements = requirements && Array.isArray(requirements) && requirements.length > 0;
        let savedRequirementVersion = job.current_requirement_version;

        await db.sequelize.transaction(async (transaction) => {
            await loadPostingUser(req, transaction);
            const updateFields = { ...validatedFields };
            if (normalizedEmploymentType !== undefined) updateFields.employment_type = normalizedEmploymentType;
            if (interviewDetails) assignInterviewDetails(updateFields, interviewDetails);

            if (hasRequirements) {
                const nextVersion = await getNextRequirementVersion(job.id, transaction);
                savedRequirementVersion = nextVersion;
                updateFields.current_requirement_version = nextVersion;
                updateFields.has_requirements = true;

                const createdGroups = await createGroupsForJob(job.id, nextVersion, groups, transaction);

                const groupMap = {};
                if (groups && Array.isArray(groups)) {
                    for (let i = 0; i < groups.length; i++) {
                        const createdGroup = createdGroups[i];
                        if (createdGroup) {
                            groupMap[groups[i].tempId || i] = createdGroup.id;
                        }
                    }
                }

                const mappedRequirements = (requirements || []).map((req) => ({
                    ...req,
                    group_id: req.group_temp_id !== undefined ? (groupMap[req.group_temp_id] || null) : (req.group_id || null)
                }));

                await createRequirementsForJob(job.id, mappedRequirements, nextVersion, transaction);
            } else if (requirements !== undefined) {
                savedRequirementVersion = 0;
                updateFields.current_requirement_version = 0;
                updateFields.has_requirements = false;
            }

            await db.Job.update(updateFields, {
                where: { id: job.id },
                transaction
            });
        });

        auditService.log({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: hasRequirements ? "job.requirements.updated" : "job.updated",
            targetType: "job",
            targetId: job.id,
            metadata: { previous_version: job.current_requirement_version, new_version: savedRequirementVersion },
            ipAddress: req.ip
        });

        const updatedJob = await db.Job.findByPk(job.id, {
            include: hasRequirements ? [
                { model: db.JobRequirement, where: { version: savedRequirementVersion }, required: false },
                { model: db.RequirementGroup, where: { version: savedRequirementVersion }, required: false }
            ] : []
        });

        res.json(updatedJob);
    } catch (err) {
        res.status(err.status || 500).json({ msg: err.message });
    }
};

exports.getJobInterviewDetails = async (req, res) => {
    try {
        const job = await db.Job.findByPk(req.params.id);
        if (!job) return res.status(404).json({ msg: "Job not found." });
        const isOwner = req.user?.role === "employer" && Number(job.employer_id) === Number(req.user.id);
        const isEmployerAdmin = req.user?.role === "admin" && req.user?.admin_scope === "employer";
        if (!isOwner && !isEmployerAdmin) return res.status(403).json({ msg: "You can only manage interview details for your own jobs." });

        const interview_details = detailsFromJob(job);
        const complete = !validateInterviewDetails(interview_details);
        return res.json({ job: { id: job.id, title: job.title }, interview_details, configured: complete });
    } catch (err) {
        return res.status(500).json({ msg: err.message });
    }
};

exports.updateJobInterviewDetails = async (req, res) => {
    try {
        const job = await db.Job.findByPk(req.params.id);
        if (!job) return res.status(404).json({ msg: "Job not found." });
        const isOwner = req.user?.role === "employer" && Number(job.employer_id) === Number(req.user.id);
        const isEmployerAdmin = req.user?.role === "admin" && req.user?.admin_scope === "employer";
        if (!isOwner && !isEmployerAdmin) return res.status(403).json({ msg: "You can only manage interview details for your own jobs." });

        const details = normalizeInterviewDetails(req.body?.interview_details);
        const validationError = validateInterviewDetails(details);
        if (validationError) return res.status(400).json({ msg: validationError });

        assignInterviewDetails(job, details);
        await job.save();
        auditService.log({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: "job.interview_details.updated",
            targetType: "job",
            targetId: job.id,
            ipAddress: req.ip
        });
        return res.json({
            msg: "Interview invitation details updated.",
            job: { id: job.id, title: job.title },
            interview_details: details,
            configured: true
        });
    } catch (err) {
        return res.status(500).json({ msg: err.message });
    }
};

exports.getJobs = async (req, res) => {
    try {
        const where = {};

        const isEmployerAdmin = req.user?.role === "admin" && req.user?.admin_scope === "employer";
        const isEmployer = req.user?.role === "employer";

        if (isEmployerAdmin || isEmployer) {
            where.employer_id = req.user.id;
        } else {
            // For public users and non-employer admins, only show active jobs
            where.recruitment_status = "active";
        }

        console.log("=== JOBS ENDPOINT DEBUG ===");
        console.log("Request path:", req.originalUrl);
        console.log("Authenticated user:", JSON.stringify({ id: req.user?.id, role: req.user?.role, admin_scope: req.user?.admin_scope }));
        console.log("Query where clause:", JSON.stringify(where));

        const queryInterface = db.sequelize.getQueryInterface();

        const jobAttributes = getExistingAttributes(
            (await getTableColumns(queryInterface, db.Job.getTableName())) || {},
            [
                "id", "title", "description", "location", "employment_type",
                "course_target", "expected_salary", "posting_details", "employer_id",
                "current_requirement_version", "has_requirements",
                "recruitment_status",
                "interview_venue", "interview_place", "interview_date", "interview_time",
                "interview_contact_info", "interview_what_to_bring",
                "createdAt", "updatedAt"
            ],
            ["id", "title", "description", "location", "employment_type", "course_target", "employer_id", "recruitment_status", "createdAt", "updatedAt"]
        );
        const userAttributes = getExistingAttributes(
            (await getTableColumns(queryInterface, db.User.getTableName())) || {},
            ["id", "name", "role", "admin_scope", "admin_avatar_url"],
            ["id", "name", "role"]
        );
        const employerProfileAttributes = getExistingAttributes(
            (await getTableColumns(queryInterface, db.EmployerProfile.getTableName())) || {},
            ["logo_url", "organization_name", "industry", "verified"],
            ["logo_url"]
        );
        const alumniProfileAttributes = getExistingAttributes(
            (await getTableColumns(queryInterface, db.AlumniProfile.getTableName())) || {},
            ["avatar_url"],
            ["avatar_url"]
        );

        const jobs = await db.Job.findAll({
            attributes: jobAttributes,
            where,
            include: [
                {
                    model: db.User,
                    attributes: userAttributes,
                    include: [
                        { model: db.EmployerProfile, attributes: employerProfileAttributes },
                        { model: db.AlumniProfile, attributes: alumniProfileAttributes }
                    ]
                }
            ],
            order: [["createdAt", "DESC"]]
        });

        console.log("Jobs returned:", jobs.length);
        console.log("Returned job employer_ids:", JSON.stringify(jobs.map((job) => job.employer_id)));

        const result = await Promise.all(jobs.map(async (job) => {
            const jobJson = jobForViewer(job, req.user);
            if (job.has_requirements && job.current_requirement_version > 0) {
                const requirements = await db.JobRequirement.findAll({
                    where: { job_id: job.id, version: job.current_requirement_version },
                    order: [["sort_order", "ASC"]]
                });
                const groups = await db.RequirementGroup.findAll({
                    where: { job_id: job.id, version: job.current_requirement_version },
                    order: [["sort_order", "ASC"]]
                });
                jobJson.requirements = requirements;
                jobJson.requirement_groups = groups;
            }
            return jobJson;
        }));

        res.json(result);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.getJobById = async (req, res) => {
    try {
        const job = await db.Job.findByPk(req.params.id, {
            include: [{ model: db.User, attributes: ["id", "name", "role", "admin_scope", "admin_avatar_url"], include: [{ model: db.EmployerProfile, attributes: ["organization_name", "industry", "logo_url", "verified"] }] }]
        });
        if (!job) return res.status(404).json({ msg: "Job not found" });

        const isAdmin = req.user?.role === "admin";
        const isOwner = req.user?.role === "employer" && job.employer_id === req.user.id;
        const isAlumni = req.user?.role === "alumni";

        // Allow alumni to view active jobs, admin/owner to view any job
        if (!isAdmin && !isOwner) {
            if (isAlumni && job.recruitment_status === "active") {
                // Alumni can view active jobs
            } else {
                return res.status(403).json({ msg: "This job is not available." });
            }
        }

        const jobJson = jobForViewer(job, req.user);

        if (job.has_requirements && job.current_requirement_version > 0) {
            const requirements = await db.JobRequirement.findAll({
                where: { job_id: job.id, version: job.current_requirement_version },
                order: [["sort_order", "ASC"]]
            });
            const groups = await db.RequirementGroup.findAll({
                where: { job_id: job.id, version: job.current_requirement_version },
                order: [["sort_order", "ASC"]]
            });
            jobJson.requirements = requirements;
            jobJson.requirement_groups = groups;
        }

        res.json(jobJson);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.getJobRequirements = async (req, res) => {
    try {
        const job = await db.Job.findByPk(req.params.id);
        if (!job) return res.status(404).json({ msg: "Job not found" });

        const version = req.query.version ? parseInt(req.query.version, 10) : job.current_requirement_version;

        if (version === 0 || !job.has_requirements) {
            return res.json({ version: 0, requirements: [], groups: [] });
        }

        const requirements = await db.JobRequirement.findAll({
            where: { job_id: job.id, version },
            order: [["sort_order", "ASC"]]
        });
        const groups = await db.RequirementGroup.findAll({
            where: { job_id: job.id, version },
            order: [["sort_order", "ASC"]]
        });

        res.json({ version, requirements, groups });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.getRequirementVersions = async (req, res) => {
    try {
        const versions = await db.JobRequirement.findAll({
            attributes: [[db.Sequelize.fn("DISTINCT", db.Sequelize.col("version")), "version"]],
            where: { job_id: req.params.job_id },
            order: [["version", "DESC"]]
        });

        const versionList = versions.map((v) => v.getDataValue("version"));
        res.json(versionList);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.getJobPreview = async (req, res) => {
    try {
        const job = await db.Job.findByPk(req.params.id);
        if (!job) return res.status(404).json({ msg: "Job not found" });

        const isOwner = req.user?.role === "employer" && job.employer_id === req.user.id;
        const isAdmin = req.user?.role === "admin";
        if (!isOwner && !isAdmin) return res.status(403).json({ msg: "Not allowed." });

        if (!job.has_requirements || job.current_requirement_version === 0) {
            return res.json({
                has_requirements: false,
                message: "This job uses the legacy application system. No dynamic requirements configured."
            });
        }

        const requirements = await db.JobRequirement.findAll({
            where: { job_id: job.id, version: job.current_requirement_version },
            order: [["sort_order", "ASC"]]
        });
        const groups = await db.RequirementGroup.findAll({
            where: { job_id: job.id, version: job.current_requirement_version },
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

        res.json({
            job_id: job.id,
            title: job.title,
            version: job.current_requirement_version,
            groups: groupedPreview,
            ungrouped
        });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.stopRecruitment = async (req, res) => {
    try {
        const resolvedJobId = req.params.jobId || req.params.id;

        console.log("=== STOP RECRUITMENT DEBUG ===");
        console.log("req.originalUrl:", req.originalUrl);
        console.log("req.params:", JSON.stringify(req.params));
        console.log("resolvedJobId:", resolvedJobId);
        console.log("typeof resolvedJobId:", typeof resolvedJobId);

        const job = await db.Job.findByPk(resolvedJobId);

        console.log("Job table:", db.Job.getTableName());
        console.log("Job.findByPk result:", job ? { id: job.id, recruitment_status: job.recruitment_status } : null);

        if (!job) {
            console.log("=== 404 RETURNED HERE ===");
            console.log("Querying table:", db.Job.getTableName());
            const directCount = await db.sequelize.query(`SELECT COUNT(*) as cnt FROM ${db.Job.getTableName()} WHERE id = :id`, { replacements: { id: resolvedJobId }, type: "SELECT" });
            console.log("Direct SQL count result:", directCount);
            return res.status(404).json({ msg: "Job not found" });
        }

        const isOwner = req.user?.role === "employer" && job.employer_id === req.user.id;
        const isAdminEmployer = req.user?.role === "admin" && req.user?.admin_scope === "employer";
        const isSuperAdmin = req.user?.role === "admin" && !req.user?.admin_scope;

        if (!isOwner && !isAdminEmployer && !isSuperAdmin) {
            return res.status(403).json({ msg: "Not allowed." });
        }

        if (job.recruitment_status === "closed") {
            return res.status(400).json({ msg: "Recruitment is already stopped for this job." });
        }

        job.recruitment_status = "closed";
        await job.save();

        auditService.log({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: "job.recruitment.stopped",
            targetType: "job",
            targetId: job.id,
            ipAddress: req.ip
        });

        res.json(job);
    } catch (err) {
        console.error("Stop recruitment error:", err);
        res.status(500).json({ msg: err.message });
    }
};

exports.reactivateRecruitment = async (req, res) => {
    try {
        const jobId = req.params.jobId || req.params.id;

        const job = await db.Job.findByPk(jobId);

        if (!job) return res.status(404).json({ msg: "Job not found" });

        const isOwner = req.user?.role === "employer" && job.employer_id === req.user.id;
        const isAdminEmployer = req.user?.role === "admin" && req.user?.admin_scope === "employer";
        const isSuperAdmin = req.user?.role === "admin" && !req.user?.admin_scope;

        if (!isOwner && !isAdminEmployer && !isSuperAdmin) {
            return res.status(403).json({ msg: "Not allowed." });
        }

        if (job.recruitment_status === "active") {
            return res.status(400).json({ msg: "Recruitment is already active for this job." });
        }

        const nextCycle = (parseInt(await db.Application.max("recruitment_cycle", { where: { job_id: job.id } }) || "0") + 1);

        await db.sequelize.transaction(async (transaction) => {
            job.recruitment_status = "active";
            await job.save({ transaction });

            await db.Application.update(
                { recruitment_cycle: nextCycle },
                { where: { job_id: job.id }, transaction }
            );
        });

        auditService.log({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: "job.recruitment.reactivated",
            targetType: "job",
            targetId: job.id,
            metadata: { new_cycle: nextCycle },
            ipAddress: req.ip
        });

        const updated = await db.Job.findByPk(job.id);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.deleteJob = async (req, res) => {
    try {
        const job = await db.Job.findByPk(req.params.id);
        if (!job) return res.status(404).json({ msg: "Job not found" });

        const isOwner = req.user?.role === "employer" && job.employer_id === req.user.id;
        if (!isOwner) return res.status(403).json({ msg: "Not allowed." });

        await db.Application.destroy({ where: { job_id: job.id } });
        await db.JobRequirement.destroy({ where: { job_id: job.id } });
        await db.RequirementGroup.destroy({ where: { job_id: job.id } });
        await job.destroy();

        auditService.log({
            actorId: req.user.id,
            actorRole: "employer",
            action: "job.deleted",
            targetType: "job",
            targetId: job.id,
            ipAddress: req.ip
        });

        res.json({ msg: "Job deleted." });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};
