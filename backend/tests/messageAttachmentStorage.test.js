const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
process.env.OBJECT_STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "attachment-fixture";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
const db = require("../models");
const express = require("express");
const controller = require("../controllers/messageController");
const employer = require("../controllers/adminEmployerMessageController");
const { chatAttachmentUpload } = require("../middleware/uploadMiddleware");
const { resolveMessageAttachment } = require("../services/messageAttachmentStorage");
const { recoverChatStoredFileReference, parseStoredFileReference } = require("../services/objectStorage");
const bytes = Buffer.from("%PDF-1.7\nattachment fixture");
const directory = path.resolve(__dirname, "../uploads/chat", `attachment-test-${process.pid}`);
const filename = "Report 100% + # résumé.pdf";
const originalFetch = global.fetch;
let server, origin, storedMessage, remoteExists = true, storageFailure = 0, storageCalls = [];
const originals = [];
const stub = (object, key, value) => { originals.push([object, key, object[key]]); object[key] = value; };
const cloudPayload = { provider: "cloudinary", resourceType: "raw", type: "authenticated", publicId: "private_uploads/chat/attachment-123.pdf", url: "https://res.cloudinary.com/attachment-fixture/raw/authenticated/v123/private_uploads/chat/attachment-123.pdf" };

test.before(async () => {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, filename), bytes, { flag: "wx" });
    stub(db.User, "findByPk", async id => ({ id: Number(id), role: "alumni", account_status: "verified" }));
    const conversation = { id: 9, type: "direct", update: async () => {} };
    stub(db.sequelize, "transaction", async run => run({ LOCK: { UPDATE: "UPDATE" } }));
    stub(db.Conversation, "findByPk", async () => conversation);
    stub(db.ConversationParticipant, "findOne", async ({ where }) => where.user_id === 1 ? { user_id: 1 } : null);
    stub(db.ConversationParticipant, "findOrCreate", async () => [{}]);
    stub(db.Message, "create", async data => { storedMessage = { ...data, id: 45, createdAt: new Date(), toJSON() { return { ...this }; } }; return storedMessage; });
    stub(db.Message, "findByPk", async () => storedMessage);
    stub(db.EmployerMessage, "findByPk", async () => storedMessage && ({ ...storedMessage, attachment: storedMessage.file_url, conversation: { employerId: 1 } }));
    global.fetch = async (url, options) => {
        if (!String(url).includes("cloudinary.com")) return originalFetch(url, options);
        storageCalls.push(String(url));
        if (storageFailure) return new Response("provider unavailable", { status: storageFailure });
        if (String(url).endsWith("/upload")) {
            assert.equal(options.body.get("type"), "authenticated");
            assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), bytes);
            return Response.json({ public_id: cloudPayload.publicId, secure_url: cloudPayload.url, resource_type: "raw", type: "authenticated" });
        }
        if (!remoteExists) return new Response("missing", { status: 404 });
        if (String(url).includes("/resources/")) return Response.json({ public_id: cloudPayload.publicId, secure_url: cloudPayload.url, resource_type: "raw", type: "authenticated" });
        return new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: Number(req.headers["x-fixture-user"] || 1), role: req.path.startsWith("/employer") ? "employer" : "alumni" }; next(); });
    app.post("/messages/:conversationId", chatAttachmentUpload, controller.sendConversationMessage);
    app.get("/messages/files/:fileName", controller.downloadMessageFile);
    app.get("/employer/files/:fileName", employer.downloadEmployerMessageAttachment);
    app.use((error, req, res, next) => res.status(error.status || 500).json({ msg: error.message }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    global.fetch = originalFetch;
    for (const [object, key, value] of originals) object[key] = value;
    if (server) await new Promise(resolve => server.close(resolve));
    assert.ok(directory.startsWith(path.resolve(__dirname, "../uploads/chat") + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
    await db.sequelize.close();
});

test("production multipart upload stores a complete private reference and retrieves/downloads identical bytes", async () => {
    const previous = process.env.RENDER;
    process.env.RENDER = "true";
    try {
        const form = new FormData();
        form.append("attachment", new Blob([bytes], { type: "application/pdf" }), "Report + # 2026.pdf");
        const saved = await fetch(`${origin}/messages/9`, { method: "POST", body: form });
        assert.equal(saved.status, 201, await saved.clone().text());
        const message = await saved.json();
        assert.equal(message.file_url, "/api/messages/files/45");
        assert.ok(storedMessage.file_url.length > 255);
        assert.equal(parseStoredFileReference(storedMessage.file_url).publicId, cloudPayload.publicId);
        for (const endpoint of ["/messages/files/45", "/messages/files/45?download=1", "/employer/files/45?download=1"]) {
            const response = await fetch(origin + endpoint);
            assert.equal(response.status, 200);
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
            assert.match(response.headers.get("content-disposition"), endpoint.includes("download") ? /^attachment;/ : /^inline;/);
            assert.equal(response.headers.get("cache-control"), "private, no-store");
        }
        const privatePdfRequests = storageCalls.filter(url => /^https:\/\/api\.cloudinary\.com\/v1_1\/attachment-fixture\/raw\/download\?/.test(url));
        assert.equal(privatePdfRequests.length, 3);
        for (const request of privatePdfRequests) {
            const url = new URL(request);
            assert.equal(url.searchParams.get("type"), "authenticated");
            assert.equal(url.searchParams.get("format"), "pdf");
            assert.equal(url.searchParams.get("public_id"), cloudPayload.publicId);
            assert.ok(Number(url.searchParams.get("expires_at")) > Math.floor(Date.now() / 1000));
            assert.equal(request.includes("fixture-secret"), false);
        }
    } finally { if (previous === undefined) delete process.env.RENDER; else process.env.RENDER = previous; }
});

test("relative, absolute, backend URL, encoded and legacy API references resolve the actual local file", async () => {
    const relative = `/uploads/chat/${path.basename(directory)}/${filename}`;
    const encoded = `/uploads/chat/${path.basename(directory)}/${encodeURIComponent(filename)}`;
    for (const reference of [relative, relative.slice(1), encoded, path.join(directory, filename), `C:\\old-deploy\\backend${relative.replaceAll("/", "\\")}`, `https://old-backend.example${encoded}`, `/api/files/chat/${path.basename(directory)}/${encodeURIComponent(filename)}`]) {
        assert.equal((await resolveMessageAttachment(reference)).local, path.join(directory, filename), reference);
    }
    const bare = `legacy-${process.pid} % + #.pdf`;
    const target = path.resolve(__dirname, "../uploads/chat", bare);
    await fs.writeFile(target, bytes, { flag: "wx" });
    try {
        for (const reference of [bare, encodeURIComponent(bare), `/api/messages/files/${encodeURIComponent(bare)}`]) assert.equal((await resolveMessageAttachment(reference)).local, target);
    } finally { await fs.unlink(target); }
});

test("path traversal and references outside message storage never resolve", async () => {
    for (const value of ["../secret.pdf", "%2e%2e%2fsecret.pdf", "/uploads/chat/../secret.pdf", "/private_uploads/resumes/resume.pdf", "C:\\secret.pdf", "cld:invalid", "https://untrusted.example/file.pdf", "/uploads/chat/%00.pdf"]) assert.equal(await resolveMessageAttachment(value), null, value);
});

test("missing files return a clear 404 and unrelated users are denied before storage access", async () => {
    storedMessage = { id: 45, conversation_id: 9, file_url: "/uploads/chat/missing.pdf", file_mime: "application/pdf" };
    for (const route of ["/messages/files/45", "/employer/files/45"]) {
        const missing = await fetch(origin + route);
        assert.equal(missing.status, 404);
        assert.match((await missing.json()).msg, /could not be found in storage/);
        const before = storageCalls.length;
        const forbidden = await fetch(origin + route, { headers: { "x-fixture-user": "999" } });
        assert.equal(forbidden.status, 403);
        assert.equal(storageCalls.length, before);
    }
    storedMessage.file_url = `cld:${Buffer.from(JSON.stringify(cloudPayload)).toString("base64url")}`;
    remoteExists = false;
    try { assert.equal((await fetch(`${origin}/messages/files/45`)).status, 404); }
    finally { remoteExists = true; }
});

test("special-character original filenames use safe UTF-8 download headers", async () => {
    storedMessage = { id: 45, conversation_id: 9, file_url: path.join(directory, filename), file_name: filename, file_mime: "application/pdf" };
    const response = await fetch(`${origin}/messages/files/45?download=1`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-disposition").includes(`filename*=UTF-8''${encodeURIComponent(filename)}`));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("legacy local files infer MIME; malformed references are 400 and absent attachments remain 404", async () => {
    storedMessage = { id: 45, conversation_id: 9, file_url: path.join(directory, filename), file_mime: null };
    const legacy = await fetch(`${origin}/messages/files/45`);
    assert.equal(legacy.status, 200);
    assert.match(legacy.headers.get('content-type'), /^application\/pdf/);
    assert.equal(legacy.headers.get('cache-control'), 'private, no-store');
    for (const reference of ['cld:invalid', '../secret.pdf', 'https://untrusted.example/file.pdf']) {
        storedMessage.file_url = reference;
        const response = await fetch(`${origin}/messages/files/45`);
        assert.equal(response.status, 400);
        assert.match((await response.json()).msg, /Invalid message attachment reference/);
    }
    storedMessage.file_url = null;
    assert.equal((await fetch(`${origin}/messages/files/45`)).status, 404);
});

test("255-character legacy cloud rows recover only existing assets with complete identifiers", async () => {
    const value = `cld:${Buffer.from(JSON.stringify({ ...cloudPayload, originalName: "long-name".repeat(50) })).toString("base64url")}`.slice(0, 255);
    const recovered = await recoverChatStoredFileReference(value);
    assert.equal(parseStoredFileReference(recovered).url, cloudPayload.url);
    remoteExists = false;
    try { assert.equal(await recoverChatStoredFileReference(value), null); }
    finally { remoteExists = true; }
    const before = storageCalls.length;
    assert.equal(await recoverChatStoredFileReference(value.slice(0, 110)), null);
    assert.equal(storageCalls.length, before);
});

test("provider errors return a useful temporary failure rather than file bytes or an authorization error", async () => {
    storedMessage = { id: 45, conversation_id: 9, file_url: `cld:${Buffer.from(JSON.stringify(cloudPayload)).toString("base64url")}`, file_name: "report.pdf", file_mime: "application/pdf" };
    storageFailure = 403;
    try {
        const response = await fetch(`${origin}/messages/files/45`);
        assert.equal(response.status, 502);
        assert.match(response.headers.get("content-type"), /application\/json/);
        assert.equal(response.headers.get("content-disposition"), null);
        assert.match((await response.json()).msg, /storage is temporarily unavailable/);
        const value = storedMessage.file_url.slice(0, 255);
        await assert.rejects(recoverChatStoredFileReference(value), error => error.status === 502 && /temporarily unavailable/.test(error.publicMessage));
    } finally { storageFailure = 0; }
});

test("production without cloud storage rejects only file uploads and preserves text-only messaging", async () => {
    const storage = require("../services/objectStorage");
    const middlewarePath = require.resolve("../middleware/uploadMiddleware");
    const previousModule = require.cache[middlewarePath];
    const enabled = storage.isObjectStorageEnabled;
    const previousRender = process.env.RENDER;
    storage.isObjectStorageEnabled = () => false;
    delete require.cache[middlewarePath];
    const localUpload = require("../middleware/uploadMiddleware").chatAttachmentUpload;
    storage.isObjectStorageEnabled = enabled;
    require.cache[middlewarePath] = previousModule;
    process.env.RENDER = "true";
    const app = express();
    app.post("/", localUpload, (req, res) => res.json({ text: req.body.message_text }));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ msg: error.publicMessage }));
    const localServer = app.listen(0, "127.0.0.1");
    await new Promise(resolve => localServer.once("listening", resolve));
    const url = `http://127.0.0.1:${localServer.address().port}/`;
    try {
        const text = new FormData(); text.append("message_text", "Still works");
        const response = await fetch(url, { method: "POST", body: text });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { text: "Still works" });
        const file = new FormData(); file.append("attachment", new Blob([bytes], { type: "application/pdf" }), "test.pdf");
        const failure = await fetch(url, { method: "POST", body: file });
        assert.equal(failure.status, 503);
        assert.match((await failure.json()).msg, /Persistent messaging attachment storage/);
    } finally {
        if (previousRender === undefined) delete process.env.RENDER; else process.env.RENDER = previousRender;
        await new Promise(resolve => localServer.close(resolve));
    }
});
