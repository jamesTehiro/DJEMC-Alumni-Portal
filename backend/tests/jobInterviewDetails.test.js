const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const jobController = require("../controllers/jobController");
const auditService = require("../services/auditService");

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const withOverrides = async (overrides, run) => {
    const originals = overrides.map(([target, values]) => [
        target,
        Object.fromEntries(Object.keys(values).map((key) => [key, target[key]]))
    ]);
    for (const [target, values] of overrides) Object.assign(target, values);
    try {
        await run();
    } finally {
        for (const [target, values] of originals) Object.assign(target, values);
    }
};

test.after(async () => {
    await db.sequelize.close();
});

test("explicitly supplied interview configuration must be complete", async () => {
    let transactionStarted = false;
    await withOverrides([
        [db.sequelize, { transaction: async () => { transactionStarted = true; } }]
    ], async () => {
        const res = response();
        await jobController.createJob({
            user: { id: 18, role: "employer" },
            body: {
                title: "Office Assistant",
                description: "Support the office team",
                location: "San Jose",
                expected_salary: "25000",
                requirements: [],
                interview_details: { venue: "", place: "", date: "", time: "", contact_info: "" }
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.msg, /venue is required/i);
        assert.equal(transactionStarted, false);
    });
});

test("job creation persists all six interview details on that job", async () => {
    const details = {
        venue: "Main Office",
        place: "123 Rizal Street",
        date: "2026-11-05",
        time: "09:30",
        contact_info: "jobs@example.invalid",
        what_to_bring: "Portfolio"
    };
    let savedPayload;
    const createdJob = { id: 990, current_requirement_version: 0, course_target: null, title: "Office Assistant" };

    await withOverrides([
        [db.sequelize, { transaction: async (callback) => callback({}) }],
        [db.Job, {
            create: async (payload) => { savedPayload = payload; return createdJob; },
            findByPk: async () => createdJob
        }],
        [db.User, { findAll: async () => [], findByPk: async () => ({ id: 18, name: "Example Employer", role: "employer", account_status: "verified" }) }],
        [auditService, { log: async () => null }]
    ], async () => {
        const res = response();
        await jobController.createJob({
            user: { id: 18, name: "Example Employer", role: "employer" },
            ip: "127.0.0.1",
            body: {
                title: "Office Assistant",
                description: "Support the office team",
                location: "San Jose",
                expected_salary: "25000",
                requirements: [],
                interview_details: details
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual({
            venue: savedPayload.interview_venue,
            place: savedPayload.interview_place,
            date: savedPayload.interview_date,
            time: savedPayload.interview_time,
            contact_info: savedPayload.interview_contact_info,
            what_to_bring: savedPayload.interview_what_to_bring
        }, details);
    });
});

test("updating interview details saves only the selected job", async () => {
    const details = {
        venue: "Interview Room 2",
        place: "456 Mabini Street",
        date: "2026-12-10",
        time: "14:15",
        contact_info: "hr@example.invalid",
        what_to_bring: "Resume"
    };
    const selectedJob = {
        id: 991,
        title: "Records Assistant",
        employer_id: 18,
        interview_venue: "Old Venue",
        async save() { this.saved = true; }
    };
    const anotherJob = { id: 992, interview_venue: "Keep This Venue" };
    const lookedUpIds = [];

    await withOverrides([
        [db.Job, { findByPk: async (id) => { lookedUpIds.push(String(id)); return selectedJob; } }],
        [auditService, { log: async () => null }]
    ], async () => {
        const res = response();
        await jobController.updateJobInterviewDetails({
            user: { id: 18, role: "employer" },
            params: { id: "991" },
            body: { interview_details: details },
            ip: "127.0.0.1"
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(lookedUpIds, ["991"]);
        assert.equal(selectedJob.saved, true);
        assert.equal(selectedJob.interview_venue, details.venue);
        assert.equal(anotherJob.interview_venue, "Keep This Venue");
        assert.deepEqual(res.body.interview_details, details);
    });
});

test("employer reloads the selected job's latest saved interview details", async () => {
    const job = {
        id: 993,
        title: "Office Coordinator",
        employer_id: 18,
        interview_venue: "Updated Conference Room",
        interview_place: "789 Mabini Street",
        interview_date: "2026-12-18",
        interview_time: "10:45",
        interview_contact_info: "recruitment@example.invalid",
        interview_what_to_bring: "Updated portfolio"
    };
    await withOverrides([
        [db.Job, { findByPk: async (id) => Number(id) === job.id ? job : null }]
    ], async () => {
        const res = response();
        await jobController.getJobInterviewDetails({
            user: { id: 18, role: "employer" },
            params: { id: String(job.id) }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.configured, true);
        assert.deepEqual(res.body.interview_details, {
            venue: job.interview_venue,
            place: job.interview_place,
            date: job.interview_date,
            time: job.interview_time,
            contact_info: job.interview_contact_info,
            what_to_bring: job.interview_what_to_bring
        });
    });
});

test("another employer cannot read or update a job's interview details", async () => {
    const job = {
        id: 994,
        employer_id: 77,
        interview_venue: "Private Interview Room",
        saved: false,
        async save() { this.saved = true; }
    };
    await withOverrides([
        [db.Job, { findByPk: async () => job }]
    ], async () => {
        const getRes = response();
        await jobController.getJobInterviewDetails({
            user: { id: 18, role: "employer" }, params: { id: "994" }
        }, getRes);
        assert.equal(getRes.statusCode, 403);

        const putRes = response();
        await jobController.updateJobInterviewDetails({
            user: { id: 18, role: "employer" },
            params: { id: "994" },
            body: { interview_details: { venue: "Tampered" } }
        }, putRes);
        assert.equal(putRes.statusCode, 403);
        assert.equal(job.saved, false);
        assert.equal(job.interview_venue, "Private Interview Room");
    });
});

test("employer-scoped admin loads, updates, and reloads its selected job's interview details", async () => {
    const details = {
        venue: "Administration Conference Room",
        place: "321 Bonifacio Street",
        date: "2026-12-22",
        time: "13:30",
        contact_info: "admin-recruitment@example.invalid",
        what_to_bring: "Resume and portfolio"
    };
    const selectedJob = {
        id: 995,
        title: "Administrative Assistant",
        employer_id: 43,
        interview_venue: "Original Conference Room",
        interview_place: "Previous Address",
        interview_date: "2026-11-05",
        interview_time: "09:00",
        interview_contact_info: "previous@example.invalid",
        interview_what_to_bring: "Resume",
        async save() { this.saved = true; }
    };
    const anotherJob = { id: 996, interview_venue: "Keep This Venue" };
    const lookedUpIds = [];
    const request = {
        user: { id: 43, role: "admin", admin_scope: "employer" },
        params: { id: String(selectedJob.id) },
        ip: "127.0.0.1"
    };

    await withOverrides([
        [db.Job, { findByPk: async (id) => {
            lookedUpIds.push(String(id));
            return Number(id) === selectedJob.id ? selectedJob : anotherJob;
        } }],
        [auditService, { log: async () => null }]
    ], async () => {
        const initialRes = response();
        await jobController.getJobInterviewDetails(request, initialRes);
        assert.equal(initialRes.statusCode, 200);
        assert.equal(initialRes.body.configured, true);
        assert.deepEqual(initialRes.body.job, { id: selectedJob.id, title: selectedJob.title });
        assert.deepEqual(initialRes.body.interview_details, {
            venue: "Original Conference Room",
            place: "Previous Address",
            date: "2026-11-05",
            time: "09:00",
            contact_info: "previous@example.invalid",
            what_to_bring: "Resume"
        });

        const putRes = response();
        await jobController.updateJobInterviewDetails({
            ...request,
            body: { interview_details: details }
        }, putRes);
        assert.equal(putRes.statusCode, 200);
        assert.equal(putRes.body.configured, true);
        assert.deepEqual(putRes.body.interview_details, details);
        assert.equal(selectedJob.saved, true);

        const latestRes = response();
        await jobController.getJobInterviewDetails(request, latestRes);
        assert.equal(latestRes.statusCode, 200);
        assert.equal(latestRes.body.configured, true);
        assert.deepEqual(latestRes.body.interview_details, details);
        assert.deepEqual(lookedUpIds, ["995", "995", "995"]);
        assert.equal(anotherJob.interview_venue, "Keep This Venue");
    });
});

test("admin with another scope cannot read or update interview details even when its id matches the owner", async () => {
    const job = {
        id: 997,
        employer_id: 43,
        interview_venue: "Private Interview Room",
        saved: false,
        async save() { this.saved = true; }
    };

    await withOverrides([
        [db.Job, { findByPk: async () => job }]
    ], async () => {
        for (const scope of ["alumni", "registrar"]) {
            const request = {
                user: { id: 43, role: "admin", admin_scope: scope },
                params: { id: String(job.id) }
            };
            const getRes = response();
            await jobController.getJobInterviewDetails(request, getRes);
            assert.equal(getRes.statusCode, 403);

            const putRes = response();
            await jobController.updateJobInterviewDetails({
                ...request,
                body: { interview_details: { venue: "Tampered" } }
            }, putRes);
            assert.equal(putRes.statusCode, 403);
        }

        assert.equal(job.saved, false);
        assert.equal(job.interview_venue, "Private Interview Room");
    });
});
