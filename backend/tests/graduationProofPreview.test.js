const test = require("node:test");
const assert = require("node:assert/strict");
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
    let downloads = 0;
    db.Application.findOne = async () => null;
    db.EmployerProfile.findOne = async () => null;
    db.EmployerProfile.findAll = async () => [];
    db.AlumniProfile.findOne = async options => options.where.proof_document_path === currentReference ? { user_id: 8 } : null;
    db.User.findAll = async () => [{ toJSON: () => ({ id: 8 }), AlumniProfile: { toJSON: () => ({ proof_document_path: currentReference }) } }];
    global.fetch = async (url, options) => {
        if (options?.method === "POST") {
            assert.equal(options.body.get("type"), "authenticated");
            const publicId = options.body.get("public_id");
            const resourceType = currentMime.startsWith("image/") ? "image" : "raw";
            return { ok: true, json: async () => ({ public_id: publicId, secure_url: `https://res.cloudinary.com/proof-fixture/${resourceType}/authenticated/v1/${publicId}`, type: "authenticated", resource_type: resourceType }) };
        }
        downloads++;
        assert.match(String(url), /s--/);
        return { ok: true, headers: { get: () => currentMime }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    };
    try {
        for (const [name, mime, data] of [["proof.png", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], ["proof.pdf", "application/pdf", Buffer.from("%PDF-1.7 fixture")]]) {
            currentMime = mime; bytes = data;
            currentReference = (await storage.uploadBuffer({ buffer: bytes, mimeType: mime, originalName: name, folder: "private_uploads/alumni_proof", isPublic: false, deliveryType: "authenticated" })).storageRef;
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
        assert.equal(files.toSecureFileUrl("/uploads/documents/old-proof.pdf"), "/api/files/documents/old-proof.pdf");
    } finally {
        global.fetch = originalFetch;
        [db.Application.findOne, db.EmployerProfile.findOne, db.EmployerProfile.findAll, db.AlumniProfile.findOne, db.User.findAll] = originals;
    }
});
