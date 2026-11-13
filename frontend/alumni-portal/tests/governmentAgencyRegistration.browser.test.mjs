import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import puppeteer from "puppeteer";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.resolve(root, "../../tmp");
const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
let vite;
let browser;
let base;
let profileDir;
let imageFile;
let replacementFile;
let invalidFile;

test.before(async () => {
    await fs.mkdir(artifacts, { recursive: true });
    imageFile = path.join(artifacts, `government-signature-${process.pid}.png`);
    replacementFile = path.join(artifacts, `government-signature-replacement-${process.pid}.png`);
    invalidFile = path.join(artifacts, `government-signature-invalid-${process.pid}.txt`);
    await fs.writeFile(imageFile, validPng);
    await fs.writeFile(replacementFile, validPng);
    await fs.writeFile(invalidFile, "not an image");
    vite = await preview({ root, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
    base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    let executablePath;
    for (const candidate of [
        puppeteer.executablePath(),
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
    ]) {
        try { await fs.access(candidate); executablePath = candidate; break; } catch { /* Try the next installed Chromium binary. */ }
    }
    profileDir = await fs.mkdtemp(path.join(artifacts, "government-registration-profile-"));
    browser = await puppeteer.launch({
        headless: true,
        pipe: true,
        userDataDir: profileDir,
        timeout: 30000,
        protocolTimeout: 30000,
        ...(executablePath ? { executablePath } : {})
    });
});

test.after(async () => {
    await browser?.close();
    if (vite) {
        vite.httpServer.closeAllConnections?.();
        await new Promise(resolve => vite.httpServer.close(resolve));
    }
    await Promise.all([imageFile, replacementFile, invalidFile].filter(Boolean).map(file => fs.unlink(file).catch(() => {})));
    if (profileDir) await fs.rm(profileDir, { recursive: true, force: true });
});

test("government registration validates, previews, retains, and submits its authorization form and PDF", { timeout: 240000 }, async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(90000);
    await page.setViewport({ width: 1280, height: 1000 });
    const sessions = new Map();
    const registrationPayloads = [];
    const previewRequests = [];
    const adminDocumentRequests = [];
    const failures = [];

    await page.evaluateOnNewDocument(() => {
        const send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(body) {
            if (body instanceof FormData) {
                window.governmentRegistrationMultipart ||= [];
                window.governmentRegistrationMultipart.push(Object.fromEntries(
                    [...body.entries()].map(([key, value]) => [key, value instanceof File
                        ? { name: value.name, type: value.type, size: value.size }
                        : value])
                ));
            }
            return send.call(this, body);
        };
    });
    await page.setRequestInterception(true);
    page.on("request", request => {
        void (async () => {
            const url = new URL(request.url());
            if (request.method() === "OPTIONS") {
                return request.respond({ status: 204, headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization"
                } });
            }
            const json = (body, status = 200) => request.respond({
                status,
                contentType: "application/json",
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify(body)
            });
            if (url.pathname === "/api/auth/employer-government-agency/consent-preview") {
                previewRequests.push(true);
                return json({ pdf_base64: Buffer.from("%PDF-1.7 browser fixture").toString("base64"), preview_token: "fixture-preview-signature" });
            }
            if (url.pathname === "/api/admin/employer/users") {
                return json([{
                    id: 82,
                    name: "Browser Fixture Agency",
                    email: "agency.fixture@gmail.com",
                    role: "employer",
                    account_status: "pending",
                    createdAt: new Date().toISOString(),
                    EmployerProfile: {
                        organization_type: "government_agency",
                        organization_name: "Browser Fixture Agency",
                        government_agency_details: registrationPayloads.length
                            ? JSON.parse(registrationPayloads.at(-1).government_agency_details)
                            : {},
                        government_agency_documents: {
                            signature: { name: "representative-signature.png", mime_type: "image/png", size: validPng.length },
                            seal: { name: "agency-seal.png", mime_type: "image/png", size: validPng.length },
                            authorization_pdf: { name: "original-authorization.pdf", mime_type: "application/pdf", size: 30 }
                        },
                        government_agency_document_urls: {
                            signature: "/api/admin/employer/users/82/government-agency-documents/signature",
                            seal: "/api/admin/employer/users/82/government-agency-documents/seal",
                            authorization_pdf: "/api/admin/employer/users/82/government-agency-documents/authorization_pdf"
                        }
                    }
                }]);
            }
            if (url.pathname.startsWith("/api/admin/employer/users/82/government-agency-documents/")) {
                adminDocumentRequests.push(url.pathname.endsWith("authorization_pdf") && url.searchParams.get("download") === "1" ? "download" : url.pathname.split("/").at(-1));
                const pdfDocument = url.pathname.endsWith("authorization_pdf");
                return request.respond({
                    status: 200,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Content-Type": pdfDocument ? "application/pdf" : "image/png",
                        "Cache-Control": "private, no-store"
                    },
                    body: pdfDocument ? Buffer.from("%PDF-1.7 original fixture") : validPng
                });
            }
            if (url.pathname.startsWith("/api/auth/employer-registration-otp/")) {
                const operation = url.pathname.split("/").at(-1);
                const body = JSON.parse(request.postData() || "{}");
                let session = sessions.get(body.session_token);
                if (operation === "send" || operation === "resend") {
                    session = { email: body.email, verified: false };
                    sessions.set(body.session_token, session);
                }
                if (!session) return json({ code: "INVALID_SESSION", msg: "Session unavailable." }, 403);
                if (operation === "verify") session.verified = body.otp === "123456";
                return json({
                    email: session.email,
                    status: session.verified ? "verified" : "sent",
                    verified: session.verified,
                    expires_at: new Date(Date.now() + 300000).toISOString(),
                    server_time: new Date().toISOString(),
                    resend_at: new Date(Date.now() + 60000).toISOString(),
                    attempts_remaining: 5,
                    resends_remaining: 3,
                    send_window_resets_at: null,
                    email_status: "sent",
                    ...(session.verified ? {
                        verification_expires_at: new Date(Date.now() + 600000).toISOString(),
                        registration_authorization: "ui-government-fixture-authorization"
                    } : {})
                });
            }
            if (url.pathname === "/api/auth/register") {
                registrationPayloads.push(await page.evaluate(() => window.governmentRegistrationMultipart?.at(-1) || null));
                return json({ msg: "Registration successful", user: { account_status: "pending" } }, 201);
            }
            if (url.origin === base) return request.continue();
            return request.abort();
        })().catch(error => {
            failures.push(error.message);
            if (!request.isInterceptResolutionHandled()) void request.abort();
        });
    });

    try {
        await page.goto(`${base}/register/employer`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('select[name="organizationType"]');
        assert.match(await page.$eval("body", element => element.innerText), /Business Verification Document/);

        await page.select('select[name="organizationType"]', "government_agency");
        assert.doesNotMatch(await page.$eval("body", element => element.innerText), /Business Verification Document/);
        for (const [name, value] of Object.entries({
            email: "agency.fixture@gmail.com",
            password: "Agency-fixture-password-123!",
            confirmPassword: "Agency-fixture-password-123!"
        })) await page.type(`[name="${name}"]`, value);
        await page.click(".highlight-link");
        await page.waitForSelector(".consent-modal");
        await page.$eval(".consent-body", element => {
            element.scrollTop = element.scrollHeight;
            element.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await page.waitForSelector(".consent-footer button.primary-btn:not([disabled])");
        await page.click(".consent-footer button.primary-btn:not([disabled])");
        await page.waitForSelector(".consent-modal", { hidden: true });
        await page.click('input[name="consent"]');
        await page.$$eval("button", buttons => buttons.find(button => button.textContent.includes("Complete Government Agency Form"))?.click());
        await page.waitForSelector(".modal.show .government-agency-modal");

        const values = {
            agency_name: "Browser Fixture Agency",
            agency_classification: "Regional Department",
            department_ministry: "Public Services",
            regional_office: "North Division",
            office_address: "1 Government Road",
            agency_email: "agency@example.gov",
            agency_contact_number: "555-0100",
            representative_name: "Alex Representative",
            representative_department: "Administration",
            representative_email: "alex@example.gov",
            representative_contact_number: "555-0101",
            signature_printed_name: "Alex Representative",
            signature_designation: "Regional Director",
            date_signed: "2026-10-20"
        };
        for (const [name, value] of Object.entries(values)) await page.type(`[name="${name}"]`, value);
        await page.select('[name="representative_designation"]', "Other");
        await page.type('[name="other_designation"]', "Deputy Regional Director");
        await (await page.$("#government-signature-upload")).uploadFile(invalidFile);
        await page.waitForFunction(() => document.body.innerText.includes("Signature and seal images must be PNG or JPG"));
        await (await page.$("#government-signature-upload")).uploadFile(imageFile);
        await page.waitForFunction(() => !!document.querySelector(".government-signature-preview img"));
        await page.$$eval("button", buttons => buttons.find(button => button.textContent.includes("Replace Signature"))?.click());
        await (await page.$("#government-signature-replacement")).uploadFile(replacementFile);
        await (await page.$('input[name="government_seal"]')).uploadFile(imageFile);
        await page.click(".government-declaration-check input");
        await page.click(".government-agency-modal button[type=submit]");
        await page.waitForSelector(".government-pdf-preview iframe");
        await page.waitForFunction(() => document.body.innerText.includes("Download PDF"));
        assert.equal(previewRequests.length, 1);
        const pdfDownload = await page.$eval(".government-pdf-preview + .modal-footer a[download]", link => ({
            href: link.href,
            download: link.download
        }));
        assert.equal(pdfDownload.href.startsWith("blob:"), true);
        assert.equal(pdfDownload.download, "government-agency-registration-authorization.pdf");
        await page.click(".government-pdf-preview + .modal-footer .btn-success");
        await page.waitForFunction(() => !document.querySelector(".government-pdf-preview"));
        assert.match(await page.$eval("body", element => element.innerText), /Authorization form and PDF ready for submission/);

        await page.waitForSelector(".registration-otp-modal");
        assert.equal(registrationPayloads.length, 0, "registration must wait for Gmail verification");
        await page.waitForFunction(() => !document.querySelector('[aria-label="Digit 1 of 6"]')?.disabled);
        await page.type('[aria-label="Digit 1 of 6"]', "123456");
        await page.click(".registration-otp-modal form button[type=submit]");
        await page.waitForFunction(() => document.body.innerText.includes("Gmail verified successfully"));
        await page.click(".registration-otp-modal .modal-footer button");
        await page.waitForFunction(() => document.body.innerText.includes("Registration Submitted Successfully"));

        const submission = registrationPayloads.at(-1);
        assert.equal(submission.organization_type, "government_agency");
        assert.equal(submission.name, values.agency_name);
        assert.equal(submission.company_address, values.office_address);
        assert.equal(submission.government_authorization_preview_token, "fixture-preview-signature");
        assert.equal(JSON.parse(submission.government_agency_details).representative_designation, "Deputy Regional Director");
        assert.equal(submission.government_signature.type, "image/png");
        assert.equal(submission.government_seal.type, "image/png");
        assert.equal(submission.government_authorization_pdf.type, "application/pdf");
        assert.equal(submission.business_permit, undefined);
        assert.deepEqual(failures, []);

        await page.goto(base, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => {
            localStorage.setItem("token", "ui-employer-admin-fixture");
            localStorage.setItem("user", JSON.stringify({ id: 1, role: "admin", admin_scope: "employer" }));
        });
        await page.goto(`${base}/admin/employer/verification`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.body.innerText.includes("Government Agency · agency.fixture@gmail.com"));
        await page.$$eval(".action-menu summary", summaries => summaries[0]?.click());
        await page.$$eval(".action-menu button", buttons => buttons.find(button => button.textContent.trim() === "View")?.click());
        await page.waitForFunction(() => document.body.innerText.includes("Government Agency Registration Details"));
        assert.match(await page.$eval("body", element => element.innerText), /Browser Fixture Agency/);
        assert.match(await page.$eval("body", element => element.innerText), /Deputy Regional Director/);
        await page.waitForFunction(() => document.querySelectorAll(".government-admin-signature-grid img").length === 2);
        await page.$$eval("button", buttons => buttons.find(button => button.textContent.includes("View Original PDF"))?.click());
        await page.waitForSelector(".government-pdf-review iframe");
        assert.ok(adminDocumentRequests.includes("authorization_pdf"));
        assert.equal(await page.$eval(".government-pdf-review iframe", iframe => iframe.src.startsWith("blob:")), true);
        assert.match(await page.$eval("body", element => element.innerText), /Download Original PDF/);
    } finally {
        await page.close();
    }
});
