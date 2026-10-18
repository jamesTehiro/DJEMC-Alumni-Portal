const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
process.env.OBJECT_STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "proof-fixture";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
const db = require("../models");
const storage = require("../services/objectStorage");
const files = require("../controllers/fileController");
const registrar = require("../controllers/registrarController");
test.after(() => db.sequelize.close());

test("new private PNG/PDF proofs retain names, proxy bytes for admins, and deny other roles", async () => {
    const originalFetch = global.fetch;
    const originals = [db.Application.findOne, db.EmployerProfile.findOne, db.EmployerProfile.findAll, db.AlumniProfile.findOne, db.User.findAll];
    let currentReference;
    let currentMime;
    let bytes;
    let providerAsset;
    let alreadySigned;
    let downloads = 0;
    db.Application.findOne = async () => null;
    db.EmployerProfile.findOne = async () => null;
    db.EmployerProfile.findAll = async () => [];
    db.AlumniProfile.findOne = async options => options.where.proof_document_path === currentReference ? { user_id: 8 } : null;
    db.User.findAll = async () => [{ toJSON: () => ({ id: 8 }), AlumniProfile: { toJSON: () => ({ proof_document_path: currentReference }) } }];
    global.fetch = async (url, options) => {
        if (options?.method === "POST") {
            assert.equal(options.body.get("type"), "authenticated");
            // Use the provider's returned image identity, which need not be
            // identical to the public ID requested by the uploader.
            const publicId = options.body.get("public_id").replace(/\.png$/, "");
            const resourceType = currentMime.startsWith("image/") ? "image" : "raw";
            const assetPath = publicId + (resourceType === "image" ? ".png" : "");
            providerAsset = { public_id: publicId, secure_url: `https://res.cloudinary.com/proof-fixture/${resourceType}/authenticated/${alreadySigned ? "s--AbCd1234--/" : ""}v1700000000/${assetPath}`, type: "authenticated", resource_type: resourceType, version: 1700000000, ...(resourceType === "image" ? { format: "png" } : {}) };
            return Response.json(providerAsset);
        }
        downloads++;
        const segments = new URL(url).pathname.split("/").filter(Boolean);
        if (segments.filter(segment => /^s--.*--$/.test(segment)).length !== 1) {
            return new Response(null, { status: 400, headers: { "X-Cld-Error": "Invalid transformation component" } });
        }
        const assetPath = providerAsset.public_id + (providerAsset.resource_type === "image" ? ".png" : "");
        const expectedSignature = crypto.createHash("sha1").update(assetPath + "fixture-secret").digest("base64url").slice(0, 8);
        const expectedPath = `/proof-fixture/${providerAsset.resource_type}/authenticated/s--${expectedSignature}--/v1700000000/${assetPath}`;
        if (new URL(url).pathname !== expectedPath) return new Response(null, { status: 400, headers: { "X-Cld-Error": "Invalid signature" } });
        return new Response(bytes, { headers: { "Content-Type": currentMime } });
    };
    try {
        for (const [name, mime, data] of [["proof.png", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], ["proof.pdf", "application/pdf", Buffer.from("%PDF-1.7 fixture")]]) {
          for (alreadySigned of [false, true]) {
            currentMime = mime; bytes = data;
            currentReference = (await storage.uploadBuffer({ buffer: bytes, mimeType: mime, originalName: name, folder: "private_uploads/alumni_proof", isPublic: false, deliveryType: "authenticated" })).storageRef;
            const parsed = storage.parseStoredFileReference(currentReference);
            assert.equal(parsed.publicId, providerAsset.public_id);
            assert.equal(parsed.url, providerAsset.secure_url);
            assert.equal(parsed.resourceType, providerAsset.resource_type);
            assert.equal(parsed.type, providerAsset.type);
            assert.equal(parsed.version, providerAsset.version);
            assert.equal(parsed.format, providerAsset.format);
            if (alreadySigned) {
                // Negative control: reproduce the deployed builder's duplicate
                // signature. The provider fixture rejects it with HTTP 400.
                const source = new URL(providerAsset.secure_url);
                const resourcePath = source.pathname.split("/").filter(Boolean).slice(3).join("/");
                const oldSignature = crypto.createHash("sha1").update(resourcePath + "fixture-secret").digest("base64url").slice(0, 8);
                const broken = `https://res.cloudinary.com/proof-fixture/${providerAsset.resource_type}/authenticated/s--${oldSignature}--/${resourcePath}`;
                assert.equal((await global.fetch(broken)).status, 400);
            }
            let users;
            await registrar.getPendingAlumniUsers({}, { json: result => { users = result; }, status() { throw Error("pending-user serialization failed"); } });
            assert.equal(users[0].AlumniProfile.proof_document_name, name);
            assert.match(users[0].AlumniProfile.proof_document_url, /^\/api\/files\/secure\//);
            const token = users[0].AlumniProfile.proof_document_url.split("/").pop();
            let body, failure;
            const headers = {};
            const res = { setHeader: (key, value) => { headers[key] = value; }, send: value => { body = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
            await files.getSecureStoredFile({ params: { token }, user: { id: 1, role: "admin", admin_scope: "registrar" } }, res, error => { failure = error; });
            assert.equal(failure, undefined);
            assert.deepEqual(body, bytes);
            assert.equal(headers["Content-Type"], mime);
            for (const user of [{ id: 8, role: "alumni" }, { id: 9, role: "employer" }]) {
                const before = downloads;
                await files.getSecureStoredFile({ params: { token }, user }, res, error => { throw error; });
                assert.equal(res.code, 403);
                assert.equal(downloads, before);
            }
          }
        }
        assert.equal(files.toSecureFileUrl("/uploads/documents/old-proof.pdf"), "/api/files/documents/old-proof.pdf");
    } finally {
        global.fetch = originalFetch;
        [db.Application.findOne, db.EmployerProfile.findOne, db.EmployerProfile.findAll, db.AlumniProfile.findOne, db.User.findAll] = originals;
    }
});
