module.exports = (sequelize, DataTypes) => sequelize.define('MessageSendRequest', {
    sender_id: { type: DataTypes.INTEGER, allowNull: false },
    channel: { type: DataTypes.STRING(20), allowNull: false },
    conversation_id: { type: DataTypes.INTEGER, allowNull: false },
    request_key: { type: DataTypes.STRING(64), allowNull: false },
    payload_hash: { type: DataTypes.STRING(64), allowNull: false },
    message_id: { type: DataTypes.INTEGER, allowNull: false }
}, { tableName: "message_send_requests", indexes: [{ name: 'message_send_requests_identity', unique: true, fields: ['sender_id', 'channel', 'conversation_id', 'request_key'] }] });
