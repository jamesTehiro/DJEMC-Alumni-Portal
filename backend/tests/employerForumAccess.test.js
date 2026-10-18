const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const controller = require('../controllers/messageController');
const employer = { id: 7, role: 'employer' };
const alumni = { id: 8, role: 'alumni', account_status: 'verified' };
const forum = { id: 44, type: 'forum', conversation_key: 'forum_global', name: 'Forum' };
const direct = { id: 45, type: 'direct', name: 'Direct', update: async () => {} };
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function fixture(user, conversation, run) {
    const changes = [];
    const replace = (target, key, value) => { changes.push([target, key, target[key]]); target[key] = value; };
    replace(db.User, 'findByPk', async () => user);
    replace(db.Conversation, 'findByPk', async () => conversation);
    replace(db.Conversation, 'findOrCreate', async () => [conversation]);
    replace(db.ConversationParticipant, 'findOne', async () => ({ user_id: user.id }));
    replace(db.ConversationParticipant, 'findOrCreate', async () => [{}]);
    try { await run(replace); } finally { for (const [target, key, value] of changes.reverse()) target[key] = value; }
}
const request = () => ({ user: { id: 7 }, params: { conversationId: '44', messageId: '9', fileName: '9' }, query: {}, body: { message_text: 'Hello' }, app: { get: () => null } });
test.after(() => db.sequelize.close());
for (const method of ['getConversationMessages', 'sendConversationMessage', 'markConversationAsRead', 'deleteMessage', 'downloadMessageFile']) {
    test(`Employer cannot use ${method} on Forum, even with existing membership`, async () => {
        await fixture(employer, forum, async (replace) => {
            replace(db.Message, 'findByPk', async () => ({ conversation_id: 44, file_url: 'private.pdf' }));
            let error;
            await controller[method](request(), res(), err => { error = err; });
            assert.equal(error?.status, 403);
        });
    });
}
for (const room of ['global', 'forum', 'employer']) {
    test(`Employer cannot read or send legacy ${room} Forum alias`, async () => {
        await fixture(employer, forum, async () => {
            for (const method of ['getLegacyRoomMessages', 'sendLegacyRoomMessage']) {
                const req = request(); req.params.room = room; req.body.room = room;
                const response = res();
                await controller[method](req, response, err => { throw err; });
                assert.equal(response.statusCode, 403);
            }
        });
    });
}
test('Socket authorization rejects Employer Forum access but retains Alumni and scoped Admin access', async () => {
    for (const user of [employer, alumni, { id: 9, role: 'admin', admin_scope: 'alumni' }, { id: 10, role: 'admin', admin_scope: 'employer' }]) {
        await fixture(user, forum, async () => {
            if (user.role === 'employer') await assert.rejects(controller.authorizeConversationSubscription(user.id, 44), { status: 403 });
            else assert.equal(await controller.authorizeConversationSubscription(user.id, 44), forum);
        });
    }
});
test('Alumni Forum and Employer direct messages remain readable', async () => {
    for (const [user, conversation] of [[alumni, forum], [employer, direct]]) {
        await fixture(user, conversation, async (replace) => {
            replace(db.Message, 'findAll', async () => [{ id: 9, conversation_id: conversation.id, message_text: 'Hello', sender_id: 8 }]);
            const response = res();
            await controller.getConversationMessages(request(), response, err => { throw err; });
            assert.equal(response.body.messages[0].message_text, 'Hello');
            assert.equal(await controller.authorizeConversationSubscription(user.id, conversation.id), conversation);
        });
    }
});
test('Employer direct send preserves attachments and realtime delivery', async () => {
    await fixture(employer, direct, async (replace) => {
        let saved, emitted;
        replace(db.sequelize, 'transaction', async run => run({ LOCK: { UPDATE: 'UPDATE' } }));
        replace(db.Message, 'findByPk', async () => saved);
        replace(db.Message, 'create', async payload => { saved = payload; return { id: 9, createdAt: new Date(), toJSON: () => ({ ...payload, id: 9 }) }; });
        replace(db.ConversationParticipant, 'findAll', async () => [{ user_id: 7 }, { user_id: 8 }]);
        const req = request();
        req.file = { originalname: 'test.pdf', mimetype: 'application/pdf', size: 123, storageRef: 'stored.pdf' };
        req.app.get = () => ({ sockets: { adapter: { rooms: new Map() }, sockets: new Map() }, to: room => ({ emit: (event, payload) => { emitted = { room, event, payload }; } }) });
        const response = res();
        await controller.sendConversationMessage(req, response, err => { throw err; });
        assert.equal(response.statusCode, 201);
        assert.equal(saved.conversation_id, 45);
        assert.equal(saved.file_size, 123);
        assert.equal(emitted.room, 'conversation:45');
        assert.equal(emitted.event, 'new-message');
        assert.equal(emitted.payload.message_text, 'Hello');
    });
});
test('Employer list excludes stale Forum membership and preserves direct unread counts', async () => {
    await fixture(employer, direct, async (replace) => {
        let participantCalls = 0, messageCalls = 0;
        replace(db.ConversationParticipant, 'findAll', async () => {
            participantCalls++;
            if (participantCalls === 1) return [{ Conversation: direct }];
            if (participantCalls === 2) return [{ conversation_id: 45, Conversation: direct }, { conversation_id: 44, Conversation: forum }];
            return [{ conversation_id: 45, User: employer }, { conversation_id: 45, User: alumni }];
        });
        replace(db.Message, 'findAll', async () => ++messageCalls === 1 ? [] : [{ conversation_id: 45, unread_count: '2' }, { conversation_id: 44, unread_count: '10' }]);
        const response = res();
        await controller.getAccessibleConversations(request(), response, err => { throw err; });
        assert.equal(response.body.length, 1);
        assert.equal(response.body[0].type, 'direct');
        assert.equal(response.body[0].unread_count, 2);
    });
});
