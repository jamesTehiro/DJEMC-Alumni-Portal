const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const registrar = require("../controllers/registrarController");

test.after(() => db.sequelize.close());

test("pending alumni queue returns an empty JSON array when no registrations are pending", async () => {
    const originalFindAll = db.User.findAll;
    let query;
    db.User.findAll = async options => { query = options; return []; };
    try {
        let statusCode = 200;
        let body;
        const res = {
            json(value) { body = value; return this; },
            status(code) { statusCode = code; return this; }
        };
        await registrar.getPendingAlumniUsers({}, res);
        assert.equal(statusCode, 200);
        assert.deepEqual(body, []);
        assert.equal(query.where.role, "alumni");
        assert.equal(query.where.account_status, "pending");
        assert.deepEqual(query.include[0].attributes, { include: ["proof_documents"] });
    } finally {
        db.User.findAll = originalFindAll;
    }
});
