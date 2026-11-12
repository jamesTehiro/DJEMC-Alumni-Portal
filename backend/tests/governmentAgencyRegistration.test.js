"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

process.env.OBJECT_STORAGE_PROVIDER = "local";
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;
process.env.JWT_SECRET = "government-agency-test-secret";

const registration = require("../services/governmentAgencyRegistration");
const migration = require("../migrations/20261020-add-government-agency-employer-registration");

const details = () => registration.parseDetails({
    agency_name: "Test Agency",
    agency_classification: "Regional office",
    department_ministry: "",
    regional_office: "",
    office_address: "1 Test Road",
    agency_email: "agency@example.gov",
    agency_contact_number: "555-0100",
    agency_website: "",
    representative_name: "Representative",
    representative_designation: "Authorized Representative",
    representative_department: "Administration",
    representative_email: "person@example.gov",
    representative_contact_number: "555-0101",
    signature_printed_name: "Representative",
    signature_designation: "Authorized Representative",
    date_signed: "2026-10-20",
    signature_declaration_accepted: true
});

test("validates required government agency and representative information", () => {
    assert.equal(registration.ORGANIZATION_TYPES.has("government_agency"), true);
    assert.equal(registration.ORGANIZATION_TYPES.has("private_business"), true);
    assert.equal(details().representative_designation, "Authorized Representative");
    assert.throws(() => registration.parseDetails({}), /required government agency field/);
    assert.throws(() => registration.parseDetails({
        ...details(),
        signature_declaration_accepted: false
    }), /declaration and consent/);
});

test("accepts valid PNG/JPG signatures, rejects invalid bytes and signs the exact PDF preview", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    assert.equal(registration.isImage(png, "image/png"), true);
    assert.equal(registration.isImage(jpeg, "image/jpeg"), true);
    assert.equal(registration.isImage(Buffer.from("not an image"), "image/png"), false);
    const submission = {
        details: details(),
        signature: { buffer: png, mimetype: "image/png" },
        seal: null,
        pdf: Buffer.from("%PDF-1.7\ntest authorization")
    };
    const token = registration.createPreviewToken(submission);
    assert.equal(await registration.verifyPreviewToken({ ...submission, token }), true);
    assert.equal(await registration.verifyPreviewToken({ ...submission, token, pdf: Buffer.from("%PDF-1.7\nchanged") }), false);
    assert.equal(await registration.verifyPreviewToken({
        ...submission,
        token,
        details: { ...submission.details, agency_name: "Different Agency" }
    }), false);
    assert.equal(await registration.verifyPreviewToken({
        ...submission,
        token,
        signature: { buffer: Buffer.from([...png, 1]), mimetype: "image/png" }
    }), false);
});

test("stores local consent PDFs only outside production and removes the exact uncommitted file", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRender = process.env.RENDER;
    process.env.NODE_ENV = "development";
    delete process.env.RENDER;
    const stored = await registration.storeConsentPdf(Buffer.from("%PDF-1.7 test"));
    const diskPath = path.join(__dirname, "..", stored.storage_ref.replace(/^\//, "").replace(/\//g, path.sep));
    try {
        assert.match(stored.storage_ref, /^\/private_uploads\/government_agencies\/registration-authorization-[0-9a-f-]+\.pdf$/i);
        assert.equal((await fs.readFile(diskPath)).subarray(0, 5).toString(), "%PDF-");
        process.env.NODE_ENV = "production";
        await assert.rejects(registration.storeConsentPdf(Buffer.from("%PDF-1.7 test")), /storage is not configured/);
    } finally {
        process.env.NODE_ENV = previousNodeEnv;
        if (previousRender === undefined) delete process.env.RENDER;
        else process.env.RENDER = previousRender;
        await registration.deleteLocalConsentPdf(stored);
        await assert.rejects(fs.access(diskPath));
    }
});

test("migration adds nullable organization metadata idempotently and refuses destructive rollback", async () => {
    const columns = {};
    const added = [];
    const queryInterface = {
        describeTable: async () => ({ ...columns }),
        addColumn: async (_table, name, definition) => {
            columns[name] = definition;
            added.push(name);
        }
    };
    const Sequelize = { STRING: length => `STRING(${length})`, TEXT: "TEXT" };
    await migration.up(queryInterface, Sequelize);
    await migration.up(queryInterface, Sequelize);
    assert.deepEqual(added, ["organization_type", "government_agency_details", "government_agency_documents"]);
    assert.ok(Object.values(columns).every(column => column.allowNull));
    await assert.rejects(migration.down(), /Refusing to remove government agency registration details/);
});
