const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const healthController = require("../controllers/healthController");

const createRes = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    }
});

test("database health confirms connectivity and login-table availability without returning records", async () => {
    const originalAuthenticate = db.sequelize.authenticate;
    const originals = [db.User, db.AlumniProfile, db.EmployerProfile].map((Model) => Model.findOne);
    const checkedModels = [];
    db.sequelize.authenticate = async () => {};
    [db.User, db.AlumniProfile, db.EmployerProfile].forEach((Model, index) => {
        Model.findOne = async (options) => {
            checkedModels.push({ index, options });
            return null;
        };
    });

    try {
        const res = createRes();
        await healthController.getHealth({}, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, {
            status: "ok",
            database: "connected",
            authSchema: "available",
            registrationSchema: "available"
        });
        assert.equal(checkedModels.length, 3);
        assert.ok(checkedModels.every(({ options }) => options.raw === true && options.where));
    } finally {
        db.sequelize.authenticate = originalAuthenticate;
        [db.User, db.AlumniProfile, db.EmployerProfile].forEach((Model, index) => {
            Model.findOne = originals[index];
        });
    }
});

test("database health returns a generic 503 when database verification fails", async () => {
    const originalAuthenticate = db.sequelize.authenticate;
    const originals = [db.User, db.AlumniProfile, db.EmployerProfile].map((Model) => Model.findOne);
    db.sequelize.authenticate = async () => {
        const err = new Error("private connection detail");
        err.code = "ETIMEDOUT";
        throw err;
    };

    try {
        const res = createRes();
        await healthController.getHealth({}, res);
        assert.equal(res.statusCode, 503);
        assert.deepEqual(res.body, { status: "error", database: "unavailable" });
    } finally {
        db.sequelize.authenticate = originalAuthenticate;
        [db.User, db.AlumniProfile, db.EmployerProfile].forEach((Model, index) => {
            Model.findOne = originals[index];
        });
    }
});
