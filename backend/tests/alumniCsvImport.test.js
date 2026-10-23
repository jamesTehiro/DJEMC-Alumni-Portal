const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");

const db = require("../models");
const importController = require("../controllers/alumniRecordImportController");
const alumniRecordController = require("../controllers/alumniRecordController");
const lockRecordWrites = require("../utils/alumniRecordsWriteLock");
const {
    MAX_CSV_BYTES,
    MAX_CSV_ROWS,
    parseCsv,
    validateCsv,
    classifyDuplicates
} = require("../utils/alumniRecordsCsv");

const header = "full_name,course,batch_year,student_id,email";
const csv = (...rows) => Buffer.from([header, ...rows].join("\n"), "utf8");
const reviewed = (buffer) => validateCsv(parseCsv(buffer));
const createRes = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const withOverrides = async (overrides, run) => {
    const originals = overrides.map(([target, values]) => [target, Object.fromEntries(Object.keys(values).map((key) => [key, target[key]]))]);
    for (const [target, values] of overrides) Object.assign(target, values);
    try { await run(); }
    finally { for (const [target, values] of originals) Object.assign(target, values); }
};

// Model calls are replaced for every controller/route test. These staged rows
// model transaction visibility and rollback without touching the real database.
const databaseEqual = (left, right) => {
    if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right);
    return String(left ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase()
        === String(right ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
};
const matchesWhere = (record, where) => Reflect.ownKeys(where).every((key) => {
    if (key === Op.or) return where[key].some((condition) => matchesWhere(record, condition));
    if (key === Op.and) return where[key].every((condition) => matchesWhere(record, condition));
    const value = where[key];
    if (value && typeof value === "object") {
        return Reflect.ownKeys(value).every((operator) => {
            assert.ok(operator === Op.eq || operator === Op.like, "Only literal identity comparisons are expected.");
            return databaseEqual(record[key], value[operator]);
        });
    }
    return databaseEqual(record[key], value);
});

async function withDatabase(options, run) {
    const state = {
        records: (options.existing || []).map((record, index) => ({ id: index + 1, ...record })),
        transactions: [],
        reads: [],
        locks: [],
        writes: [],
        audits: []
    };
    let lockTail = Promise.resolve();
    const visible = (transaction) => [...state.records, ...(transaction?.staged || [])];
    const recordRead = (query = {}) => {
        if (query.transaction) assert.equal(query.transaction.locked, true, "A registrar row must be locked before reading records.");
        state.reads.push(query);
        return visible(query.transaction);
    };
    const insert = async (record, query = {}) => {
        assert.ok(query.transaction, "Every inserted row must belong to a transaction.");
        assert.equal(query.transaction.locked, true);
        state.writes.push({ record, query });
        if (options.failInsertAt === state.writes.length) {
            const error = new Error("private insert failure detail");
            if (options.failInsertName) error.name = options.failInsertName;
            throw error;
        }
        const created = { id: state.records.length + state.writes.length, ...record };
        query.transaction.staged.push(created);
        return created;
    };
    await withOverrides([
        [db.sequelize, { transaction: async (callback) => {
            const transaction = { LOCK: { UPDATE: "UPDATE" }, staged: [], status: "active", locked: false };
            state.transactions.push(transaction);
            transaction.commit = async () => {
                if (options.failCommit) throw new Error("private commit failure detail");
                state.records.push(...transaction.staged);
                transaction.status = "committed";
                transaction.finished = "commit";
                transaction.release?.();
            };
            transaction.rollback = async () => {
                transaction.status = "rolledBack";
                transaction.finished = "rollback";
                transaction.release?.();
            };
            if (typeof callback !== "function") return transaction;
            try {
                const result = await callback(transaction);
                await transaction.commit();
                return result;
            } catch (error) {
                await transaction.rollback();
                throw error;
            } finally { transaction.release?.(); }
        } }],
        [db.User, { findOne: async (query) => {
            assert.deepEqual(query.where, { role: "admin", admin_scope: "registrar" });
            assert.deepEqual(query.order, [["id", "ASC"]]);
            assert.equal(query.lock, query.transaction.LOCK.UPDATE);
            assert.deepEqual(query.attributes, ["id"]);
            const predecessor = lockTail;
            lockTail = new Promise((resolve) => { query.transaction.release = resolve; });
            await predecessor;
            query.transaction.locked = true;
            state.locks.push(query);
            return options.missingRegistrar ? null : { id: 7 };
        }, findByPk: async (id) => ({
            7: { id: 7, role: "admin", admin_scope: "registrar", account_status: "verified" },
            8: { id: 8, role: "admin", admin_scope: "employer", account_status: "verified" },
            9: { id: 9, role: "admin", admin_scope: "alumni", account_status: "verified" },
            10: { id: 10, role: "alumni", admin_scope: null, account_status: "verified" }
        })[id] || null }],
        [db.AlumniRecord, {
            findAll: async (query) => recordRead(query),
            findOne: async (query) => recordRead(query).find((record) => matchesWhere(record, query.where)) || null,
            findByPk: async (id, query) => recordRead(query).find((record) => record.id === id) || null,
            create: insert,
            bulkCreate: async (records, query) => {
                const created = [];
                for (const record of records) created.push(await insert(record, query));
                return created;
            }
        }],
        [db.AuditLog, { create: async (audit, query) => {
            assert.ok(query.transaction);
            assert.equal(query.transaction.locked, true);
            if (options.failAudit) throw new Error("private audit failure detail");
            state.audits.push({ audit, query });
            return { id: 1, ...audit };
        } }]
    ], async () => run(state));
}

const request = (mode, buffer) => ({
    body: { mode },
    file: { buffer },
    user: { id: 7, role: "admin", admin_scope: "registrar" },
    ip: "127.0.0.1"
});

test.after(async () => { await db.sequelize.close(); });

test("CSV preview and import preserve configured/custom majors and skip unchanged majorless legacy duplicates", async () => {
    const content = Buffer.from("full_name,course,batch_year,major\nBusiness Alum,BSBA,2024,Marketing Management\nEducation Alum,BSED,2023,Science\nHistorical Alum,Historical Diploma,1995,Service\nLegacy Business,BSBA,2001,");
    await withDatabase({ existing: [{ full_name: "Legacy Business", course: "BSBA", batch_year: 2001, major: null }] }, async state => {
        const preview = createRes();
        await importController.importCsv(request("preview", content), preview);
        assert.equal(preview.body.errors, 0);
        assert.equal(preview.body.duplicates, 1);
        assert.deepEqual(preview.body.preview.map(row => row.major), ["Marketing Management", "Science", "Service"]);
        assert.equal(state.writes.length, 0);
        const imported = createRes();
        await importController.importCsv(request("import", content), imported);
        assert.equal(imported.statusCode, 201);
        assert.equal(imported.body.inserted, 3);
        assert.equal(state.records.length, 4);
        assert.equal(state.records[0].major, null);
        assert.deepEqual(state.records.slice(1).map(row => row.major), ["Marketing Management", "Science", "Service"]);
    });
});

test("invalid major rows report their line and roll back any otherwise valid import rows", async () => {
    await withDatabase({}, async state => {
        const imported = createRes();
        await importController.importCsv(request("import", Buffer.from("full_name,course,batch_year,major\nValid Alum,BSBA,2024,Operations Management\nInvalid Alum,BSED,2024,Biology")), imported);
        assert.equal(imported.statusCode, 422);
        assert.equal(imported.body.issues[0].row, 3);
        assert.match(imported.body.issues[0].message, /English, Science/);
        assert.equal(state.records.length, 0);
        assert.equal(state.audits.length, 0);
    });
});

test("CSV parser accepts UTF-8 BOM, CRLF, quoted commas, escaped quotes, and reordered headers", () => {
    const parsed = parseCsv(Buffer.from('\uFEFFcourse,batch_year,full_name,student_id,email\r\nBSIT,2020,"Dela Cruz, Ana ""AJ""",,\r\n', "utf8"));
    assert.deepEqual(parsed.headers, ["course", "batch_year", "full_name", "student_id", "email"]);
    assert.equal(parsed.rows[0].row, 2);
    const result = validateCsv(parsed);
    assert.equal(result.issues.length, 0);
    assert.deepEqual(result.validRows[0].record, {
        full_name: 'Dela Cruz, Ana "AJ"', course: "BSIT", major: null, batch_year: 2020, student_id: null, email: null
    });
});

test("CSV parser handles quoted newlines and preserves line numbers for validation", () => {
    const parsed = parseCsv(Buffer.from('full_name,course,batch_year\n"Ana\nCruz",BSIT,2020\nValid Alum,BSIT,2021\n'));
    assert.equal(parsed.rows[0].cells[0], "Ana\nCruz");
    assert.equal(parsed.rows[1].row, 4);
    const result = validateCsv(parsed);
    assert.equal(result.issues[0].row, 2);
    assert.match(result.issues[0].message, /control characters|line breaks/i);
    assert.equal(result.validRows[0].record.full_name, "Valid Alum");
});

test("CSV parser rejects malformed quotes and unterminated quoted fields", () => {
    for (const text of [
        'full_name,course,batch_year\n"Ana,BSIT,2020',
        'full_name,course,batch_year\nAn"a,BSIT,2020',
        'full_name,course,batch_year\n"Ana"extra,BSIT,2020'
    ]) assert.throws(() => parseCsv(Buffer.from(text)), /quote|closing/i);
});

test("CSV parser rejects binary content and malformed UTF-8", () => {
    assert.throws(() => parseCsv(Buffer.from([0xff, 0xfe, 0x41, 0x00])), /UTF-8/i);
    assert.throws(() => parseCsv(Buffer.concat([csv("Ana,BSIT,2020,,"), Buffer.from([0xc3, 0x28])])), /UTF-8/i);
    assert.throws(() => parseCsv(Buffer.from("full_name,course,batch_year\nAna\0,BSIT,2020")), /binary/i);
});

test("CSV parser rejects empty files, incomplete headers, duplicate headers, and unknown headers", () => {
    assert.throws(() => parseCsv(Buffer.alloc(0)), /non-empty/i);
    assert.throws(() => parseCsv(Buffer.from("full_name,course,batch_year\n")), /at least one/i);
    assert.throws(() => parseCsv(Buffer.from("full_name,course\nAna,BSIT")), /required.*headers/i);
    assert.throws(() => parseCsv(Buffer.from("full_name,course,batch_year,Full_Name\nAna,BSIT,2020,Ana")), /duplicate.*headers/i);
    for (const extra of ["password", "__proto__", "constructor"]) {
        assert.throws(() => parseCsv(Buffer.from(`full_name,course,batch_year,${extra}\nAna,BSIT,2020,value`)), /allowed headers/i);
    }
});

test("CSV parser enforces file, record, and column limits", () => {
    assert.throws(() => parseCsv(Buffer.alloc(MAX_CSV_BYTES + 1, 65)), (error) => error.status === 413);
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `Alum ${index},BSIT,2020`);
    assert.throws(() => parseCsv(Buffer.from(["full_name,course,batch_year", ...rows].join("\n"))), /at most.*records/i);
    assert.throws(() => parseCsv(Buffer.from(`${header},major,extra\nAna,BSIT,2020,,,,value`)), /too many.*columns/i);
    const accepted = parseCsv(Buffer.from(["full_name,course,batch_year", ...rows.slice(0, MAX_CSV_ROWS)].join("\n")));
    assert.equal(accepted.rows.length, MAX_CSV_ROWS);
});

test("CSV validation reports ragged rows and required values without accepting them", () => {
    const result = reviewed(Buffer.from("full_name,course,batch_year\nAna,BSIT\n,BSIT,2020\nAna,,2020\nAna,BSIT,2020,extra"));
    assert.equal(result.validRows.length, 0);
    assert.equal(result.issues.length, 4);
    assert.ok(result.issues.every((issue) => issue.kind === "invalid"));
    assert.match(result.issues[0].message, /number of values/i);
    assert.match(result.issues[1].message, /full_name.*required/i);
    assert.match(result.issues[2].message, /course.*required/i);
});

test("CSV validation normalizes Unicode, whitespace, optional blanks, and email casing", () => {
    const result = reviewed(csv("  Jose\u0301 Cruz  , BSIT ,2020, ,ALUM@EXAMPLE.TEST"));
    assert.equal(result.issues.length, 0);
    assert.deepEqual(result.validRows[0].record, {
        full_name: "José Cruz", course: "BSIT", major: null, batch_year: 2020, student_id: null, email: "alum@example.test"
    });
});

test("CSV validation rejects formulas after whitespace trimming in every text field", () => {
    for (const prefix of ["=", "+", "-", "@"]) {
        for (const column of [0, 1, 3, 4]) {
            const cells = ["Ana Cruz", "BSIT", "2020", "ID01", "ana@example.test"];
            cells[column] = `  ${prefix}${cells[column]}`;
            const result = reviewed(csv(cells.join(",")));
            assert.equal(result.validRows.length, 0);
            assert.match(result.issues[0].message, /spreadsheet formula/i);
        }
    }
});

test("CSV validation bounds text fields and rejects embedded control characters", () => {
    assert.equal(reviewed(csv(`${"a".repeat(255)},BSIT,2020,,`)).validRows.length, 1);
    for (const column of [0, 1, 3, 4]) {
        const cells = ["Ana Cruz", "BSIT", "2020", "ID01", "ana@example.test"];
        cells[column] = "a".repeat(256);
        const result = reviewed(csv(cells.join(",")));
        assert.equal(result.validRows.length, 0);
        assert.match(result.issues[0].message, /255/i);
    }
    for (const value of ["Ana\tCruz", "Ana\u0001Cruz", "Ana\u007fCruz"]) {
        const result = reviewed(csv(`${value},BSIT,2020,,`));
        assert.match(result.issues[0].message, /control characters/i);
    }
});

test("CSV validation accepts only full four-digit years within the supported range and valid emails", () => {
    const latest = new Date().getFullYear() + 1;
    for (const year of ["1899", String(latest + 1), "2020x", "2e3", "2020.0", "020", "", "-2020"]) {
        const result = reviewed(csv(`Ana Cruz,BSIT,${year},,`));
        assert.equal(result.validRows.length, 0);
        assert.match(result.issues[0].message, /batch_year/i);
    }
    assert.equal(reviewed(csv("Ana Cruz,BSIT,1900,,")).validRows.length, 1);
    assert.equal(reviewed(csv(`Ana Cruz,BSIT,${latest},,`)).validRows.length, 1);
    for (const email of ["missing-at", "ana@localhost", "ana @example.test"]) {
        assert.match(reviewed(csv(`Ana Cruz,BSIT,2020,,${email}`)).issues[0].message, /email.*invalid/i);
    }
});

test("Duplicate classification skips existing identifiers and name/program/batch combinations", () => {
    const existing = [{ full_name: "Ana Cruz", course: "BSIT", batch_year: 2020, student_id: "ID01", email: "ana@example.test" }];
    const rows = reviewed(csv(
        "Other Name,BEED,2021,id01,",
        "Another Name,BEED,2021,,ANA@EXAMPLE.TEST",
        "ANA CRUZ, bsit ,2020,,",
        "Ana Cruz,BSIT,2021,,"
    )).validRows;
    const result = classifyDuplicates(rows, existing);
    assert.equal(result.issues.length, 3);
    assert.ok(result.issues.every((issue) => issue.kind === "duplicate"));
    assert.equal(result.accepted.length, 1);
    assert.equal(result.accepted[0].record.batch_year, 2021);
});

test("Duplicate classification skips repeated identities inside the CSV and permits blank optional IDs", () => {
    const rows = reviewed(csv(
        "Ana Cruz,BSIT,2020,ID01,ana@example.test",
        "Ana  Cruz,bsit,2020,,",
        "Other Name,BEED,2021,id01,",
        "Another Name,BEED,2021,,ANA@EXAMPLE.TEST",
        "New Alum,BSIT,2020,,"
    )).validRows;
    const result = classifyDuplicates(rows, []);
    assert.equal(result.accepted.length, 2);
    assert.equal(result.issues.length, 3);
    assert.deepEqual(result.issues.map((issue) => issue.row), [3, 4, 5]);
});

test("CSV preview reads records without opening a transaction or writing records/audits", async () => {
    await withDatabase({}, async (state) => {
        const res = createRes();
        await importController.importCsv(request("preview", csv("Ana Cruz,BSIT,2020,ID01,ana@example.test")), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.mode, "preview");
        assert.equal(res.body.valid, 1);
        assert.equal(res.body.errors, 0);
        assert.equal(state.transactions.length, 0);
        assert.equal(state.writes.length, 0);
        assert.equal(state.audits.length, 0);
        assert.deepEqual(res.body.preview[0], { row: 2, full_name: "Ana Cruz", course: "BSIT", major: null, batch_year: 2020 });
        assert.equal(JSON.stringify(res.body).includes("ana@example.test"), false);
        assert.equal(JSON.stringify(res.body).includes("ID01"), false);
    });
});

test("CSV preview caps the displayed preview and reports invalid and duplicate rows", async () => {
    const existing = [{ full_name: "Existing Alum", course: "BSIT", major: null, batch_year: 2020, student_id: null, email: null }];
    await withDatabase({ existing }, async (state) => {
        const rows = Array.from({ length: 25 }, (_, index) => `Alum ${index},BSIT,2020,,`);
        const res = createRes();
        await importController.importCsv(request("preview", csv(...rows, "Existing Alum,BSIT,2020,,", ",BSIT,2020,,")), res);
        assert.equal(res.body.total, 27);
        assert.equal(res.body.valid, 25);
        assert.equal(res.body.preview.length, 20);
        assert.equal(res.body.duplicates, 1);
        assert.equal(res.body.errors, 1);
        assert.deepEqual(res.body.issues.map((issue) => issue.row), [27, 28]);
        assert.equal(state.writes.length, 0);
    });
});

test("CSV import blocks the complete file when any row is invalid", async () => {
    await withDatabase({}, async (state) => {
        const res = createRes();
        await importController.importCsv(request("import", csv("Valid Alum,BSIT,2020,,", "Invalid Alum,BSIT,2020x,,")), res);
        assert.equal(res.statusCode, 422);
        assert.equal(res.body.errors, 1);
        assert.equal(state.records.length, 0);
        assert.equal(state.writes.length, 0);
        assert.equal(state.audits.length, 0);
        assert.equal(state.transactions[0].status, "rolledBack");
    });
});

test("CSV import skips duplicate rows and commits inserted records with one audit before reporting success", async () => {
    const existing = [{ full_name: "Existing Alum", course: "BSIT", major: null, batch_year: 2020, student_id: null, email: null }];
    await withDatabase({ existing }, async (state) => {
        const res = createRes();
        const originalJson = res.json;
        res.json = function (body) {
            assert.equal(state.transactions[0].status, "committed");
            return originalJson.call(this, body);
        };
        await importController.importCsv(request("import", csv("Existing Alum,BSIT,2020,,", "New Alum,BSIT,2021,ID02,new@example.test", "New Alum,BSIT,2021,,")), res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.inserted, 1);
        assert.equal(res.body.duplicates, 2);
        assert.equal(state.records.length, 2);
        assert.equal(state.locks.length, 1);
        assert.equal(state.audits.length, 1);
        const { audit, query } = state.audits[0];
        assert.equal(query.transaction, state.transactions[0]);
        assert.equal(audit.actor_id, 7);
        assert.equal(audit.action, "alumni.records.csv_imported");
        assert.deepEqual(audit.metadata, { total: 3, inserted: 1, duplicates: 2 });
        assert.equal(JSON.stringify(audit.metadata).includes("new@example.test"), false);
    });
});

test("CSV import transactionally imports synthetic batches of 10 and 100 valid rows", async () => {
    for (const count of [10, 100]) {
        await withDatabase({}, async (state) => {
            const rows = Array.from({ length: count }, (_, index) =>
                `Synthetic Alum ${index + 1},BSIT,${2000 + (index % 25)},ID-${count}-${index + 1},alum-${count}-${index + 1}@example.test`);
            const res = createRes();
            await importController.importCsv(request("import", csv(...rows)), res);
            assert.equal(res.statusCode, 201);
            assert.equal(res.body.total, count);
            assert.equal(res.body.inserted, count);
            assert.equal(res.body.errors, 0);
            assert.equal(state.records.length, count);
            assert.equal(state.writes.length, count);
            assert.equal(state.transactions[0].status, "committed");
            assert.equal(state.audits.length, 1);
            assert.equal(state.records[0].full_name, "Synthetic Alum 1");
            assert.equal(state.records.at(-1).full_name, `Synthetic Alum ${count}`);
            assert.ok(state.records.every((record) => typeof record.batch_year === "number"));
        });
    }
});

test("CSV import checks database collation equivalence and skips accent-equivalent existing names", async () => {
    const existing = [{ full_name: "José Cruz", course: "BSIT", major: null, batch_year: 2020, student_id: null, email: null }];
    await withDatabase({ existing }, async (state) => {
        const res = createRes();
        await importController.importCsv(request("import", csv("Jose Cruz,BSIT,2020,,")), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.inserted, 0);
        assert.equal(res.body.duplicates, 1);
        assert.equal(state.records.length, 1);
        assert.equal(state.writes.length, 0);
        assert.equal(state.audits.length, 0);
    });
});

test("Concurrent imports serialize before checking duplicates and insert one identity", async () => {
    await withDatabase({}, async (state) => {
        const first = createRes(), second = createRes();
        const buffer = csv("One Alum,BSIT,2020,,");
        await Promise.all([
            importController.importCsv(request("import", buffer), first),
            importController.importCsv(request("import", buffer), second)
        ]);
        assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 201]);
        assert.equal(first.body.inserted + second.body.inserted, 1);
        assert.equal(first.body.duplicates + second.body.duplicates, 1);
        assert.equal(state.records.length, 1);
        assert.equal(state.transactions.length, 2);
        assert.ok(state.transactions.every((transaction) => transaction.status === "committed"));
    });
});

test("Manual creation and CSV imports share the same lock and cannot race to insert duplicate identities", async () => {
    for (const importFirst of [false, true]) {
        await withDatabase({}, async (state) => {
            const manual = createRes(), imported = createRes();
            const createManual = () => alumniRecordController.createAlumniRecord({
                body: { full_name: "One Alum", course: "BSIT", batch_year: 2020 },
                user: { id: 7, role: "admin", admin_scope: "registrar" }
            }, manual);
            const createImport = () => importController.importCsv(request("import", csv("One Alum,BSIT,2020,,")), imported);
            await Promise.all(importFirst ? [createImport(), createManual()] : [createManual(), createImport()]);
            assert.ok([201, 409].includes(manual.statusCode));
            assert.ok([200, 201].includes(imported.statusCode));
            assert.equal(Number(manual.statusCode === 201) + imported.body.inserted, 1);
            assert.equal(state.records.length, 1);
            assert.equal(state.locks.length, 2);
            assert.ok(state.transactions.every((transaction) => transaction.finished));
        });
    }
});

test("Manual creation commits before success and rolls back a duplicate without inserting", async () => {
    await withDatabase({}, async (state) => {
        const res = createRes();
        const originalJson = res.json;
        res.json = function (body) {
            assert.equal(state.transactions[0].status, "committed");
            return originalJson.call(this, body);
        };
        await alumniRecordController.createAlumniRecord({ body: { full_name: "Ana Cruz", course: "BSIT", batch_year: 2020 } }, res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.full_name, "Ana Cruz");
        assert.equal(state.records.length, 1);
        assert.equal(state.locks.length, 1);
    });
    const existing = [{ full_name: "Ana Cruz", course: "BSIT", major: null, batch_year: 2020, student_id: null, email: null }];
    await withDatabase({ existing }, async (state) => {
        const res = createRes();
        await alumniRecordController.createAlumniRecord({ body: { full_name: "ANA CRUZ", course: "bsit", batch_year: "2020" } }, res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.success, false);
        assert.equal(state.records.length, 1);
        assert.equal(state.writes.length, 0);
        assert.equal(state.transactions[0].status, "rolledBack");
    });
});

test("CSV import reports a concurrent unique-index conflict without committing records", async () => {
    await withDatabase({ failInsertAt: 1, failInsertName: "SequelizeUniqueConstraintError" }, async (state) => {
        const res = createRes();
        await importController.importCsv(request("import", csv("Ana Cruz,BSIT,2020,ID01,")), res);
        assert.equal(res.statusCode, 409);
        assert.equal(state.records.length, 0);
        assert.equal(state.transactions[0].status, "rolledBack");
        assert.match(res.body.msg, /no rows were saved/i);
        assert.equal(JSON.stringify(res.body).includes("private"), false);
    });
});

test("CSV import rolls back every inserted row when a later insert, audit, or commit fails", async () => {
    for (const options of [{ failInsertAt: 2 }, { failAudit: true }, { failCommit: true }]) {
        await withDatabase(options, async (state) => {
            const res = createRes();
            await importController.importCsv(request("import", csv("First Alum,BSIT,2020,,", "Second Alum,BSIT,2021,,")), res);
            assert.equal(res.statusCode, 500);
            assert.equal(state.records.length, 0);
            assert.equal(state.transactions[0].status, "rolledBack");
            assert.match(res.body.msg, /no rows were imported/i);
            assert.equal(JSON.stringify(res.body).includes("private"), false);
        });
    }
});

test("CSV imports require a canonical registrar lock and reject missing file or mode before database calls", async () => {
    await withDatabase({ missingRegistrar: true }, async (state) => {
        const res = createRes();
        await importController.importCsv(request("import", csv("Ana Cruz,BSIT,2020,,")), res);
        assert.equal(res.statusCode, 403);
        assert.equal(state.reads.length, 0);
        assert.equal(state.writes.length, 0);
        assert.equal(state.transactions[0].status, "rolledBack");
    });
    await withDatabase({}, async (state) => {
        for (const req of [request("unknown", csv("Ana Cruz,BSIT,2020,,")), { body: { mode: "preview" } }]) {
            const res = createRes();
            await importController.importCsv(req, res);
            assert.equal(res.statusCode, 400);
        }
        assert.equal(state.reads.length, 0);
        assert.equal(state.transactions.length, 0);
    });
});

test("Registrar lock targets a deterministic account rather than the request actor", async () => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    let query;
    await withOverrides([[db.User, { findOne: async (value) => { query = value; return { id: 1 }; } }]], async () => {
        await lockRecordWrites(transaction);
    });
    assert.deepEqual(query.where, { role: "admin", admin_scope: "registrar" });
    assert.deepEqual(query.order, [["id", "ASC"]]);
    assert.equal(query.transaction, transaction);
    assert.equal(query.lock, "UPDATE");
});

const makeMultipart = ({ buffer = csv("Ana Cruz,BSIT,2020,,"), filename = "alumni.csv", mime = "text/csv", mode = "preview", fieldName = "file", extras = [] } = {}) => {
    const boundary = "----alumni-csv-test-boundary";
    const chunks = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\n${mode}\r\n`)];
    for (const [name, value] of extras) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
    chunks.push(buffer, Buffer.from(`\r\n--${boundary}--\r\n`));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
};

const sendHttp = (port, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/alumni-records/import-csv", method: "POST", headers: { "Content-Length": body.length, ...headers } }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
            catch (error) { reject(error); }
        });
    });
    req.setTimeout(10000, () => req.destroy(new Error("Loopback route test timed out.")));
    req.on("error", reject);
    req.end(body);
});

test("CSV import route enforces auth and registrar scope before reading multipart uploads", async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "csv-route-test-secret";
    const app = express();
    app.use("/api/alumni-records", require("../routes/alumniRecordRoutes"));
    const server = http.createServer(app);
    try {
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        const port = server.address().port;
        await withDatabase({}, async (state) => {
            // A malformed multipart boundary would trigger an upload error if
            // multer ran before authentication/authorization.
            const body = Buffer.from("malformed multipart data");
            const contentType = "multipart/form-data; boundary=missing";
            assert.equal((await sendHttp(port, body, { "Content-Type": contentType })).status, 401);
            const cases = [
                { id: 8, role: "admin", admin_scope: "employer" },
                { id: 9, role: "admin", admin_scope: "alumni" },
                { id: 10, role: "alumni", admin_scope: "registrar" }
            ];
            for (const claims of cases) {
                const token = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "1m" });
                assert.equal((await sendHttp(port, body, { "Content-Type": contentType, Authorization: `Bearer ${token}` })).status, 403);
            }
            assert.equal(state.reads.length, 0);
            assert.equal(state.transactions.length, 0);
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    }
});

test("CSV import route accepts one CSV in memory and rejects unsafe upload shapes without writes", async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "csv-route-test-secret";
    const app = express();
    app.use("/api/alumni-records", require("../routes/alumniRecordRoutes"));
    const server = http.createServer(app);
    try {
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        const port = server.address().port;
        const token = jwt.sign({ id: 7, role: "admin", admin_scope: "registrar" }, process.env.JWT_SECRET, { expiresIn: "1m" });
        const post = (upload) => sendHttp(port, upload.body, { "Content-Type": upload.contentType, Authorization: `Bearer ${token}` });
        await withDatabase({}, async (state) => {
            const accepted = await post(makeMultipart());
            assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
            assert.equal(accepted.body.valid, 1);
            assert.equal(accepted.body.mode, "preview");
            for (const options of [
                { filename: "alumni.xlsx" },
                { filename: "alumni.csv", mime: "application/pdf" },
                { fieldName: "unexpected" },
                { extras: [["extra", "value"]] },
                { mode: "unknown" }
            ]) assert.equal((await post(makeMultipart(options))).status, 400);
            assert.equal((await post(makeMultipart({ buffer: Buffer.alloc(MAX_CSV_BYTES + 1, 65) }))).status, 413);
            assert.equal(state.writes.length, 0);
            assert.equal(state.transactions.length, 0);
            assert.equal(state.audits.length, 0);
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    }
});
