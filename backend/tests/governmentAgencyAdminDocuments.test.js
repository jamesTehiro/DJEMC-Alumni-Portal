"use strict";

process.env.JWT_SECRET = "government-agency-admin-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../models");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const scope = require("../middleware/adminScopeMiddleware");
const admin = require("../controllers/adminController");
const governmentDocuments = require("../controllers/governmentAgencyAdminController");

const saved = [];
const override = (object, key, value) => {
    saved.push([object, key, object[key]]);
    object[key] = value;
};
let server;
let fixturePath;

test("employer admins retrieve only their private government documents and list responses omit storage references", async () => {
    const bytes = Buffer.from("%PDF-1.7 private government authorization fixture");
    const filename = `admin-document-fixture-${process.pid}.pdf`;
    fixturePath = path.join(__dirname, "..", "private_uploads", "government_agencies", filename);
    await fs.mkdir(path.dirname(fixturePath), { recursive: true });
    await fs.writeFile(fixturePath, bytes, { mode: 0o600 });
    const profile = {
        organization_type: "government_agency",
        government_agency_details: JSON.stringify({
            agency_name: "Test Agency",
            agency_classification: "Regional office",
            department_ministry: "Administration",
            regional_office: "North",
            office_address: "1 Test Road",
            agency_email: "agency@example.gov",
            agency_contact_number: "555-0100",
            representative_name: "Test Representative",
            representative_designation: "Regional Director",
            representative_department: "Administration",
            representative_email: "representative@example.gov",
            representative_contact_number: "555-0101",
            signature_printed_name: "Test Representative",
            signature_designation: "Regional Director",
            date_signed: "2026-11-13"
        }),
        government_agency_documents: JSON.stringify({
            signature: { storage_ref: "/private_uploads/government_agencies/signature.png", name: "signature.png", mime_type: "image/png", size: 20 },
            seal: null,
            authorization_pdf: { storage_ref: `/private_uploads/government_agencies/${filename}`, name: "original.pdf", mime_type: "application/pdf", size: bytes.length }
        }),
        business_permit_path: null,
        business_permit_documents: null
    };
    const employer = { id: 82, role: "employer" };
    const userRow = { id: 82, name: "Test Agency", email: "agency@gmail.com", role: "employer", account_status: "pending", createdAt: new Date().toISOString(),
        toJSON: () => ({ id: 82, name: "Test Agency", email: "agency@gmail.com", role: "employer", account_status: "pending", EmployerProfile: { ...profile } }) };
    override(db.User, "findByPk", async id => Number(id) === 1
        ? { id: 1, role: "admin", admin_scope: "employer", account_status: "verified" }
        : Number(id) === 2 ? { id: 2, role: "admin", admin_scope: "alumni", account_status: "verified" }
        : null);
    override(db.User, "findOne", async options => Number(options.where.id) === 82 && options.where.role === "employer" ? employer : null);
    override(db.User, "findAll", async () => [userRow]);
    override(db.EmployerProfile, "findOne", async () => profile);
    override(db.AuditLog, "findAll", async () => []);

    const app = express();
    app.get("/documents/:userId/:documentType", auth, role("admin"), scope("employer"), governmentDocuments.getDocument);
    app.get("/users", auth, role("admin"), scope("employer"), admin.getEmployerUsers);
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ msg: error.message }));
    server = await new Promise(resolve => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = claims => jwt.sign(claims, process.env.JWT_SECRET);
    const employerAdmin = { Authorization: `Bearer ${token({ id: 1, role: "admin", admin_scope: "employer" })}` };
    const alumniAdmin = { Authorization: `Bearer ${token({ id: 2, role: "admin", admin_scope: "alumni" })}` };

    try {
        const deniedAnonymous = await fetch(`${base}/documents/82/authorization_pdf`);
        assert.equal(deniedAnonymous.status, 401);
        const deniedScope = await fetch(`${base}/documents/82/authorization_pdf`, { headers: alumniAdmin });
        assert.equal(deniedScope.status, 403);
        const response = await fetch(`${base}/documents/82/authorization_pdf`, { headers: employerAdmin });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("content-type"), "application/pdf");
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        const download = await fetch(`${base}/documents/82/authorization_pdf?download=1`, { headers: employerAdmin });
        assert.equal(download.status, 200);
        assert.match(download.headers.get("content-disposition"), /^attachment;/);
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

        const listed = await fetch(`${base}/users`, { headers: employerAdmin });
        assert.equal(listed.status, 200);
        const user = (await listed.json())[0];
        assert.equal(user.EmployerProfile.organization_type, "government_agency");
        assert.equal(user.EmployerProfile.government_agency_details.agency_name, "Test Agency");
        assert.equal(user.EmployerProfile.government_agency_details.representative_designation, "Regional Director");
        assert.match(user.EmployerProfile.government_agency_document_urls.signature, /government-agency-documents\/signature$/);
        assert.equal(user.EmployerProfile.government_agency_document_urls.seal, null);
        assert.match(user.EmployerProfile.government_agency_document_urls.authorization_pdf, /government-agency-documents\/authorization_pdf$/);
        assert.doesNotMatch(JSON.stringify(user), /private_uploads\/government_agencies|storage_ref|cld:/);
    } finally {
        await new Promise(resolve => server.close(resolve));
        server = null;
        await fs.unlink(fixturePath).catch(() => {});
    }
});

test.after(async () => {
    for (const [object, key, value] of saved.reverse()) object[key] = value;
    await db.sequelize.close();
});
