const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const auth = require("../controllers/authController");
const records = require("../controllers/alumniRecordController");
const { otp } = require("../controllers/registrationOtpController");
const { saveAlumniProfile } = require("../services/alumniProfileSave");
const { programs, findProgram, validateAcademicProgram } = require("../utils/academicPrograms");
const { parseCsv, validateCsv, classifyDuplicates } = require("../utils/alumniRecordsCsv");
const migration = require("../migrations/20261021-add-alumni-major");
const runner = require("../scripts/applyAlumniMajorMigration");
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test.after(() => db.sequelize.close());

const cases = programs.flatMap(p => p.majors.length ? p.majors.map(major => [p.value, major]) : [[p.value, null]]);
cases.push(["Historical Diploma", null], ["Historical Diploma", "Public Service"], ["AB", "Historical specialization"]);

test("authoritative configuration preserves historical abbreviations and contains no unverified BSED Biology", () => {
    assert.equal(findProgram("CRIM").value, "BSCRIM");
    assert.equal(findProgram("AB"), undefined);
    assert.deepEqual(findProgram("BSED").majors, ["English", "Science"]);
    for (const course of ["BSIT", "BSBA", "CRIM", "AB", "BEED"]) {
        assert.equal(validateAcademicProgram(course, null, { previous: { course, major: null } }).course, course);
    }
    assert.deepEqual(validateAcademicProgram("  Historical Diploma  ", "  Service  "), { course: "Historical Diploma", major: "Service" });
});

for (const [course, major] of cases) test(`registration stores program and major independently: ${course} / ${major || "none"}`, async t => {
    let stored;
    t.mock.method(db.User, "findOne", async () => null);
    t.mock.method(db.User, "create", async values => ({ id: 501, ...values }));
    t.mock.method(db.AlumniProfile, "findOrCreate", async options => { stored = options.defaults; return [{ id: 601 }]; });
    t.mock.method(db.sequelize, "transaction", callback => callback({}));
    t.mock.method(otp, "consume", async () => ({ update: async () => {} }));
    const res = response();
    await auth.register({ body: { name: "Academic Fixture", email: "academic.fixture@gmail.com", password: "FixturePassword123!", role: "alumni", graduationYear: "2024", course, major }, files: {} }, res, error => { throw error; });
    assert.equal(res.code, 201);
    assert.equal(stored.course, course);
    assert.equal(stored.major, major);
    assert.equal(stored.graduation_year, "2024");
});

test("registration rejects missing/invalid/incompatible majors before OTP consumption or database writes", async t => {
    t.mock.method(db.User, "create", async () => assert.fail("Unexpected write"));
    t.mock.method(otp, "consume", async () => assert.fail("Unexpected OTP consumption"));
    for (const [course, major] of [["BSBA", null], ["BSED", "Biology"], ["BSBA", "English"], ["BSIT", "Science"], ["", "English"]]) {
        let error;
        await auth.register({ body: { name: "Fixture", email: "fixture@gmail.com", password: "password", role: "alumni", graduationYear: "2024", course, major } }, response(), value => { error = value; });
        assert.equal(error.status, 400);
    }
});

test("legacy three-column CSV and new four-column CSV validate majors without changing duplicate identity", () => {
    const review = text => validateCsv(parseCsv(Buffer.from(text)));
    assert.equal(review("full_name,course,batch_year\nLegacy Alum,BSIT,2024").validRows.length, 1);
    assert.match(review("full_name,course,batch_year\nNew Alum,BSBA,2024").issues[0].message, /Major/);
    const result = review("full_name,course,batch_year,major\nFirst Alum,BSBA,2024,Marketing Management\nSecond Alum,BSED,2024,Science\nCustom Alum,Historical Diploma,1995,Service\nInvalid Alum,BSED,2024,Biology\nIncompatible Alum,BSIT,2024,English");
    assert.equal(result.validRows.length, 3);
    assert.equal(result.issues.length, 2);
    assert.equal(result.validRows[2].record.major, "Service");
    const duplicate = { ...result.validRows[0].record, major: "Financial Management" };
    assert.equal(classifyDuplicates(result.validRows, [duplicate]).issues.length, 1);
    for (const prefix of ["=", "+", "-", "@"]) assert.match(review(`full_name,course,batch_year,major\nCustom Alum,Historical Diploma,1995,${prefix}Service`).issues[0].message, /formula/);
});

test("manual create and edit keep majors independent, retain legacy records and protect duplicate identities", async t => {
    const tx = { LOCK: { UPDATE: "UPDATE" }, commit: async () => {}, rollback: async () => {} };
    const stored = { id: 6, full_name: "Legacy Alum", course: "BSBA", major: null, batch_year: 2020, email: "legacy@example.invalid", student_id: "ID-6", update: async values => Object.assign(stored, values) };
    t.mock.method(db.sequelize, "transaction", async () => tx);
    t.mock.method(db.User, "findOne", async () => ({ id: 100 }));
    const duplicate = t.mock.method(db.AlumniRecord, "findOne", async () => null);
    t.mock.method(db.AlumniRecord, "findByPk", async () => stored);
    let inserted;
    t.mock.method(db.AlumniRecord, "create", async values => { inserted = values; return stored; });
    let res = response();
    await records.createAlumniRecord({ body: { full_name: "New Alum", course: "BSED", major: "English", batch_year: 2024 } }, res);
    assert.equal(res.code, 201);
    assert.equal(inserted.course, "BSED");
    assert.equal(inserted.major, "English");
    res = response();
    await records.updateAlumniRecord({ params: { id: "6" }, body: { full_name: "Legacy Alum Updated" } }, res);
    assert.equal(res.code, 200);
    assert.equal(stored.major, null);
    assert.equal(stored.student_id, "ID-6");
    assert.equal(stored.email, "legacy@example.invalid");
    res = response();
    await records.updateAlumniRecord({ params: { id: "6" }, body: { major: "Financial Management" } }, res);
    assert.equal(res.code, 200);
    assert.equal(stored.course, "BSBA");
    assert.equal(stored.major, "Financial Management");
    res = response();
    await records.updateAlumniRecord({ params: { id: "6" }, body: { course: "BSED" } }, res);
    assert.equal(res.code, 400);
    assert.equal(stored.course, "BSBA");
    duplicate.mock.mockImplementation(async () => ({ id: 7 }));
    res = response();
    await records.updateAlumniRecord({ params: { id: "6" }, body: { full_name: "Duplicate Alum" } }, res);
    assert.equal(res.code, 409);
    const where = duplicate.mock.calls.at(-1).arguments[0].where;
    assert.equal(where.id[db.Sequelize.Op.ne], 6);
});

test("profile saves preserve legacy majors, reject incompatible changes and clear a stale major on program change", async t => {
    const owner = { id: 1, role: "alumni", name: "Fixture", email: "fixture@example.invalid", update: async () => {} };
    const profile = { id: 2, course: "BSBA", major: null, update: async values => Object.assign(profile, values) };
    t.mock.method(db.sequelize, "transaction", callback => callback({ LOCK: { UPDATE: "UPDATE" } }));
    t.mock.method(db.User, "findByPk", async () => owner);
    t.mock.method(db.AlumniProfile, "findOrCreate", async () => [profile]);
    const save = body => saveAlumniProfile({ user: owner, body, normalizeImagePath: value => value });
    await save({ course: "BSBA", major: "" });
    assert.equal(profile.major, null);
    await save({ course: "BSBA", major: "Operations Management" });
    assert.equal(profile.major, "Operations Management");
    await assert.rejects(save({ course: "BSED", major: "Operations Management" }), { status: 400 });
    assert.equal(profile.course, "BSBA");
    await save({ course: "BSIT" });
    assert.equal(profile.course, "BSIT");
    assert.equal(profile.major, null);
});

test("additive migration inspects real table names, preserves existing columns and is idempotent after interruption", async () => {
    const columns = { alumnirecords: { course: { type: "VARCHAR(255)" }, id: {} }, alumniprofiles: { course: { type: "VARCHAR(255)" }, id: {} } };
    const changes = [];
    let interrupted = true;
    const qi = { describeTable: async table => columns[table], addColumn: async (table, name, definition) => {
        if (table === "alumniprofiles" && interrupted) { interrupted = false; throw Error("Simulated interruption"); }
        changes.push([table, name]); columns[table][name] = { type: "VARCHAR(255)", allowNull: definition.allowNull };
    } };
    assert.equal((await migration.inspect(qi)).length, 2);
    await assert.rejects(migration.up(qi, db.Sequelize), /interruption/);
    await migration.up(qi, db.Sequelize);
    await migration.up(qi, db.Sequelize);
    assert.deepEqual(changes, [["alumnirecords", "major"], ["alumniprofiles", "major"]]);
    assert.deepEqual(await migration.inspect(qi), []);
    assert.deepEqual(columns.alumnirecords.course, { type: "VARCHAR(255)" });
    columns.alumnirecords.major.allowNull = false;
    await assert.rejects(migration.inspect(qi), /manual review/);
});

test("migration dry-run performs only metadata reads and apply rejects an unconfirmed target", async () => {
    const output = [];
    const sequelize = {
        config: { host: "isolated.fixture.invalid" }, authenticate: async () => {},
        query: async () => [{ database_name: "academic_fixture", server_version: "8.4.11" }],
        getQueryInterface: () => ({ describeTable: async () => ({ course: { type: "VARCHAR(255)" } }), addColumn: async () => assert.fail("Dry-run wrote schema") })
    };
    await runner.run({ sequelize }, [], value => output.push(JSON.parse(value)));
    assert.equal(output[0].mode, "read-only");
    assert.equal(output[0].changes.length, 2);
    await assert.rejects(runner.run({ sequelize }, ["--apply"]), /reviewed/);
    await assert.rejects(runner.run({ sequelize }, ["--apply", "--host", "production.invalid", "--database", "academic_fixture"]), /mismatch/);
});
