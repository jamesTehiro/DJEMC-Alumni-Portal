// Read-only diagnostics: never print message bodies, names, references,
// provider URLs, credentials, or authorization headers.
const crypto = require('node:crypto');
const db = require('../models');
const { parseStoredFileReference, sendStoredFile } = require('../services/objectStorage');
const { resolveMessageAttachment } = require('../services/messageAttachmentStorage');
const models = ['Message', 'EmployerMessage', 'Conversation', 'EmployerConversation', 'ConversationParticipant'];
const code = error => /^[A-Z0-9_]+$/.test(error.original?.code || error.code || '') ? error.original?.code || error.code : null;
const columns = new Map();
async function inspectAttachment(model, row, field, sample) {
    if (!row) return console.log(JSON.stringify({ model, sample, recordExists: false }));
    const reference = row[field];
    const parsed = parseStoredFileReference(reference);
    const metadata = { model, sample, recordExists: true, hasAttachment: !!reference, referenceLength: reference?.length || 0,
        fileFingerprint: reference ? crypto.createHash('sha256').update(reference).digest('hex').slice(0, 16) : null,
        referenceKind: parsed ? 'cld' : reference?.startsWith('cld:') ? 'incomplete_cld' : /^https?:/.test(reference || '') ? 'url' : reference ? 'local' : null,
        resourceType: ['image', 'raw', 'video'].includes(parsed?.resourceType) ? parsed.resourceType : null,
        deliveryType: ['upload', 'private', 'authenticated'].includes(parsed?.type) ? parsed.type : null,
        mime: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(row.file_mime || '') ? row.file_mime : null };
    if (reference && process.argv.includes('--probe')) {
        const originalFetch = global.fetch;
        try {
            const source = await resolveMessageAttachment(reference, model === 'EmployerMessage' ? 'admin_employer' : 'chat');
            metadata.resolved = source ? source.local ? 'existing_local_file' : 'remote' : 'unavailable_or_incomplete';
            if (source?.remote) {
                global.fetch = (url, options) => originalFetch(url, { ...options, method: 'HEAD', signal: AbortSignal.timeout(20000) });
                await sendStoredFile(source.remote, { setHeader() {}, send() {} });
                metadata.storageStatus = 200;
            }
        } catch (error) { metadata.storageStatus = error.status || null; metadata.failure = error.storageDiagnostic?.failure || 'provider_lookup'; metadata.providerCode = error.storageDiagnostic?.providerCode || null; }
        finally { global.fetch = originalFetch; }
    }
    console.log(JSON.stringify(metadata));
}
(async () => {
    try {
        console.log(JSON.stringify({ database: /^(localhost|127\.0\.0\.1|::1)$/.test(process.env.DB_HOST) ? 'local' : 'remote' }));
        await db.sequelize.authenticate();
        const qi = db.sequelize.getQueryInterface();
        const tables = (await qi.showAllTables()).map(value => typeof value === 'string' ? value : value.tableName || value.table_name);
        for (const name of models) {
            const table = db[name].getTableName();
            const matches = tables.filter(value => value.toLowerCase() === table.toLowerCase());
            if (matches.length !== 1) { console.log(JSON.stringify({ model: name, table, matches: matches.length })); continue; }
            const description = await qi.describeTable(matches[0]);
            columns.set(name, description);
            console.log(JSON.stringify({ model: name, table, exactCaseMatch: matches[0] === table,
                missingModelColumns: Object.values(db[name].rawAttributes).map(a => a.field).filter(field => !description[field]),
                referenceType: description.file_url?.type || description.attachment?.type || null }));
        }
        for (const id of [26, 3, 1]) {
            try {
                const conversation = await db.Conversation.findByPk(id, { attributes: ['id', 'type'], raw: true });
                const participants = conversation ? await db.ConversationParticipant.count({ where: { conversation_id: id } }) : 0;
                console.log(JSON.stringify({ observedConversationId: id, exists: !!conversation, type: ['direct', 'forum', 'batch', 'course'].includes(conversation?.type) ? conversation.type : null, participants }));
            } catch (error) { console.log(JSON.stringify({ observedConversationId: id, failure: code(error) })); }
        }
        try {
            const conversation = await db.EmployerConversation.findOne({ where: { employerId: 6 }, attributes: ['id', 'employerId', 'adminId'], raw: true });
            console.log(JSON.stringify({ observedEmployerParameter: 6, conversationExists: !!conversation, hasAssignedAdmin: !!conversation?.adminId }));
        } catch (error) { console.log(JSON.stringify({ observedEmployerParameter: 6, failure: code(error) })); }
        for (const [name, field] of [['Message', 'file_url'], ['EmployerMessage', 'attachment']]) {
            if (!columns.has(name)) continue;
            const attributes = ['id', field, 'file_mime'].filter(key => columns.get(name)[key]);
            if (name === 'Message') await inspectAttachment(name, await db[name].findByPk(80, { attributes, raw: true }), field, 'observed_attachment_80');
            for (const [sample, direction] of [['oldest_attachment', 'ASC'], ['newest_attachment', 'DESC']]) {
                const row = await db[name].findOne({ where: { [field]: { [db.Sequelize.Op.ne]: null } }, attributes, order: [['id', direction]], raw: true });
                await inspectAttachment(name, row, field, sample);
            }
        }
    } catch (error) { console.error(JSON.stringify({ failure: 'diagnostic_unavailable', code: code(error) })); process.exitCode = 1; }
    finally { await db.sequelize.close(); }
})();
