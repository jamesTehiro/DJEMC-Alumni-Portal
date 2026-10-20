const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const auth = require("../controllers/authController");
const { otp } = require("../controllers/registrationOtpController");
const records = require("../controllers/alumniRecordController");
const { isValidGraduationYear, getGraduationYearError, getMaxGraduationYear, MIN_GRADUATION_YEAR } = require("../utils/graduationYear");
const { nameTokens, tolerantNameWhere } = require("../utils/alumniNameSearch");
test.after(() => db.sequelize.close());
test("registration persists the minimum and current maximum years through the normal transaction", async () => {
    const saved = [db.User.findOne, db.User.create, db.AlumniProfile.findOrCreate, db.AlumniProfile.findOne, db.sequelize.transaction, otp.consume];
    otp.consume = async () => ({ verified_at: new Date(), update: async () => {} });
    let storedYear;
    let storedProfile;
    const profile = { save: async () => {} };
    db.User.findOne = async () => null;
    db.User.create = async values => ({ id: 71, ...values });
    db.AlumniProfile.findOrCreate = async options => { storedYear = options.defaults.graduation_year; storedProfile = options.defaults; return [profile, true]; };
    db.AlumniProfile.findOne = async () => profile;
    db.sequelize.transaction = callback => callback({});
    try {
        for (const year of [String(MIN_GRADUATION_YEAR), String(getMaxGraduationYear())]) {
            const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
            await auth.register({ body: { name: "Test Alumni", email: "year.test@gmail.com", password: "test-password", role: "alumni", course: "BSIT", graduationYear: year }, files: { proof_document: [{ filename: "proof.pdf" }] } }, res, error => { throw error; });
            assert.equal(res.code, 201);
            assert.equal(storedYear, year);
            assert.equal(storedProfile.course, "BSIT");
            assert.equal(profile.proof_document_path, "/uploads/documents/proof.pdf");
        }
    } finally { [db.User.findOne, db.User.create, db.AlumniProfile.findOrCreate, db.AlumniProfile.findOne, db.sequelize.transaction, otp.consume] = saved; }
});
test("both validators accept 1885, 2023, and the current year, and reject out-of-range or malformed values", async () => {
    const frontend = await import("../../frontend/alumni-portal/src/utils/graduationYear.js");
    const currentYear = new Date().getFullYear();
    assert.equal(getMaxGraduationYear(), currentYear);
    assert.equal(frontend.getMaxGraduationYear(), currentYear);
    assert.equal(getGraduationYearError(), `Graduation year must be between 1885 and ${currentYear}.`);
    assert.equal(frontend.getGraduationYearError(), `Graduation year must be between 1885 and ${currentYear}.`);
    for (const value of ["1885", 1885, "2023", 2023, String(currentYear), currentYear]) {
        assert.equal(isValidGraduationYear(value), true);
        assert.equal(frontend.isValidGraduationYear(value), true);
    }
    for (const value of ["1884", 1884, String(currentYear + 1), currentYear + 1, "abcd", "2e3", "2023.0", " 2023 ", "20230", "", null, undefined, [], {}]) {
        assert.equal(isValidGraduationYear(value), false);
        assert.equal(frontend.isValidGraduationYear(value), false);
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        await auth.register({ body: { name: "Test", email: "year@example.invalid", password: "password", role: "alumni", graduationYear: value } }, res, error => { throw error; });
        assert.equal(res.code, 400);
        assert.equal(res.body.msg, `Graduation year must be between 1885 and ${currentYear}.`);
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
