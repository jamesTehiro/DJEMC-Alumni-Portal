const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const legacy = require('../controllers/adminEmployerMessageController');
test.after(() => db.sequelize.close());

test('employer history serializes text-only and legacy attachment rows without missing-helper exceptions', async () => {
    const conversation = { id: 71, employerId: 6, adminId: 2 };
    const originals = [legacy.ensureEmployerConversation, db.EmployerConversation.findByPk, db.EmployerMessage.findAll];
    legacy.ensureEmployerConversation = async () => conversation;
    db.EmployerConversation.findByPk = async () => null;
    db.EmployerMessage.findAll = async () => [
        { id: 10, conversationId: 71, senderId: 6, senderType: 'employer', message: 'Fixture', attachment: null, file_name: null },
        { id: 11, conversationId: 71, senderId: 2, senderType: 'admin', message: null, attachment: '/uploads/admin_employer/legacy.pdf', file_name: null },
        { id: 12, conversationId: 71, senderId: 2, senderType: 'admin', message: null, attachment: 'cld:incomplete', file_name: null },
        { id: 13, conversationId: 71, senderId: 2, senderType: 'admin', message: null, attachment: 'https://res.cloudinary.com/fixture/raw/upload/report.pdf?signature=private', file_name: null }
    ];
    let failure, result;
    try {
        await legacy.getEmployerMessages({ params: { employerId: '6' }, user: { id: 2, role: 'admin', admin_scope: 'employer' } },
            { json(value) { result = value; } }, error => { failure = error; });
        assert.equal(failure, undefined);
        assert.equal(result.messages.length, 4);
        assert.equal(result.messages[0].attachment, null);
        assert.equal(result.messages[1].file_name, 'legacy.pdf');
        assert.equal(result.messages[1].attachment, '/api/admin-employer/messages/files/11');
        assert.equal(result.messages[2].file_name, null);
        assert.equal(result.messages[3].file_name, 'report.pdf');
    } finally { [legacy.ensureEmployerConversation, db.EmployerConversation.findByPk, db.EmployerMessage.findAll] = originals; }
});
