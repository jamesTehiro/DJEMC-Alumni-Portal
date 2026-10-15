const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../models");
const applicationController = require("../controllers/applicationController");

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

test.after(async () => {
    await db.sequelize.close();
});

test("job-specific applicant API returns review-pending and approved statuses for a closed job", async () => {
    const originalJobFind = db.Job.findByPk;
    const originalApplicationMax = db.Application.max;
    const originalApplicationFindAll = db.Application.findAll;
    let queryWhere;

    db.Job.findByPk = async () => ({ id: 44, employer_id: 18, recruitment_status: "closed" });
    db.Application.max = async () => 3;
    db.Application.findAll = async ({ where }) => {
        queryWhere = where;
        return [];
    };

    try {
        const res = response();
        await applicationController.getJobApplicants({
            user: { id: 18, role: "employer" },
            params: { jobId: "44" }
        }, res, (error) => { throw error; });

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, []);
        assert.equal(queryWhere.job_id, "44");
        assert.equal(queryWhere.recruitment_cycle, 3);
        assert.equal(Object.hasOwn(queryWhere, "status"), false);
    } finally {
        db.Job.findByPk = originalJobFind;
        db.Application.max = originalApplicationMax;
        db.Application.findAll = originalApplicationFindAll;
    }
});
