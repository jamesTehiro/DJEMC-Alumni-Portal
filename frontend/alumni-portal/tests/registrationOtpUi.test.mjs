import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import puppeteer from "puppeteer";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.resolve(root, "../../tmp");
let vite, browser, base, proof;
test.before(async () => {
    await fs.mkdir(artifacts, { recursive: true });
    proof = path.join(artifacts, "registration-ui-fixture-proof.pdf");
    await fs.writeFile(proof, "%PDF-1.7 UI fixture; no personal data");
    // Test the same production assets Firebase will serve. Run npm run build
    // first; preview avoids dev compilation/connection noise in UI assertions.
    vite = await preview({ root, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
    base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    let executablePath;
    for (const candidate of [puppeteer.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"]) {
        try { await fs.access(candidate); executablePath = candidate; break; } catch { /* Try the next installed Chromium binary; never read an existing profile. */ }
    }
    const userDataDir = await fs.mkdtemp(path.join(artifacts, "otp-ui-profile-"));
    browser = await puppeteer.launch({ headless: true, pipe: true, userDataDir, timeout: 30000, protocolTimeout: 30000, ...(executablePath ? { executablePath } : {}) });
});
test.after(async () => {
    await browser?.close();
    if (vite) {
        // A request aborted by the external-network guard can leave an idle
        // keep-alive socket. Close only this fixture server's connections.
        vite.httpServer.closeAllConnections?.();
        await new Promise(resolve => vite.httpServer.close(resolve));
    }
});

async function fixture({ mobile = false, expired = false } = {}) {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(90000);
    await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 } : { width: 1280, height: 1000 });
    const sessions = new Map(), registrations = [], requests = [], failures = [];
    // Chromium omits multipart file bodies from intercepted postData. Observe
    // the real FormData passed to XHR as well as the outbound request metadata.
    await page.evaluateOnNewDocument(() => {
        const send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
            if (body instanceof FormData) window.otpFixtureSubmission = Object.fromEntries(
                [...body.entries()].map(([key, value]) => [key, value instanceof File ? { name: value.name, size: value.size } : value])
            );
            return send.call(this, body);
        };
    });
    const view = row => ({ email: row.email, status: row.verified ? "verified" : "sent", verified: !!row.verified,
        expires_at: row.expiresAt, server_time: new Date().toISOString(),
        resend_at: new Date(Date.now() + 60000).toISOString(), attempts_remaining: row.attempts,
        resends_remaining: 3, send_window_resets_at: null,
        verification_expires_at: row.verified ? new Date(Date.now() + 600000).toISOString() : null,
        ...(row.verified ? { registration_authorization: "ui-fixture-authorization" } : {}) });
    await page.setRequestInterception(true);
    page.on("request", request => { void (async () => {
        const url = new URL(request.url());
        if (request.method() === "OPTIONS") return request.respond({ status: 204, headers: {
            "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization"
        } });
        if (url.pathname.startsWith("/api/auth/registration-otp/")) {
            const data = JSON.parse(request.postData() || "{}"); requests.push({ operation: url.pathname.split("/").at(-1), email: data.email, session: data.session_token });
            let row = sessions.get(data.session_token);
            if (url.pathname.endsWith("/send") || url.pathname.endsWith("/resend")) {
                row ||= { email: data.email, attempts: 5, expiresAt: new Date(Date.now() + (expired ? -1000 : 300000)).toISOString() }; sessions.set(data.session_token, row);
                if (url.pathname.endsWith("/resend")) row.expiresAt = new Date(Date.now() + 300000).toISOString();
            }
            let status = 200, body;
            if (!row) { status = 403; body = { code: "INVALID_SESSION", msg: "Session unavailable." }; }
            else if (url.pathname.endsWith("/verify") && data.otp !== "123456") {
                row.attempts--; status = 400; body = { code: "OTP_INCORRECT", msg: `Incorrect code. ${row.attempts} attempts remaining.` };
            } else { if (url.pathname.endsWith("/verify")) row.verified = true; body = view(row); }
            return request.respond({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
        }
        if (url.pathname === "/api/auth/register") {
            registrations.push({ body: request.postData(), contentType: request.headers()["content-type"] });
            return request.respond({ status: 201, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ msg: "Registration successful", user: { account_status: "pending" } }) });
        }
        // Every external request is blocked, including email APIs and production
        // Render. These UI tests cannot send email or create live accounts.
        if (url.origin === base || url.protocol === "data:") return request.continue();
        return request.abort();
    })().catch(error => { failures.push(error.message); if (!request.isInterceptResolutionHandled()) void request.abort(); }); });
    await page.goto(`${base}/register`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[name="name"]');
    return { page, registrations, requests, failures };
}
async function complete(page, email = "ui.fixture@gmail.com") {
    for (const [name, value] of Object.entries({ name: "UI Fixture Graduate", email, course: "BSIT", graduationYear: "2023", password: "Ui-fixture-password-123!", confirmPassword: "Ui-fixture-password-123!" })) {
        await page.type(`input[name="${name}"]`, value);
    }
    await (await page.$('input[type="file"]')).uploadFile(proof);
    await page.click("button.highlight-link");
    await page.waitForSelector(".modal.show");
    await page.evaluate(() => [...document.querySelectorAll(".modal-footer button")].find(button => /agree/i.test(button.textContent))?.click());
    await page.waitForFunction(() => !document.querySelector('input[name="consent"]').disabled);
    await page.waitForSelector(".modal", { hidden: true });
    await page.click('input[name="consent"]');
    assert.equal(await page.$eval('input[name="consent"]', input => input.checked), true);
}
const openOtp = async page => {
    await page.click(".auth-submit");
    try { await page.waitForSelector(".registration-otp-modal", { timeout: 15000 }); }
    catch (error) {
        await page.screenshot({ path: path.join(artifacts, "registration-otp-failure.png"), fullPage: true });
        error.message += await page.evaluate(() => JSON.stringify({ text: document.body.innerText, email: document.querySelector('[name="email"]')?.value, consent: document.querySelector('[name="consent"]')?.checked }));
        throw error;
    }
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Digit 1 of 6"]')?.disabled);
};
const pasteCode = async page => {
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Digit 1 of 6"]')?.disabled);
    await page.$eval('input[aria-label="Digit 1 of 6"]', input => {
        const clipboardData = new DataTransfer(); clipboardData.setData("text", "123 456");
        input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }));
    });
    await page.waitForFunction(() => !document.querySelector('.registration-otp-modal button[type="submit"]')?.disabled);
};

test("desktop OTP supports focus, incorrect feedback, paste, Gmail change, preserved upload and final submission", async () => {
    const f = await fixture(); const { page } = f;
    try {
        await complete(page); await openOtp(page);
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Digit 1 of 6");
        await page.keyboard.type("111111");
        assert.equal(await page.$eval('input[aria-label="Digit 6 of 6"]', input => input.value), "1");
        await page.click(".registration-otp-modal button[type=submit]");
        await page.waitForFunction(() => document.body.innerText.includes("Incorrect code. 4 attempts remaining."));
        await pasteCode(page); await page.click(".registration-otp-modal button[type=submit]");
        await page.waitForFunction(() => document.body.innerText.includes("Gmail verified successfully"));
        await page.screenshot({ path: path.join(artifacts, "registration-otp-desktop.png"), fullPage: true });
        await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Change Gmail address")?.click());
        await page.waitForFunction(() => document.activeElement?.name === "email");
        assert.equal(await page.$eval('input[type="file"]', input => input.files[0]?.name), path.basename(proof));
        assert.equal(await page.$eval('input[name="name"]', input => input.value), "UI Fixture Graduate");
        await page.focus('input[name="email"]'); await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control"); await page.keyboard.type("ui.changed@gmail.com");
        await openOtp(page); await pasteCode(page); await page.click(".registration-otp-modal button[type=submit]");
        await page.waitForFunction(() => document.body.innerText.includes("Gmail verified successfully"));
        assert.equal(new Set(f.requests.filter(r => r.operation === "send").map(r => r.session)).size, 2);
        await page.evaluate(() => [...document.querySelectorAll(".modal-footer button")].find(button => button.textContent === "Create Account")?.click());
        await page.waitForFunction(() => document.body.innerText.includes("Account Created Successfully!"));
        assert.equal(f.registrations.length, 1); assert.match(f.registrations[0].contentType, /multipart\/form-data/);
        const payload = await page.evaluate(() => window.otpFixtureSubmission);
        assert.equal(payload.registration_authorization, "ui-fixture-authorization");
        assert.equal(payload.email, "ui.changed@gmail.com");
        assert.match(payload.session_token, /^[a-f0-9]{64}$/);
        assert.equal(payload.proof_document.name, path.basename(proof));
        assert.deepEqual(f.failures, []);
    } finally { await page.close(); }
});
test("mobile OTP modal fits the viewport, shows cooldown and restores verification after refresh", async () => {
    const f = await fixture({ mobile: true }); const { page } = f;
    try {
        await complete(page); await openOtp(page);
        assert.ok(await page.$eval(".registration-otp-modal", modal => modal.getBoundingClientRect().width <= window.innerWidth));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        assert.ok(await page.$eval(".registration-otp-modal .btn-outline-success", button => button.disabled && button.textContent.includes("Resend code in")));
        await page.screenshot({ path: path.join(artifacts, "registration-otp-mobile.png"), fullPage: true });
        await pasteCode(page); await page.click(".registration-otp-modal button[type=submit]");
        await page.waitForFunction(() => document.body.innerText.includes("Gmail verified successfully"));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.body.innerText.includes("Gmail verified. Select Create Account"));
        assert.equal(await page.$eval('input[name="email"]', input => input.value), "ui.fixture@gmail.com");
        assert.equal(await page.$eval('input[name="password"]', input => input.value), "");
        assert.equal(await page.$eval('input[type="file"]', input => input.files.length), 0);
        assert.equal(f.registrations.length, 0); assert.deepEqual(f.failures, []);
    } finally { await page.close(); }
});
test("expired code disables verification and displays explicit feedback", async () => {
    const f = await fixture({ expired: true }); const { page } = f;
    try {
        await complete(page); await page.click(".auth-submit");
        await page.waitForFunction(() => document.body.innerText.includes("Your code has expired. Request a new code."));
        assert.equal(await page.$eval(".registration-otp-modal button[type=submit]", button => button.disabled), true);
        assert.deepEqual(f.failures, []);
    } finally { await page.close(); }
});
