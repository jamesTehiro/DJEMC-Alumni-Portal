const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const messageController = require("../controllers/messageController");
const adminEmployerMessageController = require("../controllers/adminEmployerMessageController");
const authMiddleware = require("../middleware/authMiddleware");

test.after(async () => {
    await db.sequelize.close();
});

const createRes = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
});

const withOverrides = async (overrides, run) => {
    const originals = overrides.map(([target, methods]) => [
        target,
        Object.fromEntries(Object.keys(methods).map((method) => [method, target[method]]))
    ]);
    for (const [target, methods] of overrides) Object.assign(target, methods);
    try {
        await run();
    } finally {
        for (const [target, methods] of originals) Object.assign(target, methods);
    }
};

const forum = { id: 44, type: "forum", update: async () => {} };

const setupUnified = (user, message, deletedCount = 1) => {
    let deleteOptions = null;
    return {
        overrides: [
            [db.User, { findByPk: async () => user }],
            [db.Conversation, { findByPk: async () => forum }],
            [db.Message, {
                findOne: async (options) => options.where.id ? message : null,
                destroy: async (options) => { deleteOptions = options; return deletedCount; }
            }]
        ],
        getDeleteOptions: () => deleteOptions
    };
};

test("unified message deletion allows only the sender and scopes the delete query by sender", async () => {
    const user = { id: 7, role: "alumni", account_status: "verified", AlumniProfile: {} };
    const message = { id: 9, sender_id: "7", conversation_id: 44, file_url: null };
    const fixture = setupUnified(user, message);

    await withOverrides(fixture.overrides, async () => {
        const res = createRes();
        await messageController.deleteMessage({ user: { id: 7 }, params: { conversationId: "44", messageId: "9" } }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 200);
        assert.equal(fixture.getDeleteOptions().where.sender_id, 7);
    });
});

test("admins cannot delete another user's unified message", async () => {
    const user = { id: 7, role: "admin", admin_scope: "alumni", account_status: "verified", AlumniProfile: {} };
    const fixture = setupUnified(user, { id: 9, sender_id: 8, conversation_id: 44, file_url: null });

    await withOverrides(fixture.overrides, async () => {
        const res = createRes();
        await messageController.deleteMessage({ user: { id: 7 }, params: { conversationId: "44", messageId: "9" } }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 403);
        assert.equal(fixture.getDeleteOptions(), null);
    });
});

test("unified message deletion returns 404 when the message is missing", async () => {
    const fixture = setupUnified({ id: 7, role: "alumni", account_status: "verified", AlumniProfile: {} }, null);
    await withOverrides(fixture.overrides, async () => {
        const res = createRes();
        await messageController.deleteMessage({ user: { id: 7 }, params: { conversationId: "44", messageId: "9" } }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 404);
        assert.equal(fixture.getDeleteOptions(), null);
    });
});

test("unified message deletion returns 404 if the atomic owner-scoped delete loses a race", async () => {
    const user = { id: 7, role: "alumni", account_status: "verified", AlumniProfile: {} };
    const fixture = setupUnified(user, { id: 9, sender_id: 7, conversation_id: 44, file_url: null }, 0);

    await withOverrides(fixture.overrides, async () => {
        const res = createRes();
        await messageController.deleteMessage({ user: { id: 7 }, params: { conversationId: "44", messageId: "9" } }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 404);
        assert.equal(fixture.getDeleteOptions().where.sender_id, 7);
    });
});

test("legacy employer message deletion allows the sender and scopes the delete query by sender", async () => {
    const conversation = { id: 22, update: async () => {} };
    const message = { id: 5, senderId: "3", senderType: "employer", conversationId: 22, attachment: null };
    let deleteOptions = null;
    const overrides = [
        [adminEmployerMessageController, {
            ensureEmployerConversation: async () => conversation
        }],
        [db.EmployerMessage, {
            findOne: async (options) => options.where.id ? message : null,
            destroy: async (options) => { deleteOptions = options; return 1; }
        }]
    ];

    await withOverrides(overrides, async () => {
        const res = createRes();
        await adminEmployerMessageController.deleteEmployerMessage({ user: { id: 3, role: "employer" }, params: { employerId: "3", messageId: "5" } }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 200);
        assert.equal(deleteOptions.where.senderId, 3);
    });
});

test("employer admins cannot delete another sender's legacy employer message", async () => {
    const conversation = { id: 22, update: async () => {} };
    const message = { id: 5, senderId: 3, senderType: "employer", conversationId: 22, attachment: null };
    let deleteCalled = false;
    const overrides = [
        [adminEmployerMessageController, {
            ensureEmployerConversation: async () => conversation
        }],
        [db.EmployerMessage, {
            findOne: async (options) => options.where.id ? message : null,
            destroy: async () => { deleteCalled = true; return 1; }
        }]
    ];

    await withOverrides(overrides, async () => {
        const res = createRes();
        await adminEmployerMessageController.deleteEmployerMessage({ user: { id: 7, role: "admin", admin_scope: "employer" }, params: { employerId: "3", messageId: "5" } }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 403);
        assert.equal(deleteCalled, false);
    });
});

test("message auth middleware rejects deletion requests without credentials", () => {
    const res = createRes();
    let nextCalled = false;
    authMiddleware({ headers: {} }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});
