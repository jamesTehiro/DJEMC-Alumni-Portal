"use strict";

process.env.OBJECT_STORAGE_PROVIDER = "local";
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;
process.env.JWT_SECRET = "government-agency-workflow-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const db = require("../models");
const authController = require("../controllers/authController");
const otpController = require("../controllers/registrationOtpController");
const { registrationUpload, governmentAgencyPreviewUpload } = require("../middleware/uploadMiddleware");
const governmentAgencyController = require("../controllers/governmentAgencyController");

const originals = [];
const override = (object, key, value) => {
    originals.push([object, key, object[key]]);
    object[key] = value;
};
let server;
let profile;
let createdUser;
let previewPdf;

const registrationDetails = {
    agency_name: "Test Agency",
    agency_classification: "Regional office",
    department_ministry: "Administration",
    regional_office: "North",
    office_address: "1 Test Road",
    agency_email: "agency@example.gov",
    agency_contact_number: "555-0100",
    agency_website: "",
    representative_name: "Representative",
    representative_designation: "Other",
    representative_department: "Administration",
    representative_email: "person@example.gov",
    representative_contact_number: "555-0101",
    signature_printed_name: "Representative",
    signature_designation: "Deputy Director",
    date_signed: "2026-10-20",
    signature_declaration_accepted: true
};
const signaturePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");

test("government registration stores the exact verified preview with pending account metadata", async () => {
    let nextUserId = 100;
    const accounts = [];
    const verification = { verified_at: new Date("2026-10-20T00:00:00.000Z"), update: async () => {} };
    override(otpController.otp, "findAccount", async () => null);
    override(otpController.employerOtp, "consume", async () => verification);
    override(db.User, "create", async values => {
        createdUser = { id: nextUserId++, ...values };
        accounts.push(createdUser);
        return createdUser;
    });
    override(db.EmployerProfile, "findOrCreate", async () => {
        profile = {
            user_id: createdUser.id,
            update: async function(values) { Object.assign(this, values); },
            reload: async function() { return this; }
        };
        return [profile, true];
    });
    override(db.sequelize, "transaction", async callback => callback({}));

    const app = express();
    app.post("/preview", governmentAgencyPreviewUpload, governmentAgencyController.previewConsent);
    app.post("/register", registrationUpload, authController.register);
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ msg: error.publicMessage || error.message }));
    server = await new Promise(resolve => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    let storedPdfRef;
    let storedSignatureRef;

    try {
        const previewForm = new FormData();
        previewForm.append("details", JSON.stringify(registrationDetails));
        previewForm.append("government_signature", new Blob([signaturePng], { type: "image/png" }), "signature.png");
        const previewResponse = await fetch(`${base}/preview`, { method: "POST", body: previewForm });
        assert.equal(previewResponse.status, 200);
        const preview = await previewResponse.json();
        previewPdf = Buffer.from(preview.pdf_base64, "base64");
        assert.equal(previewPdf.subarray(0, 5).toString(), "%PDF-");
        assert.ok(preview.preview_token);

        const submit = async token => {
            const form = new FormData();
            form.append("name", registrationDetails.agency_name);
            form.append("email", "agency.registration@gmail.com");
            form.append("password", "fixture-password");
            form.append("role", "employer");
            form.append("organization_type", "government_agency");
            form.append("session_token", "fixture-employer-session");
            form.append("registration_authorization", "fixture-authorization");
            form.append("company_address", registrationDetails.office_address);
            form.append("website_url", registrationDetails.agency_website);
            form.append("government_agency_details", JSON.stringify(registrationDetails));
            form.append("government_signature", new Blob([signaturePng], { type: "image/png" }), "signature.png");
            form.append("government_authorization_pdf", new Blob([previewPdf], { type: "application/pdf" }), "authorization.pdf");
            form.append("government_authorization_preview_token", token);
            return fetch(`${base}/register`, { method: "POST", body: form });
        };

        const rejected = await submit(`${preview.preview_token}invalid`);
        assert.equal(rejected.status, 400);
        assert.equal(accounts.length, 0, "invalid preview must not create an account");

        const response = await submit(preview.preview_token);
        assert.equal(response.status, 201, await response.text());
        assert.equal(accounts.length, 1);
        assert.equal(accounts[0].account_status, "pending");
        assert.equal(profile.organization_type, "government_agency");
        assert.equal(profile.organization_name, registrationDetails.agency_name);
        const documents = JSON.parse(profile.government_agency_documents);
        storedPdfRef = documents.authorization_pdf.storage_ref;
        storedSignatureRef = documents.signature.storage_ref;
        assert.equal(documents.authorization_pdf.mime_type, "application/pdf");
        assert.equal(documents.signature.mime_type, "image/png");
        assert.deepEqual(await fs.readFile(path.join(__dirname, "..", storedPdfRef.replace(/^\//, "").replace(/\//g, path.sep))), previewPdf);
        assert.match(storedSignatureRef, /^\/private_uploads\/government_agencies\//);
    } finally {
        await new Promise(resolve => server.close(resolve));
        server = null;
        if (storedPdfRef) {
            await fs.unlink(path.join(__dirname, "..", storedPdfRef.replace(/^\//, "").replace(/\//g, path.sep))).catch(() => {});
        }
        if (storedSignatureRef) {
            await fs.unlink(path.join(__dirname, "..", storedSignatureRef.replace(/^\//, "").replace(/\//g, path.sep))).catch(() => {});
        }
    }
});

test.after(async () => {
    for (const [object, key, value] of originals.reverse()) object[key] = value;
    await db.sequelize.close();
});
