const test = require("node:test");
const assert = require("node:assert/strict");
process.env.JWT_SECRET = "graduate-tracking-major-fixture-secret";
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../models");
test.after(() => db.sequelize.close());

test("Graduate Tracking API selects and returns both majors unchanged with existing role restrictions", async t => {
    const records = [
        { id: 1, name: "Official Graduate", role: "alumni", AlumniRecord: { course: "BSED", major: "Computer Education", batch_year: 2024 }, AlumniProfile: { course: "BSED", major: "Science", graduation_year: 2024 } },
        { id: 2, name: "Legacy Graduate", role: "alumni", AlumniRecord: { course: "BSBA", major: null, batch_year: 2023 }, AlumniProfile: { course: "BSBA", major: "Accounting", graduation_year: 2023 } },
        { id: 3, name: "Missing Graduate", role: "alumni", AlumniRecord: null, AlumniProfile: null }
    ];
    const snapshot = structuredClone(records);
    let queries = 0;
    t.mock.method(db.User, "findAll", async options => {
        queries++;
        assert.deepEqual(options.where, { role: "alumni" });
        const profile = options.include.find(include => include.model === db.AlumniProfile);
        const official = options.include.find(include => include.model === db.AlumniRecord);
        assert.ok(profile.attributes.includes("major"));
        assert.ok(official.attributes.includes("major"));
        assert.equal(official.as, "AlumniRecord");
        return records.map(record => ({ id: record.id, toJSON: () => structuredClone(record) }));
    });
    t.mock.method(db.AlumniProfileUpdateRequest, "findAll", async () => []);
    const app = express();
    app.use("/api/admin", require("../routes/adminRoutes"));
    const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
    const url = `http://127.0.0.1:${server.address().port}/api/admin/alumni/users`;
    const headers = claims => ({ Authorization: `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}` });
    try {
        const result = await fetch(url, { headers: headers({ id: 101, role: "admin", admin_scope: "alumni" }) });
        assert.equal(result.status, 200);
        const response = await result.json();
        assert.equal(response[0].AlumniRecord.major, "Computer Education");
        assert.equal(response[0].AlumniProfile.major, "Science");
        assert.equal(response[1].AlumniRecord.major, null);
        assert.equal(response[1].AlumniProfile.major, "Accounting");
        assert.equal(response[2].AlumniProfile, null);
        assert.equal(response[2].AlumniRecord, null);
        assert.deepEqual(records, snapshot, "Reading must not backfill or overwrite academic data");
        for (const claims of [null, { id: 2, role: "alumni" }, { id: 3, role: "employer" }, { id: 4, role: "admin", admin_scope: "employer" }, { id: 5, role: "admin", admin_scope: "registrar" }]) {
            const denied = await fetch(url, { headers: claims ? headers(claims) : {} });
            assert.equal(denied.status, claims ? 403 : 401);
        }
        assert.equal(queries, 1, "Unauthorized callers never load the directory");
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test("academic fields retain nullable major columns and existing lowercase table/relationship mappings", () => {
    for (const [model, table] of [[db.AlumniProfile, "alumniprofiles"], [db.AlumniRecord, "alumnirecords"]]) {
        assert.equal(model.getTableName(), table);
        assert.equal(model.rawAttributes.major.field, "major");
        assert.equal(model.rawAttributes.major.allowNull, true);
        assert.equal(model.rawAttributes.major.type.options.length, 255);
    }
    assert.equal(db.User.associations.AlumniRecord.foreignKey, "alumni_record_id");
});
