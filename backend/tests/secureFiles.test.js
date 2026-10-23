const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const { Writable } = require("node:stream");

process.env.OBJECT_STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "secure-fixture";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
process.env.JWT_SECRET = "secure-file-test-secret";
process.env.LOG_REQUESTS = "true";

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../models");
const storage = require("../services/objectStorage");
const files = require("../controllers/fileController");
const registrar = require("../controllers/registrarController");
const authentication = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const scope = require("../middleware/adminScopeMiddleware");
const encode = payload => `cld:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
const tokenPath = value => `/api/files/secure/${Buffer.from(value).toString("base64url")}`;
const headers = (user = { id: 1, role: "admin", admin_scope: "registrar" }) => ({ Authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}` });
const asset = (overrides = {}) => ({ provider: "cloudinary", resourceType: "image", type: "upload", publicId: "private_uploads/alumni_proof/proof-1700000000-123.png", url: "https://res.cloudinary.com/secure-fixture/image/upload/v1700000000/private_uploads/alumni_proof/proof-1700000000-123.png.png", originalName: "Graduation proof.png", ...overrides });
const privateAsset = (resourceType = "image", signed = true) => {
    const publicId = `private_uploads/alumni_proof/proof-1700000001-456.${resourceType === "image" ? "png" : "pdf"}`;
    return asset({ resourceType, type: "authenticated", publicId, url: `https://res.cloudinary.com/secure-fixture/${resourceType}/authenticated/${signed ? "s--existing--/" : ""}v1700000001/${publicId}${resourceType === "image" ? ".png" : ""}`, originalName: resourceType === "image" ? "Graduation proof.png" : "Graduation proof.pdf" });
};
test.after(() => db.sequelize.close());

test("secure files enforce authorization, provider identity and no-store delivery over HTTP", async t => {
    const originalFetch = global.fetch;
    const originalLog = console.log;
    const originalError = console.error;
    const restore = [];
    const stub = (object, key, value) => { const original = object[key]; restore.push(() => { object[key] = original; }); object[key] = value; };
    stub(require("../utils/rateLimitStore"), "consumeRateLimit", async () => ({ allowed: true }));
    stub(require("../controllers/registrationOtpController").otp, "consume", async () => ({ verified_at: new Date(), update: async () => {} }));
    let reference = encode(asset());
    let mime = "image/png";
    let bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    let providerStatus = 200;
    let providerFailure = false;
    const requested = [];
    const logs = [];
    const errors = [];
    let profile = { user_id: 8, proof_document_path: reference, save: async () => {}, toJSON() { return { user_id: this.user_id, proof_document_path: this.proof_document_path }; } };
    stub(db.Application, "findOne", async () => null);
    stub(db.EmployerProfile, "findOne", async () => null);
    stub(db.EmployerProfile, "findAll", async () => []);
    stub(db.AlumniProfile, "findOne", async ({ where }) => where.user_id === 8 || where.proof_document_path === reference ? profile : null);
    stub(db.AlumniProfile, "findOrCreate", async ({ defaults }) => { profile.proof_document_path = defaults.proof_document_path; reference = defaults.proof_document_path; return [profile, true]; });
    stub(db.User, "findOne", async () => null);
    stub(db.User, "findByPk", async id => ({
        1: { id: 1, role: "admin", admin_scope: "registrar", account_status: "verified" },
        2: { id: 2, role: "admin", admin_scope: "employer", account_status: "verified" },
        3: { id: 3, role: "admin", admin_scope: "alumni", account_status: "verified" },
        4: { id: 4, role: "admin", admin_scope: null, account_status: "verified" },
        8: { id: 8, role: "alumni", admin_scope: null, account_status: "pending" },
        9: { id: 9, role: "employer", admin_scope: null, account_status: "verified" },
        10: { id: 10, role: "employer", admin_scope: null, account_status: "verified" }
    })[id] || null);
    stub(db.User, "create", async values => ({ ...values, id: 8, account_status: "pending" }));
    stub(db.User, "findAll", async () => [{ toJSON: () => ({ id: 8 }), AlumniProfile: profile }]);
    stub(db.sequelize, "transaction", callback => callback({}));
    console.log = (...values) => logs.push(values);
    console.error = (...values) => errors.push(values);
    global.fetch = async (url, options) => {
        if (new URL(url).hostname === "127.0.0.1") return originalFetch(url, options);
        requested.push({ url: String(url), options });
        if (providerFailure) throw new Error("Failed signed URL https://private.invalid/?signature=secret-provider-detail");
        if (options?.method === "POST") {
            assert.equal(options.body.get("type"), "authenticated");
            const resourceType = mime.startsWith("image/") ? "image" : "raw";
            const publicId = options.body.get("public_id");
            return Response.json({ public_id: publicId, resource_type: resourceType, type: "authenticated", version: 1700000002, format: resourceType === "image" ? "png" : undefined,
                secure_url: `https://res.cloudinary.com/secure-fixture/${resourceType}/authenticated/s--existing--/v1700000002/${publicId}${resourceType === "image" ? ".png" : ""}` });
        }
        assert.equal(options?.headers?.["If-None-Match"], undefined);
        return new Response(providerStatus === 200 ? bytes : "PRIVATE provider details https://private.invalid/?signature=secret-provider-detail", { status: providerStatus, headers: { "Content-Type": providerStatus === 200 ? mime : "text/plain", ETag: '"provider-etag"', "Cache-Control": "public, max-age=3600", ...(providerStatus === 400 ? { "X-Cld-Error": "Invalid transformation component secret-provider-detail" } : {}) } });
    };
    const app = express(); // Keep default ETags enabled on the parent app.
    app.use(require("../middleware/requestLogger"));
    app.use("/api/auth", require("../routes/authRoutes"));
    app.use("/api/files", require("../routes/fileRoutes"));
    app.get("/pending", authentication, role("admin"), scope("registrar"), registrar.getPendingAlumniUsers);
    app.use(require("../middleware/errorHandler"));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (value = reference, extraHeaders = {}, userHeaders = headers()) => originalFetch(`${base}${tokenPath(value)}`, { headers: { ...userHeaders, ...extraHeaders } });
    const noStore = response => {
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("etag"), null);
        assert.equal(response.headers.get("last-modified"), null);
        assert.match(response.headers.get("vary"), /Authorization/i);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    };
    const setReference = value => { reference = value; profile.proof_document_path = value; };
    const localName = `secure-file-${crypto.randomUUID()}.pdf`;
    const local = path.join(__dirname, "..", "uploads", "documents", localName);
    try {
        await t.test("legacy Cloudinary cld, recovered truncated cld and plain URL references retain their URL and MIME", async () => {
            const legacy = asset({ originalName: "long-proof-name".repeat(80) + ".png" });
            const truncated = encode(legacy).slice(0, 500);
            assert.ok(storage.parseStoredFileReference(truncated));
            for (const value of [encode(asset()), truncated, asset().url, "https://legacy-storage.example.invalid/proof.png"]) {
                setReference(value);
                const response = await get();
                assert.equal(response.status, 200);
                assert.equal(response.headers.get("content-type"), mime);
                assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
                assert.equal(requested.at(-1).url, value.startsWith("https:") ? value : asset().url);
                noStore(response);
            }
        });
        await t.test("new authenticated references with and without an existing signature emit one valid asset signature", async () => {
            for (const resourceType of ["image", "raw"]) for (const signed of [false, true]) {
                const payload = privateAsset(resourceType, signed);
                setReference(encode(payload));
                mime = resourceType === "image" ? "image/png" : "application/pdf";
                const response = await get();
                assert.equal(response.status, 200);
                assert.equal(response.headers.get("content-type"), mime);
                await response.arrayBuffer();
                noStore(response);
                const url = new URL(requested.at(-1).url);
                if (resourceType === "raw") {
                    assert.equal(url.hostname, "api.cloudinary.com");
                    assert.equal(url.pathname, "/v1_1/secure-fixture/raw/download");
                    assert.equal(url.searchParams.get("type"), "authenticated");
                    assert.equal(url.searchParams.get("public_id"), payload.publicId);
                    assert.equal(url.searchParams.get("format"), "pdf");
                } else {
                    assert.equal((url.pathname.match(/\/s--/g) || []).length, 1);
                    const assetPath = payload.publicId + ".png";
                    const expected = crypto.createHash("sha1").update(assetPath + "fixture-secret").digest("base64url").slice(0, 8);
                    assert.equal(url.href, `https://res.cloudinary.com/secure-fixture/image/authenticated/s--${expected}--/v1700000001/${assetPath}`);
                }
            }
        });
        await t.test("multipart registration persists actual Cloudinary metadata and the registrar token retrieves PNG/PDF proofs", async () => {
            for (const [name, type, contents] of [["My graduation.png", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], ["My graduation.pdf", "application/pdf", Buffer.from("%PDF-1.7 fixture")]]) {
                mime = type; bytes = contents;
                const form = new FormData();
                for (const [key, value] of Object.entries({ name: "Fixture Alumni", email: "fixture.test@gmail.com", password: "test-password", role: "alumni", course: "BSIT", graduationYear: "2023" })) form.append(key, value);
                form.append("proof_document", new Blob([bytes], { type }), name);
                const registered = await originalFetch(`${base}/api/auth/register`, { method: "POST", body: form });
                assert.equal(registered.status, 201, await registered.text());
                const saved = storage.parseStoredFileReference(reference);
                assert.equal(saved.type, "authenticated");
                assert.equal(saved.resourceType, type === "image/png" ? "image" : "raw");
                assert.equal(saved.originalName, name);
                assert.equal(saved.version, 1700000002);
                assert.match(saved.url, /\/s--existing--\/v1700000002\//);
                const pending = await (await originalFetch(`${base}/pending`, { headers: headers() })).json();
                assert.equal(pending[0].AlumniProfile.proof_document_name, name);
                const fileUrl = pending[0].AlumniProfile.proof_document_url;
                assert.equal(Buffer.from(fileUrl.split("/").at(-1), "base64url").toString(), reference);
                const response = await originalFetch(`${base}${fileUrl}`, { headers: headers() });
                assert.equal(response.status, 200);
                assert.equal(response.headers.get("content-type"), type);
                assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
                noStore(response);
            }
        });
        await t.test("If-None-Match (including '*', matching byte ETag and another file's ETag) always retrieves authorized bytes", async () => {
            const etag = require("etag")(bytes);
            for (const value of [etag, 'W/"another-file"', "*"]) {
                const before = requested.length;
                const response = await get(reference, { "If-None-Match": value, "If-Modified-Since": "Wed, 21 Oct 2099 07:28:00 GMT" });
                assert.equal(response.status, 200);
                assert.equal(requested.length, before + 1);
                assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
                noStore(response);
            }
        });
        await t.test("malformed tokens return 400; missing/invalid credentials and unauthorized identities never contact storage", async () => {
            const before = requested.length;
            for (const token of ["!invalid", "a", "abc=", Buffer.from([0xff]).toString("base64url"), Buffer.from("a\0b").toString("base64url")]) {
                const response = await originalFetch(`${base}/api/files/secure/${token}`, { headers: headers() });
                assert.equal(response.status, 400); noStore(response);
            }
            for (const userHeaders of [{}, { Authorization: "Bearer invalid" }, headers({ id: 8, role: "alumni" }), headers({ id: 9, role: "employer" }), headers({ id: 2, role: "admin", admin_scope: "employer" }), headers({ id: 3, role: "admin", admin_scope: "alumni" }), headers({ id: 4, role: "admin" })]) {
                const response = await get(reference, { "If-None-Match": "*" }, userHeaders);
                assert.ok([401, 403].includes(response.status)); noStore(response);
            }
            assert.equal((await get(encode(asset({ publicId: "somebody-elses-file" })))).status, 403);
            assert.equal(requested.length, before);
        });
        await t.test("proof upload rejects mismatched extensions and signatures before provider upload", async () => {
            const before = requested.length;
            for (const [name, type, contents] of [["fake.pdf", "application/pdf", "<html>private</html>"], ["image.png", "application/pdf", "%PDF-1.7"]]) {
                const form = new FormData();
                form.append("role", "alumni");
                form.append("proof_document", new Blob([contents], { type }), name);
                const response = await originalFetch(`${base}/api/auth/register`, { method: "POST", body: form });
                assert.equal(response.status, 415);
            }
            assert.equal(requested.length, before);
        });
        await t.test("application ownership and employer job scope stay enforced", async () => {
            const original = db.Application.findOne;
            const applicationRef = encode(asset());
            db.Application.findOne = async options => options.where[db.Sequelize.Op.or].some(value => Object.values(value).includes(applicationRef)) ? { alumni_id: 8, Job: { employer_id: 9 } } : null;
            try {
                for (const [user, status] of [[{ id: 8, role: "alumni" }, 200], [{ id: 9, role: "employer" }, 200], [{ id: 10, role: "employer" }, 403], [{ id: 10, role: "alumni" }, 403]]) {
                    const response = await get(applicationRef, { "If-None-Match": "*" }, headers(user));
                    assert.equal(response.status, status); await response.arrayBuffer(); noStore(response);
                }
            } finally { db.Application.findOne = original; }
        });
        await t.test("legacy employer permit tokens remain restricted to employer admins", async () => {
            const original = db.EmployerProfile.findOne;
            const permitReference = encode(asset({ resourceType: "raw", publicId: "private_uploads/business_permits/permit.pdf", url: "https://res.cloudinary.com/secure-fixture/raw/upload/v1700000000/private_uploads/business_permits/permit.pdf" }));
            db.EmployerProfile.findOne = async options => options.where.business_permit_path ? { user_id: 9 } : null;
            try {
                for (const [user, status] of [[{ id: 2, role: "admin", admin_scope: "employer" }, 200], [{ id: 1, role: "admin", admin_scope: "registrar" }, 403], [{ id: 3, role: "admin", admin_scope: "alumni" }, 403], [{ id: 9, role: "employer" }, 403]]) {
                    const response = await get(permitReference, { "If-None-Match": "*" }, headers(user));
                    assert.equal(response.status, status); await response.arrayBuffer(); noStore(response);
                }
            } finally { db.EmployerProfile.findOne = original; }
        });
        await t.test("malformed or mismatched authorized references return 400 without contacting Cloudinary", async () => {
            const before = requested.length;
            for (const value of ["cld:broken", encode(null), encode({}), encode(asset({ publicId: "wrong-id" })), encode(asset({ resourceType: "raw" })), encode(asset({ type: "authenticated" })), encode(asset({ url: "http://127.0.0.1/secret" })), "/uploads/documents/../secret"]) {
                setReference(value);
                const response = await get();
                assert.equal(response.status, 400); noStore(response);
            }
            assert.equal(requested.length, before);
        });
        await t.test("upstream missing assets are 404; Cloudinary 400/401/403/5xx and network errors become safe 502", async () => {
            setReference(encode(privateAsset()));
            for (const [status, expected] of [[404, 404], [400, 502], [401, 502], [403, 502], [500, 502], [503, 502]]) {
                providerStatus = status;
                const response = await get(reference, { "If-None-Match": "*" });
                assert.equal(response.status, expected); noStore(response);
                assert.doesNotMatch(await response.text(), /secret-provider-detail|cld:|cloudinary|s--|PRIVATE/);
            }
            providerFailure = true;
            const response = await get();
            assert.equal(response.status, 502); noStore(response);
            assert.doesNotMatch(await response.text(), /private.invalid|signature|secret-provider-detail/);
            providerFailure = false; providerStatus = 200;
            assert.ok(errors.some(values => values[0] === "[secure-file-storage] Download failed" && values[1].upstreamStatus === 400 && values[1].providerCode === "invalid_transformation"));
        });
        await t.test("legacy local references and local tokens return PDF bytes without validators, and missing files return 404", async () => {
            await fs.mkdir(path.dirname(local), { recursive: true });
            await fs.writeFile(local, "%PDF-1.7 local fixture");
            setReference(`/uploads/documents/${localName}`);
            for (const route of [files.toSecureFileUrl(reference), tokenPath(reference)]) {
                const response = await originalFetch(`${base}${route}`, { headers: { ...headers(), "If-None-Match": "*", "If-Modified-Since": "Wed, 21 Oct 2099 07:28:00 GMT" } });
                assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/pdf");
                assert.equal(await response.text(), "%PDF-1.7 local fixture"); noStore(response);
            }
            await fs.unlink(local);
            for (const route of [files.toSecureFileUrl(reference), tokenPath(reference)]) {
                const response = await originalFetch(`${base}${route}`, { headers: headers() });
                assert.equal(response.status, 404); noStore(response);
                assert.doesNotMatch(await response.text(), /Alumni|uploads|ENOENT/);
            }
        });
        await t.test("request logs redact tokens/query strings and storage errors contain only safe metadata", () => {
            const output = JSON.stringify([...logs, ...errors]);
            assert.ok(logs.some(values => String(values[0]).includes("/api/files/secure/[redacted]")));
            for (const secret of [reference, Buffer.from(reference).toString("base64url"), "fixture-secret", "fixture-key", "secret-provider-detail", "s--existing--", "Authorization", "C:\\Alumni"]) assert.equal(output.includes(secret), false);
        });
    } finally {
        global.fetch = originalFetch; console.log = originalLog; console.error = originalError;
        for (const reset of restore.reverse()) reset();
        await fs.rm(local, { force: true });
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});

test("streamed private files handle a real signed Cloudinary URL and safe upstream failures", async () => {
    const originalFetch = global.fetch;
    const reference = encode(privateAsset("raw"));
    const bytes = Buffer.from("%PDF-1.7 streamed fixture");
    const responseHeaders = {};
    const received = [];
    const destination = new Writable({ write(chunk, encoding, callback) { received.push(chunk); callback(); } });
    destination.setHeader = (key, value) => { responseHeaders[key] = value; };
    try {
        global.fetch = async url => {
            const privateUrl = new URL(String(url));
            assert.equal(privateUrl.hostname, "api.cloudinary.com");
            assert.equal(privateUrl.pathname, "/v1_1/secure-fixture/raw/download");
            assert.equal(privateUrl.searchParams.get("public_id"), privateAsset("raw").publicId);
            return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length) } });
        };
        await storage.streamStoredFile(reference, destination);
        assert.deepEqual(Buffer.concat(received), bytes);
        assert.equal(responseHeaders["Content-Type"], "application/pdf");
        const apiUrl = new URL(storage.privateDownloadSourceUrl(reference));
        assert.equal(apiUrl.searchParams.get("public_id"), privateAsset("raw").publicId);
        assert.equal(apiUrl.searchParams.get("type"), "authenticated");
        assert.equal(apiUrl.searchParams.get("format"), "pdf");
        global.fetch = async () => new Response("private provider error", { status: 400, headers: { "X-Cld-Error": "Invalid signature private details" } });
        await assert.rejects(storage.streamStoredFile(reference, destination), error => error.storageDiagnostic.upstreamStatus === 400 && error.storageDiagnostic.providerCode === "signature_rejected" && !JSON.stringify(error).includes("private details"));
    } finally { global.fetch = originalFetch; }
});
