const crypto = require('node:crypto');
const db = require('../models');

const requestKey = value => {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) {
        throw Object.assign(new Error('Invalid message request identifier.'), { status: 400 });
    }
    return value;
};

// Lock one conversation while inserting its message, summary and optional
// retry ledger. All three commit together; a failed summary cannot leave a
// saved message behind a 500 response. The retry key is scoped to the sender
// and conversation and is never used as an authorization credential.
async function persistMessage({ channel, conversation, values, key, database = db }) {
    const legacy = channel === 'admin_employer';
    const Message = legacy ? database.EmployerMessage : database.Message;
    const Conversation = legacy ? database.EmployerConversation : database.Conversation;
    const senderId = legacy ? values.senderId : values.sender_id;
    const text = legacy ? values.message : values.message_text;
    const reference = legacy ? values.attachment : values.file_url;
    const identity = key ? { sender_id: senderId, channel, conversation_id: conversation.id, request_key: requestKey(key) } : null;
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify([text || '', !!reference, values.file_name || null, values.file_mime || null, values.file_size ?? null])).digest('hex');
    return database.sequelize.transaction(async transaction => {
        const locked = await Conversation.findByPk(conversation.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!locked) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
        if (identity) {
            const previous = await database.MessageSendRequest.findOne({ where: identity, transaction });
            if (previous) {
                if (previous.payload_hash !== payloadHash) throw Object.assign(new Error('This request identifier was already used for a different message.'), { status: 409 });
                const existing = await Message.findByPk(previous.message_id, { transaction });
                if (!existing) throw Object.assign(new Error('This message request was already processed. Refresh the conversation before sending again.'), { status: 409 });
                return { message: existing, replayed: true };
            }
        }
        const message = await Message.create(values, { transaction });
        const referenceField = legacy ? 'attachment' : 'file_url';
        const stored = await Message.findByPk(message.id, { attributes: ['id', referenceField, 'file_name', 'file_mime', 'file_size'], transaction });
        if (!stored || [referenceField, 'file_name', 'file_mime', 'file_size'].some(field => (stored[field] ?? null) !== (values[field] ?? null))) {
            throw Object.assign(new Error('Messaging attachment metadata could not be saved intact. Apply the messaging schema migration.'), { status: 503, code: 'MESSAGE_METADATA_NOT_PERSISTED', publicMessage: 'Messaging storage needs a schema update. Please contact the administrator.' });
        }
        await locked.update({ last_message_text: text || values.file_name || 'Attachment', last_message_at: message.createdAt }, { transaction });
        if (identity) await database.MessageSendRequest.create({ ...identity, payload_hash: payloadHash, message_id: message.id }, { transaction });
        return { message, replayed: false };
    });
}
module.exports = { persistMessage, requestKey };
