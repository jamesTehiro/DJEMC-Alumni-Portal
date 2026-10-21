const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { Sequelize, DataTypes, QueryTypes } = require("sequelize");
const migration = require("../migrations/20261021-add-alumni-major");

// Opt-in, loopback only. Create a new fixture schema; never alter or delete a
// pre-existing database. The fixture schema is intentionally retained for review.
test("isolated local database preserves historical rows, proof references, indexes and foreign keys across repeated migration", { skip: process.env.RUN_ACADEMIC_DATABASE_TESTS !== "true" }, async t => {
    const env = require("dotenv").parse(fs.readFileSync(path.join(__dirname, "..", ".env")));
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(env.DB_HOST), "Only the local development server may host this fixture.");
    const database = `djemc_academic_${Date.now()}_test`;
    assert.match(database, /^djemc_academic_\d+_test$/);
    assert.notEqual(database, env.DB_NAME);
    const options = { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASS };
    let connection, sequelize;
    try {
        connection = await mysql.createConnection(options);
        const [[identity]] = await connection.query("SELECT VERSION() AS server_version");
        await connection.query(`CREATE DATABASE \`${database}\``);
        sequelize = new Sequelize(database, options.user, options.password, { host: options.host, port: options.port, dialect: "mysql", logging: false });
        const qi = sequelize.getQueryInterface();
        const id = () => ({ type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true });
        await qi.createTable("alumnirecords", { id: id(), full_name: DataTypes.STRING, course: DataTypes.STRING, batch_year: DataTypes.INTEGER, student_id: { type: DataTypes.STRING, unique: true } });
        await qi.createTable("users", { id: id(), alumni_record_id: { type: DataTypes.INTEGER, references: { model: "alumnirecords", key: "id" } } });
        await qi.createTable("alumniprofiles", { id: id(), user_id: { type: DataTypes.INTEGER, references: { model: "users", key: "id" } }, course: DataTypes.STRING, graduation_year: DataTypes.INTEGER, proof_document_path: DataTypes.TEXT });
        const courses = ["BSBA", "BSED", "BSIT", "AB", "CRIM", "BEED"];
        await qi.bulkInsert("alumnirecords", courses.map((course, index) => ({ id: index + 1, full_name: `Fixture ${index + 1}`, course, batch_year: 2000 + index, student_id: `FIX-${index + 1}` })));
        await qi.bulkInsert("users", courses.map((_, index) => ({ id: index + 1, alumni_record_id: index + 1 })));
        await qi.bulkInsert("alumniprofiles", courses.map((course, index) => ({ id: index + 1, user_id: index + 1, course, graduation_year: 2000 + index, proof_document_path: `/fixture/proof-${index + 1}.pdf` })));
        const snapshot = async () => {
            const records = await sequelize.query("SELECT id, full_name, course, batch_year, student_id FROM alumnirecords ORDER BY id", { type: QueryTypes.SELECT });
            const profiles = await sequelize.query("SELECT id, user_id, course, graduation_year, proof_document_path FROM alumniprofiles ORDER BY id", { type: QueryTypes.SELECT });
            const indexes = await Promise.all(["alumnirecords", "alumniprofiles", "users"].map(table => qi.showIndex(table)));
            const foreignKeys = await sequelize.query("SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME", { type: QueryTypes.SELECT });
            return { records, profiles, indexes, foreignKeys };
        };
        const before = await snapshot();
        assert.equal((await migration.inspect(qi)).length, 2);
        await migration.up(qi, DataTypes);
        assert.deepEqual(await snapshot(), before);
        await migration.up(qi, DataTypes);
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await migration.inspect(qi), []);
        for (const table of ["alumnirecords", "alumniprofiles"]) {
            const columns = await qi.describeTable(table);
            assert.equal(columns.major.type.toUpperCase(), "VARCHAR(255)");
            assert.equal(columns.major.allowNull, true);
            assert.equal((await sequelize.query(`SELECT COUNT(*) AS missing FROM \`${table}\` WHERE major IS NULL`, { type: QueryTypes.SELECT }))[0].missing, 6);
        }
        await sequelize.query("UPDATE alumniprofiles SET major = :major WHERE id = 1", { replacements: { major: "Marketing Management" } });
        const [saved] = await sequelize.query("SELECT course, major, proof_document_path FROM alumniprofiles WHERE id = 1", { type: QueryTypes.SELECT });
        assert.deepEqual(saved, { course: "BSBA", major: "Marketing Management", proof_document_path: "/fixture/proof-1.pdf" });
        assert.deepEqual(await snapshot(), before);
        t.diagnostic(JSON.stringify({ host: options.host, disposable_database: database, server_version: identity.server_version, preserved_records: 6, preserved_profiles: 6, retained_for_review: true }));
    } finally {
        if (sequelize) await sequelize.close();
        if (connection) await connection.end();
    }
});
