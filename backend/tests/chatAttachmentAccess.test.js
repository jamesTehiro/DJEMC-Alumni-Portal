const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const unified = require("../controllers/messageController");
const legacy = require("../controllers/adminEmployerMessageController");
test.after(() => db.sequelize.close());

test("long attachment downloads preserve participant and employer authorization", async () => {
    const payload = { provider: "cloudinary", resourceType: "image", type: "upload", publicId: "chat/image", url: "https://res.cloudinary.com/fixture/image/upload/v1/chat/image.jpg", originalName: `${"name".repeat(100)}.jpg` };
    const reference = `cld:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    assert.ok(reference.length > 255);
    const overrides = [
        [db.Message, "findByPk", async () => ({ id: 1, conversation_id: 2, file_url: reference, file_name: "image.jpg" })],
        [db.Conversation, "findByPk", async () => ({ id: 2, type: "direct" })],
        [db.User, "findByPk", async id => ({ id, role: "alumni", account_status: "verified" })],
        [db.ConversationParticipant, "findOne", async options => options.where.user_id === 1 ? { user_id: 1 } : null],
        [db.EmployerMessage, "findByPk", async () => ({ attachment: reference, conversation: { employerId: 1 } })]
    ];
    const saved = overrides.map(([object, key]) => object[key]);
    const originalFetch = global.fetch;
    let fetches = 0;
    global.fetch = async () => { fetches++; return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
    overrides.forEach(([object, key, value]) => { object[key] = value; });
    try {
        for (const [controller, role] of [[unified.downloadMessageFile, "alumni"], [legacy.downloadEmployerMessageAttachment, "employer"]]) {
            let body, error;
            const res = { setHeader() {}, send: value => { body = value; } };
            await controller({ params: { fileName: "1" }, user: { id: 1, role } }, res, value => { error = value; });
            assert.equal(error, undefined);
            assert.deepEqual(body, Buffer.from([1, 2, 3]));
            const before = fetches;
            await controller({ params: { fileName: "1" }, user: { id: 999, role } }, res, value => { error = value; });
            assert.equal(error.status, 403);
            assert.equal(fetches, before);
        }
    } finally {
        global.fetch = originalFetch;
        overrides.forEach(([object, key], i) => { object[key] = saved[i]; });
    }
});
