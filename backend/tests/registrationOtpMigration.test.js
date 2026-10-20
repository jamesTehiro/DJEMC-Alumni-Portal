const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const migration = require("../migrations/20261019-add-registration-gmail-otp");
const { EMAIL_KEY_SQL } = require("../utils/registrationEmail");

function fixture({ duplicates = 0, verificationField = false, idType = "INT", engine = "InnoDB", generatedExpression = EMAIL_KEY_SQL, existingNormalized = false, existingVerifiedAt = false } = {}) {
    const changes = [];
    let normalized = existingNormalized, indexed = false, verifiedAt = existingVerifiedAt, otp = null;
    const indexes = [{ name: "existing_email_unique", unique: true, fields: [{ attribute: "email" }] }];
    const qi = {
        describeTable: async table => table === "users" ? {
            id: { type: idType, primaryKey: true }, email: { type: "VARCHAR(255)", allowNull: true },
            ...(normalized ? { normalized_email: { type: "VARCHAR(255)" } } : {}),
            ...(verificationField ? { email_verified: { type: "BOOLEAN" } } : {}),
            ...(verifiedAt ? { email_verified_at: { type: "DATETIME", allowNull: true } } : {})
        } : Object.fromEntries(Object.entries(otp).map(([name, column]) => [name, { ...column, type: column.type.toString() }])),
        showIndex: async name => name === "registration_email_verifications"
            ? [{ name: "session_hash", unique: true, fields: [{ attribute: "session_hash" }] }]
            : [...indexes, ...(indexed ? [{ name: "users_normalized_email_uq", unique: true, fields: [{ attribute: "normalized_email" }] }] : [])],
        showAllTables: async () => ["users", ...(otp ? ["registration_email_verifications"] : [])],
        createTable: async (name, columns) => { changes.push({ createTable: name }); otp = columns; },
        sequelize: { query: async sql => {
            if (sql.startsWith("SELECT COUNT")) return [{ duplicate_groups: duplicates }];
            if (sql.includes("GENERATION_EXPRESSION")) return normalized ? [{ expression: generatedExpression, extra: "VIRTUAL GENERATED" }] : [];
            if (sql.includes("information_schema.TABLES")) return [{ engine, collation: "utf8mb4_general_ci" }];
            if (sql.startsWith("ALTER TABLE")) {
                changes.push(sql);
                if (sql.includes("ADD COLUMN normalized_email")) normalized = true;
                if (sql.includes("ADD COLUMN email_verified_at")) verifiedAt = true;
                if (sql.includes("ADD UNIQUE INDEX")) indexed = true;
                return [];
            }
            throw new Error("Unexpected SQL in migration fixture");
        } }
    };
    return { qi, changes, indexes };
}

test("read-only OTP inspection reports existing email uniqueness and performs no writes", async () => {
    const f = fixture();
    const report = await migration.inspect(f.qi, Sequelize);
    assert.deepEqual(report.existingEmailUniqueIndexes, ["existing_email_unique"]);
    assert.equal(report.duplicateGroups, 0);
    assert.equal(report.trimLowerDuplicateGroups, 0);
    assert.deepEqual(f.changes, []);
});
test("OTP migration refuses duplicates before any schema or data mutation", async () => {
    const f = fixture({ duplicates: 2 });
    await assert.rejects(migration.up(f.qi, Sequelize), /2 canonical email collision/);
    assert.deepEqual(f.changes, []);
});
test("OTP migration requires review for existing verification fields, engines and key types", async () => {
    for (const options of [{ verificationField: true }, { idType: "BIGINT UNSIGNED" }, { engine: "MyISAM" }]) {
        const f = fixture(options);
        await assert.rejects(migration.up(f.qi, Sequelize), /review|Review|InnoDB/);
        assert.deepEqual(f.changes, []);
    }
});
test("OTP migration uses additive in-place SQL, retains the email index and can resume", async () => {
    const f = fixture();
    await migration.up(f.qi, Sequelize);
    assert.equal(f.changes.length, 4);
    assert.equal(f.changes[0], "ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL DEFAULT NULL, ALGORITHM=INSTANT");
    assert.match(f.changes[1], /GENERATED ALWAYS AS .* VIRTUAL, ALGORITHM=INPLACE, LOCK=NONE$/);
    assert.match(f.changes[2], /ADD UNIQUE INDEX users_normalized_email_uq .*ALGORITHM=INPLACE, LOCK=NONE$/);
    assert.deepEqual(f.changes[3], { createTable: "registration_email_verifications" });
    assert.deepEqual(f.indexes.map(i => i.name), ["existing_email_unique"]);
    await migration.up(f.qi, Sequelize);
    assert.equal(f.changes.length, 4);
    assert.doesNotMatch(f.changes.filter(c => typeof c === "string").join("\n"), /^(?:DELETE|DROP|TRUNCATE|UPDATE|INSERT|REPLACE)\b/im);
});

test("MySQL-normalized _utf8mb4/lcase/escaped-literal expression is accepted as EMAIL_KEY_SQL", async () => {
    const stored = "case when ((substring_index(lcase(trim(`email`)),_utf8mb4\\'@\\',-(1)) in (_utf8mb4\\'gmail.com\\',_utf8mb4\\'googlemail.com\\'))) then concat(replace(substring_index(substring_index(lcase(trim(`email`)),_utf8mb4\\'@\\',1),_utf8mb4\\'+\\',1),_utf8mb4\\'.\\',_utf8mb4\\'\\'),_utf8mb4\\'@gmail.com\\') else lcase(trim(`email`)) end";
    const f = fixture({ generatedExpression: stored, existingNormalized: true, existingVerifiedAt: true });
    const report = await migration.inspect(f.qi, Sequelize);
    assert.equal(report.normalizedColumnPresent, true);
    assert.equal(report.verifiedAtColumnPresent, true);
    assert.equal(report.duplicateGroups, 0);
    assert.deepEqual(f.changes, []);
});

test("a valid MySQL-normalized partial migration resumes without replacing either existing column", async () => {
    const stored = "case when ((substring_index(lcase(trim(`email`)),_utf8mb4\\'@\\',-(1)) in (_utf8mb4\\'gmail.com\\',_utf8mb4\\'googlemail.com\\'))) then concat(replace(substring_index(substring_index(lcase(trim(`email`)),_utf8mb4\\'@\\',1),_utf8mb4\\'+\\',1),_utf8mb4\\'.\\',_utf8mb4\\'\\'),_utf8mb4\\'@gmail.com\\') else lcase(trim(`email`)) end";
    const f = fixture({ generatedExpression: stored, existingNormalized: true, existingVerifiedAt: true });
    await migration.up(f.qi, Sequelize);
    assert.equal(f.changes.length, 2);
    assert.match(f.changes[0], /ADD UNIQUE INDEX users_normalized_email_uq/);
    assert.deepEqual(f.changes[1], { createTable: "registration_email_verifications" });
    assert.doesNotMatch(f.changes.filter(c => typeof c === "string").join("\n"), /ADD COLUMN (?:email_verified_at|normalized_email)/);
    await migration.up(f.qi, Sequelize);
    assert.equal(f.changes.length, 2);
});

test("MySQL-normalized expressions that change normalization semantics remain rejected", async () => {
    const unsafe = [
        EMAIL_KEY_SQL.replace("googlemail.com", "example.com"),
        EMAIL_KEY_SQL.replace("'+', 1", "'+', 2"),
        EMAIL_KEY_SQL.replace("ELSE LOWER(TRIM(`email`))", "ELSE TRIM(`email`)")
    ];
    for (const generatedExpression of unsafe) {
        const f = fixture({ generatedExpression, existingNormalized: true, existingVerifiedAt: true });
        await assert.rejects(migration.inspect(f.qi, Sequelize), /unexpected definition/);
        assert.deepEqual(f.changes, []);
    }
});

test("OTP rollback refuses destructive schema removal", async () => {
    await assert.rejects(migration.down(), /preserve email uniqueness and verification history/);
});
test("OTP migration stops to review another verification table for reuse", async () => {
    const f = fixture();
    f.qi.showAllTables = async () => ["users", "email_verification_otps"];
    await assert.rejects(migration.up(f.qi, Sequelize), /Review them for reuse/);
    assert.deepEqual(f.changes, []);
});
