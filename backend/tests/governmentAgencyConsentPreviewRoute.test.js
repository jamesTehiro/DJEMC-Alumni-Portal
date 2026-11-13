"use strict";

process.env.OBJECT_STORAGE_PROVIDER = "local";
process.env.JWT_SECRET = "government-agency-preview-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const db = require("../models");
const rateLimitStore = require("../utils/rateLimitStore");

rateLimitStore.consumeRateLimit = async () => ({ allowed: true, resetAt: Date.now() + 60_000 });

const app = express();
app.use("/api/auth", require("../routes/authRoutes"));
app.use("/api", require("../middleware/apiNotFound"));
app.use(require("../middleware/errorHandler"));
const registrationOtp = require("../controllers/registrationOtpController");
registrationOtp.employerOtp.status = async () => ({ verified: false, email_status: "pending" });

let server;
let base;

const details = {
    agency_name: "Test Agency",
    agency_classification: "Regional office",
    department_ministry: "Administration",
    regional_office: "North",
    office_address: "1 Test Road",
    agency_email: "agency@example.gov",
    agency_contact_number: "555-0100",
    agency_website: "",
    representative_name: "Test Representative",
    representative_designation: "Other",
    representative_department: "Administration",
    representative_email: "representative@example.gov",
    representative_contact_number: "555-0101",
    signature_printed_name: "Test Representative",
    signature_designation: "Deputy Director",
    date_signed: "2026-11-13",
    signature_declaration_accepted: true
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const endpoint = "/api/auth/employer-government-agency/consent-preview";

function formRequest({ submittedDetails = details, signature = png, mimeType = "image/png", includeSignature = true } = {}) {
    const form = new FormData();
    form.append("details", JSON.stringify(submittedDetails));
    if (includeSignature) form.append("government_signature", new Blob([signature], { type: mimeType }), "signature.png");
    return fetch(`${base}${endpoint}`, { method: "POST", body: form });
}

test.before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    await db.sequelize.close();
});

test("mounted /api/auth consent preview accepts the frontend multipart payload and returns a PDF token", async () => {
    const response = await formRequest();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private/);
    const result = await response.json();
    assert.equal(Buffer.from(result.pdf_base64, "base64").subarray(0, 5).toString(), "%PDF-");
    assert.equal(typeof result.preview_token, "string");
    assert.ok(result.preview_token.length > 20);
});

test("consent preview rejects missing required fields and absent signatures", async () => {
    const missingField = await formRequest({ submittedDetails: { ...details, agency_name: "" } });
    assert.equal(missingField.status, 400);
    assert.match((await missingField.json()).msg, /agency name/i);

    const missingSignature = await formRequest({ includeSignature: false });
    assert.equal(missingSignature.status, 400);
    assert.match((await missingSignature.json()).msg, /signature image is required/i);
});

test("consent preview rejects invalid signature image contents and preserves other auth routes", async () => {
    const invalidImage = await formRequest({ signature: Buffer.from("not a PNG"), mimeType: "image/png" });
    assert.equal(invalidImage.status, 415);

    const wrongMethod = await fetch(`${base}${endpoint}`);
    assert.equal(wrongMethod.status, 404);
    assert.equal((await wrongMethod.json()).code, "API_ROUTE_NOT_FOUND");

    const otpStatus = await fetch(`${base}/api/auth/employer-registration-otp/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: "test-session" })
    });
    assert.equal(otpStatus.status, 200);
});
