const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const { parseStoredFileReference, sendStoredFile } = require("../services/objectStorage");
const payload = {
    provider: "cloudinary", resourceType: "image", type: "upload",
    publicId: `private_uploads/chat/${"folder/".repeat(40)}image`,
    url: `https://res.cloudinary.com/fixture/image/upload/v123/private_uploads/chat/${"folder/".repeat(40)}image.jpg`,
    originalName: "image.jpg"
};
const reference = `cld:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

test("long Cloudinary references remain intact and preview/download helper serves bytes", async () => {
    assert.ok(reference.length > 1000);
    assert.deepEqual(parseStoredFileReference(reference), payload);
    const originalFetch = global.fetch;
    const bytes = Buffer.from("fixture-image-bytes");
    let delivered;
    global.fetch = async () => ({ ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    try {
        await sendStoredFile(reference, { setHeader() {}, send: body => { delivered = body; } }, "image.jpg", "image/jpeg");
        assert.deepEqual(delivered, bytes);
    } finally { global.fetch = originalFetch; }
});

test("MySQL TEXT saves and retrieves long references without modifying application tables", { skip: process.env.CHAT_ATTACHMENT_DB_TEST !== "1" }, async () => {
    const db = require("../models");
    const table = `chat_reference_probe_${process.pid}`;
    try {
        assert.equal(db.Message.rawAttributes.file_url.type.key, "TEXT");
        assert.equal(db.EmployerMessage.rawAttributes.attachment.type.key, "TEXT");
        await db.sequelize.transaction(async transaction => {
            await db.sequelize.query(`CREATE TEMPORARY TABLE \`${table}\` (id INTEGER PRIMARY KEY AUTO_INCREMENT, file_url TEXT NULL, attachment TEXT NULL)`, { transaction });
            try {
                const Probe = db.sequelize.define("ChatReferenceProbe", { file_url: Sequelize.TEXT, attachment: Sequelize.TEXT }, { tableName: table, timestamps: false });
                const saved = await Probe.create({ file_url: reference, attachment: reference }, { transaction });
                const loaded = await Probe.findByPk(saved.id, { transaction });
                assert.equal(loaded.file_url, reference);
                assert.equal(loaded.attachment, reference);
                assert.deepEqual(parseStoredFileReference(loaded.file_url), payload);
                await Probe.create({ file_url: null, attachment: null }, { transaction });
            } finally {
                await db.sequelize.query(`DROP TEMPORARY TABLE IF EXISTS \`${table}\``, { transaction });
            }
        });
    } finally { await db.sequelize.close(); }
});
