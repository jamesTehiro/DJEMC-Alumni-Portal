"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const controller = require("../controllers/membershipController");
const routes = require("../routes/membershipRoutes");

const readinessMessage = "Membership applications are not ready. The administrator must apply the membership migration before using this feature.";
const dependencies = [
    ["User", "users"],
    ["MembershipApplication", "membershipapplications"],
    ["AlumniProfile", "alumniprofiles"],
    ["AlumniRecord", "alumnirecords"],
    ["EmploymentHistory", "employmenthistories"]
];
const response = () => ({
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; }
});

async function readApplication(settings = {}) {
    const queries = [];
    const originalQuery = db.sequelize.query;
    const fixtures = {
        User: { id: 7, name: "Fixture Graduate", email: "fixture@example.invalid", role: "alumni", account_status: "verified", alumni_record_id: settings.linkedRecord === false ? null : 9 },
        MembershipApplication: { id: 4, alumni_user_id: 7, application_status: "draft", personal_details: { first_name: "Saved" }, educational_attainment: [] },
        AlumniProfile: { id: 8, user_id: 7, phone: "", address: "", course: "Profile program", graduation_year: 2025, job_title: "Analyst", current_company: "Fixture Office" },
        AlumniRecord: { id: 9, course: "Official program", batch_year: 2026 },
        EmploymentHistory: { id: 5, alumni_id: 8, company_name: "Fixture Office", position: "Analyst", start_year: 2025, end_year: null, employment_type: "Full-time" }
    };
    db.sequelize.query = async (sql, options) => {
        const model = options.model;
        assert.ok(dependencies.some(([name]) => db[name] === model), `Unexpected query model: ${model?.name}`);
        queries.push({ sql, model: model.name });
        if (model.name === settings.failModel) {
            const error = new Error("Private SQL statement and submitted values must not be exposed");
            error.original = { code: settings.errorCode, sql: "SELECT private_record_contents" };
            throw error;
        }
        if (model === db.AlumniProfile && settings.profile === false) return null;
        if (model === db.MembershipApplication && settings.application === false) return null;
        const row = model.build(fixtures[model.name], { isNewRecord: false, raw: true });
        return options.plain ? row : [row];
    };
    try {
        const res = response();
        await controller.getMyApplication({ user: { id: 7 }, originalUrl: "/api/membership/me" }, res);
        return { res, queries };
    } finally {
        db.sequelize.query = originalQuery;
    }
}

function assertLowercaseQueries(queries) {
    for (const { sql, model } of queries) {
        const table = dependencies.find(([name]) => name === model)[1];
        assert.match(sql, new RegExp("FROM `" + table + "` AS `" + model + "`"));
        assert.doesNotMatch(sql, /`(?:Users|MembershipApplications|AlumniProfiles|AlumniRecords|EmploymentHistories)`/);
        assert.doesNotMatch(sql, /email_queue_jobs|membershipadministrators/i);
    }
}

test.after(() => db.sequelize.close());

test("GET /api/membership/me generates lowercase SQL for its complete read chain", async () => {
    const route = routes.stack.find(layer => layer.route?.path === "/me" && layer.route.methods.get).route;
    assert.equal(route.stack.at(-1).handle, controller.getMyApplication);
    for (const [name, table] of dependencies) {
        assert.equal(db[name], db.sequelize.models[name]);
        assert.equal(db[name].sequelize, db.sequelize);
        assert.equal(db[name].getTableName(), table);
    }
    const { res, queries } = await readApplication();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.application.id, 4);
    assert.equal(res.body.prefill.academic_verified, true);
    assert.equal(res.body.prefill.academic_summary.academic_program, "Official program");
    assert.equal(res.body.prefill.work_experience[0].agency_employer, "Fixture Office");
    assert.deepEqual(queries.map(query => query.model), dependencies.map(([name]) => name));
    assertLowercaseQueries(queries);
    assert.match(queries[0].sql, /WHERE `User`.`id` = 7/);
    assert.match(queries[1].sql, /WHERE `MembershipApplication`.`alumni_user_id` = 7/);
    assert.match(queries[2].sql, /WHERE `AlumniProfile`.`user_id` = 7/);
    assert.match(queries[3].sql, /WHERE `AlumniRecord`.`id` = 9/);
    assert.match(queries[4].sql, /WHERE `EmploymentHistory`.`alumni_id` = 8/);
    assert.equal(res.headers["Cache-Control"], "private, no-store");
});

test("membership reads preserve conditional prefill queries and an absent saved application", async () => {
    for (const profile of [true, false]) {
        const { res, queries } = await readApplication({ linkedRecord: false, profile, application: false });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.application, null);
        assert.equal(res.body.completion.submitted, false);
        assert.equal(res.body.prefill.academic_verified, false);
        assert.deepEqual(queries.map(query => query.model), ["User", "MembershipApplication", "AlumniProfile", ...(profile ? ["EmploymentHistory"] : [])]);
        assertLowercaseQueries(queries);
    }
});

for (const [name] of dependencies) {
    for (const errorCode of ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"]) {
        test(`membership readiness remains a private 503 when ${name} returns ${errorCode}`, async () => {
            const { res, queries } = await readApplication({ failModel: name, errorCode });
            assert.equal(res.statusCode, 503);
            assert.deepEqual(res.body, { msg: readinessMessage });
            assert.equal(res.headers["Cache-Control"], "private, no-store");
            assert.deepEqual(queries.map(query => query.model), dependencies.slice(0, dependencies.findIndex(([model]) => model === name) + 1).map(([model]) => model));
            assertLowercaseQueries(queries);
            assert.doesNotMatch(JSON.stringify(res.body), /SELECT|private_record|submitted values|Fixture|@/);
        });
    }
}
