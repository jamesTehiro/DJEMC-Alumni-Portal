const test = require("node:test");
const assert = require("node:assert/strict");
process.env.OBJECT_STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "alumni-upload-fixture";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
process.env.MAX_UPLOAD_MB = "1";
const express = require("express");
const db = require("../models");
const auth = require("../controllers/authController");
const registrar = require("../controllers/registrarController");
const files = require("../controllers/fileController");
const { registrationUpload, alumniRegistrationUpload } = require("../middleware/uploadMiddleware");
const { otp } = require("../controllers/registrationOtpController");
const { readProofDocuments } = require("../services/alumniProofDocuments");
test.after(() => db.sequelize.close());

test("multipart alumni registration enforces six files, preserves associations, private access and optional uploads", async () => {
    const saved = [];
    const stub = (object, key, value) => { saved.push([object, key, object[key]]); object[key] = value; };
    const originalFetch = global.fetch;
    let profile, creations = 0, rejectSave = false;
    const assets = new Map();
    stub(global, "fetch", async (url, options) => {
        if (new URL(url).hostname === "127.0.0.1") return originalFetch(url, options);
        const target = new URL(url);
        assert.ok(["api.cloudinary.com", "res.cloudinary.com"].includes(target.hostname), "No external requests allowed");
        if (target.pathname.endsWith("/destroy")) {
            assets.delete(new URLSearchParams(options.body).get("public_id"));
            return Response.json({ result: "ok" });
        }
        if (target.pathname.endsWith("/upload")) {
            assert.equal(options.body.get("type"), "authenticated");
            const id = options.body.get("public_id");
            const file = options.body.get("file");
            assets.set(id, { bytes: await file.arrayBuffer(), type: file.type });
            const resource = file.type.startsWith("image/") ? "image" : "raw";
            return Response.json({ public_id: id, resource_type: resource, type: "authenticated", secure_url: `https://res.cloudinary.com/alumni-upload-fixture/${resource}/authenticated/${id}` });
        }
        const privatePublicId = target.pathname.endsWith("/download") ? target.searchParams.get("public_id") : null;
        const asset = [...assets].find(([id]) => target.pathname.endsWith(id) || id === privatePublicId)?.[1];
        assert.ok(asset, "Only fixture assets may be downloaded");
        return new Response(asset.bytes, { headers: { "Content-Type": asset.type } });
    });
    stub(db.User, "findOne", async () => null);
    stub(db.User, "create", async values => { creations++; return { id: 81, ...values }; });
    stub(db.User, "findAll", async () => [{ toJSON: () => ({ id: 81 }), AlumniProfile: { toJSON: () => ({ ...profile }) } }]);
    stub(db.sequelize, "transaction", async callback => callback({}));
    stub(otp, "consume", async () => ({ verified_at: new Date(), update: async () => {} }));
    stub(db.AlumniProfile, "findOrCreate", async ({ defaults }) => {
        profile = { ...defaults, save: async () => { if (rejectSave) throw new Error("Fixture persistence failure"); } };
        return [profile, true];
    });
    stub(db.AlumniProfile, "findOne", async ({ where }) => {
        if (where.user_id === 81 || where.proof_document_path === profile?.proof_document_path) return profile;
        if (where?.attribute?.fn === "JSON_CONTAINS") {
            const candidate = JSON.parse(where.attribute.args[1]);
            return readProofDocuments(profile).some(doc => doc.storage_ref === candidate.storage_ref) ? profile : null;
        }
        return null;
    });
    stub(db.Application, "findOne", async () => null);
    stub(db.EmployerProfile, "findOne", async () => null);
    stub(db.EmployerProfile, "findAll", async () => []);
    const app = express();
    app.post("/register", registrationUpload, auth.register);
    app.post("/alumni-parser", alumniRegistrationUpload, (req, res) => res.json({ count: req.files.proof_document?.length || 0 }));
    app.get("/pending", registrar.getPendingAlumniUsers);
    app.get("/secure/:token", (req, _res, next) => { req.user = { id: 1, role: req.query.role || "admin", admin_scope: req.query.scope || "registrar" }; next(); }, files.getSecureStoredFile);
    app.use((error, _req, res, _next) => res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 500).json({ msg: error.message }));
    const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const form = (count, overrides = {}) => {
        const body = new FormData();
        for (const [key, value] of Object.entries({ name: "Fixture Alumni", email: "fixture@gmail.com", password: "fixture-password", role: "alumni", course: "BSIT", graduationYear: "2024" })) body.append(key, value);
        for (let index = 0; index < count; index++) body.append("proof_document", new Blob([overrides.bytes || `%PDF-1.7 fixture ${index}`], { type: overrides.type || "application/pdf" }), overrides.name || `Proof ${index}.pdf`);
        return body;
    };
    const post = (body, route = "/register") => fetch(base + route, { method: "POST", body });
    try {
        for (const count of [0, 1, 6]) {
            const response = await post(form(count));
            assert.equal(response.status, 201, await response.clone().text());
            const documents = readProofDocuments(profile);
            assert.equal(documents.length, count);
            assert.equal(profile.proof_document_path, count ? documents[0].storage_ref : null);
            if (!count) continue;
            const pending = await (await fetch(base + "/pending")).json();
            const listed = pending[0].AlumniProfile.proof_documents;
            assert.equal(listed.length, count);
            assert.equal(JSON.stringify(listed).includes("cld:"), false);
            for (const [index, document] of listed.entries()) {
                assert.equal(document.name, `Proof ${index}.pdf`);
                const token = document.url.split("/").pop();
                const result = await fetch(`${base}/secure/${token}`);
                assert.equal(result.status, 200, await result.clone().text());
                assert.equal(await result.text(), `%PDF-1.7 fixture ${index}`);
                for (const query of ["role=alumni", "role=employer", "scope=alumni", "scope=employer"]) assert.equal((await fetch(`${base}/secure/${token}?${query}`)).status, 403);
            }
        }
        // Preserve the existing alumni formats, including the backend's legacy GIF support.
        for (const [name, type, bytes] of [
            ["proof.png", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
            ["proof.jpg", "image/jpeg", Buffer.from([255, 216, 255, 224])],
            ["proof.jpeg", "image/jpeg", Buffer.from([255, 216, 255, 224])],
            ["proof.doc", "application/msword", Buffer.from([208, 207, 17, 224])],
            ["proof.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from([80, 75, 3, 4])],
            ["proof.webp", "image/webp", Buffer.from("RIFF0000WEBP")],
            ["proof.gif", "image/gif", Buffer.from("GIF89a")]
        ]) {
            const response = await post(form(1, { name, type, bytes }));
            assert.equal(response.status, 201, await response.clone().text());
            assert.equal(readProofDocuments(profile)[0].name, name);
        }
        const before = creations;
        for (const route of ["/register", "/alumni-parser"]) {
            const response = await post(form(7), route);
            assert.equal(response.status, 400);
            assert.match((await response.json()).msg, /up to six/);
        }
        assert.equal(creations, before);
        assert.equal((await post(form(6), "/alumni-parser")).status, 200);
        const assetsBefore = assets.size;
        for (const [overrides, status] of [
            [{ name: "file.exe", type: "application/octet-stream" }, 415],
            [{ name: "file.png", type: "application/pdf" }, 415],
            [{ bytes: "invalid contents" }, 415],
            [{ bytes: new Uint8Array(0) }, 415],
            [{ bytes: Buffer.alloc(1024 * 1024 + 1) }, 413]
        ]) assert.equal((await post(form(1, overrides))).status, status);
        assert.equal(creations, before);
        assert.equal(assets.size, assetsBefore);
        // A valid file preceding an invalid file must also be cleaned up.
        const mixed = form(1);
        mixed.append("proof_document", new Blob(["not a PDF"], { type: "application/pdf" }), "bad.pdf");
        assert.equal((await post(mixed)).status, 415);
        assert.equal(assets.size, assetsBefore);
        rejectSave = true;
        assert.equal((await post(form(6))).status, 500);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(assets.size, assetsBefore, "Failed registration cleans up every uploaded proof");
    } finally {
        await new Promise(resolve => server.close(resolve));
        for (const [object, key, value] of saved.reverse()) object[key] = value;
    }
});

test("controller rejects a seventh proof even when upload middleware is bypassed", async () => {
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await auth.register({ body: { role: "alumni" }, files: { proof_document: Array.from({ length: 7 }, () => ({})) } }, response, error => { throw error; });
    assert.equal(response.code, 400);
    assert.match(response.body.msg, /up to six/);
});

test("additive proof metadata migration is idempotent and preserves legacy references", async () => {
    const migration = require("../migrations/20261022-add-alumni-proof-documents");
    const columns = { proof_document_path: { type: "TEXT" } };
    let additions = 0;
    const qi = {
        describeTable: async table => { assert.equal(table, "alumniprofiles"); return columns; },
        addColumn: async (table, column, definition) => { assert.equal(table, "alumniprofiles"); assert.equal(column, "proof_documents"); assert.equal(definition.allowNull, true); additions++; columns[column] = { type: "TEXT" }; }
    };
    await migration.up(qi, db.Sequelize);
    await migration.up(qi, db.Sequelize);
    assert.equal(additions, 1);
    assert.deepEqual(readProofDocuments({ proof_document_path: "/uploads/documents/legacy.pdf", proof_documents: "broken JSON" }), [{ storage_ref: "/uploads/documents/legacy.pdf", name: "legacy.pdf" }]);
    assert.ok(db.AlumniProfile.options.defaultScope.attributes.exclude.includes("proof_documents"));
    await assert.rejects(migration.down(), /Refusing to remove/);
});
