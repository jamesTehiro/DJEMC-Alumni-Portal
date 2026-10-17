const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const auth = require("../controllers/authController");
const records = require("../controllers/alumniRecordController");
const { isValidGraduationYear, GRADUATION_YEAR_ERROR } = require("../utils/graduationYear");
const { nameTokens, tolerantNameWhere } = require("../utils/alumniNameSearch");
test.after(() => db.sequelize.close());
test("registration persists both allowed boundary years through the normal transaction", async () => {
    const saved = [db.User.findOne, db.User.create, db.AlumniProfile.findOrCreate, db.sequelize.transaction];
    let storedYear;
    db.User.findOne = async () => null;
    db.User.create = async values => ({ id: 71, ...values });
    db.AlumniProfile.findOrCreate = async options => { storedYear = options.defaults.graduation_year; return [{}, true]; };
    db.sequelize.transaction = callback => callback({});
    try {
        for (const year of ["2023", "2027"]) {
            const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
            await auth.register({ body: { name: "Test", email: "year@example.invalid", password: "test-password", role: "alumni", graduationYear: year } }, res, error => { throw error; });
            assert.equal(res.code, 201);
            assert.equal(storedYear, year);
        }
    } finally { [db.User.findOne, db.User.create, db.AlumniProfile.findOrCreate, db.sequelize.transaction] = saved; }
});
test("only four-digit years 2023–2027 pass both frontend and backend validators", async () => {
    const frontend = await import("../../frontend/alumni-portal/src/utils/graduationYear.js");
    for (const value of ["2023", "2027", 2023, 2027, "2025"]) {
        assert.equal(isValidGraduationYear(value), true);
        assert.equal(frontend.isValidGraduationYear(value), true);
    }
    for (const value of ["2022", "2028", "abcd", "2e3", "2023.0", " 2023 ", "20230", "", null, undefined, [], {}]) {
        assert.equal(isValidGraduationYear(value), false);
        assert.equal(frontend.isValidGraduationYear(value), false);
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        await auth.register({ body: { name: "Test", email: "year@example.invalid", password: "password", role: "alumni", graduationYear: value } }, res, error => { throw error; });
        assert.equal(res.code, 400);
        assert.equal(res.body.msg, GRADUATION_YEAR_ERROR);
    }
});
test("name search falls back to all significant name tokens and retains official records", async () => {
    assert.deepEqual(nameTokens(" Judyvie  E. NOVO "), ["judyvie", "e", "novo"]);
    assert.equal(tolerantNameWhere(". % _"), null);
    const original = db.AlumniRecord.findAll;
    const calls = [];
    const official = [{ id: 51, full_name: "Novo, Judyvie", course: "Fixture", batch_year: 2023 }];
    db.AlumniRecord.findAll = async options => { calls.push(options); return calls.length === 1 ? [] : official; };
    try {
        let result;
        await records.searchAlumniRecords({ query: { name: "Judyvie E. Novo" } }, { json: body => { result = body; }, status() { throw Error("search failed"); } });
        assert.equal(result, official);
        assert.equal(calls.length, 2);
        const tokens = calls[1].where[db.Sequelize.Op.and];
        assert.equal(tokens.length, 2);
        assert.equal(tokens[0].logic[db.Sequelize.Op.like], "%judyvie%");
        assert.equal(tokens[1].logic[db.Sequelize.Op.like], "%novo%");
        assert.equal(calls[1].include[0].required, false);
    } finally { db.AlumniRecord.findAll = original; }
});
