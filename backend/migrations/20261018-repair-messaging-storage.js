const ledgerDefinition = DataTypes => ({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    sender_id: { type: DataTypes.INTEGER, allowNull: false },
    channel: { type: DataTypes.STRING(20), allowNull: false },
    conversation_id: { type: DataTypes.INTEGER, allowNull: false },
    request_key: { type: DataTypes.STRING(64), allowNull: false },
    payload_hash: { type: DataTypes.STRING(64), allowNull: false },
    message_id: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
});
const identityIndex = { name: 'message_send_requests_identity', unique: true, fields: ['sender_id', 'channel', 'conversation_id', 'request_key'] };
const definitions = DataTypes => ({
    messages: { file_url: DataTypes.TEXT, file_name: DataTypes.STRING, file_mime: DataTypes.STRING, file_size: DataTypes.INTEGER },
    employermessages: { attachment: DataTypes.TEXT, file_name: DataTypes.STRING, file_mime: DataTypes.STRING, file_size: DataTypes.INTEGER },
    conversations: { last_message_text: DataTypes.TEXT, last_message_at: DataTypes.DATE },
    employerconversations: { last_message_text: DataTypes.TEXT, last_message_at: DataTypes.DATE },
    conversationparticipants: { last_read_at: DataTypes.DATE }
});
const essentials = {
    messages: ['id', 'conversation_id', 'sender_id', 'message_text', 'is_read', 'createdAt', 'updatedAt'],
    employermessages: ['id', 'conversationId', 'senderType', 'senderId', 'message', 'createdAt', 'updatedAt'],
    conversations: ['id', 'conversation_key', 'type'], employerconversations: ['id', 'employerId', 'adminId'],
    conversationparticipants: ['conversation_id', 'user_id']
};
async function inspect(qi, DataTypes) {
    const tables = (await qi.showAllTables()).map(value => typeof value === 'string' ? value : value.tableName || value.table_name);
    const plan = [];
    for (const [table, fields] of Object.entries(definitions(DataTypes))) {
        const matches = tables.filter(value => value.toLowerCase() === table);
        if (matches.length !== 1 || matches[0] !== table) throw new Error(`Expected one canonical ${table} table. Review table mappings; no parallel tables will be created.`);
        const columns = await qi.describeTable(table);
        if (essentials[table].some(field => !columns[field])) throw new Error(`Required ${table} relationship/content columns are missing. Manual schema review is required.`);
        for (const [column, type] of Object.entries(fields)) if (!columns[column]) plan.push({ action: 'add', table, column, definition: { type, allowNull: true } });
        if (table === 'conversationparticipants' && !columns.unread_count) plan.push({ action: 'add', table, column: 'unread_count', definition: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } });
        const reference = table === 'messages' ? 'file_url' : table === 'employermessages' ? 'attachment' : null;
        if (reference && columns[reference] && !/^(?:MEDIUM|LONG)?TEXT/i.test(columns[reference].type)) {
            if (!/^(?:VAR)?CHAR\(/i.test(columns[reference].type) || columns[reference].defaultValue != null) throw new Error(`Unexpected ${table}.${reference} definition. Manual schema review is required.`);
            if ((await qi.showIndex(table)).some(index => index.fields.some(field => field.attribute === reference))) throw new Error(`Indexed ${table}.${reference}; manual constraint review is required.`);
            plan.push({ action: 'widen', table, column: reference });
        }
    }
    const ledgerMatches = tables.filter(value => value.toLowerCase() === 'message_send_requests');
    if (ledgerMatches.length > 1 || ledgerMatches.length === 1 && ledgerMatches[0] !== 'message_send_requests') throw new Error('Ambiguous retry ledger table mapping.');
    if (!ledgerMatches.length) plan.push({ action: 'create_ledger', table: 'message_send_requests' });
    else {
        const columns = await qi.describeTable('message_send_requests');
        if (Object.keys(ledgerDefinition(DataTypes)).some(field => !columns[field])) throw new Error('The existing retry ledger has an unsupported definition.');
        const indexes = await qi.showIndex('message_send_requests');
        const matches = indexes.some(index => index.unique && index.fields.map(field => field.attribute).join(',') === identityIndex.fields.join(','));
        if (!matches) throw new Error('The existing retry ledger requires a reviewed unique index.');
    }
    return plan;
}
module.exports = {
    inspect,
    async up(qi, DataTypes) {
        const plan = await inspect(qi, DataTypes); // Check table mappings and required columns before DDL.
        for (const item of plan) {
            if (item.action === 'add') await qi.addColumn(item.table, item.column, item.definition);
            else if (item.action === 'widen') {
                // Reuse the preservation-aware widening migration rather than
                // discarding existing charset, collation, comments or nullability.
                await require('./20261017-expand-chat-attachment-references').up(qi, DataTypes);
            } else if (item.action === 'create_ledger') {
                await qi.createTable(item.table, ledgerDefinition(DataTypes), { engine: 'InnoDB' });
                await qi.addIndex(item.table, identityIndex.fields, { name: identityIndex.name, unique: true });
            }
        }
        if ((await inspect(qi, DataTypes)).length) throw new Error('Messaging schema verification failed.');
    },
    async down() { throw new Error('Retain messaging metadata and retry records on code rollback; destructive rollback is not supported.'); }
};
