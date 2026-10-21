// Read-only deployment preflight. No rows, references, secrets or filenames are printed.
const db = require('../models');
const { isObjectStorageEnabled } = require('../services/objectStorage');
(async () => {
    try {
        await db.sequelize.authenticate();
        const qi = db.sequelize.getQueryInterface();
        const tables = (await qi.showAllTables()).map(value => typeof value === 'string' ? value : value.tableName || value.table_name);
        console.log(JSON.stringify({ databaseLocation: ['localhost', '127.0.0.1', '::1'].includes(db.sequelize.config.host) ? 'local' : 'remote',
            cloudinaryConfigured: isObjectStorageEnabled(),
            cloudinaryVariablesPresent: Object.fromEntries(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].map(key => [key, !!String(process.env[key] || '').trim()])),
            messagingStorage: isObjectStorageEnabled() ? 'cloudinary-authenticated' : 'disk-development-only',
            proofStorage: isObjectStorageEnabled() ? 'cloudinary-authenticated' : 'local-disk',
            employerPermitStorage: 'local-disk', persistentDiskMount: 'verify-in-Render-dashboard' }));
        for (const name of ['Message', 'EmployerMessage', 'MessageSendRequest', 'Conversation', 'EmployerConversation', 'ConversationParticipant', 'AlumniProfile', 'EmployerProfile']) {
            const model = db[name], table = model.getTableName();
            const matches = tables.filter(value => value.toLowerCase() === table.toLowerCase());
            if (matches.length !== 1 || matches[0] !== table) {
                console.log(JSON.stringify({ model: name, table, canonicalTableFound: false, matchingTables: matches.length }));
                continue;
            }
            const columns = await qi.describeTable(table);
            const fields = Object.entries(model.rawAttributes).map(([name, definition]) => definition.field || name);
            const referenceTypes = Object.fromEntries(['file_url', 'attachment', 'proof_document_path', 'business_permit_path', 'business_permit_documents'].filter(field => fields.includes(field)).map(field => [field, columns[field]?.type || null]));
            const [metadata] = await db.sequelize.query('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table', { replacements: { table }, type: db.Sequelize.QueryTypes.SELECT });
            console.log(JSON.stringify({ model: name, table, canonicalTableFound: true, missingColumns: fields.filter(field => !columns[field]), referenceTypes,
                transactionalEngine: metadata?.engine === 'InnoDB',
                ...(name === 'MessageSendRequest' ? { retryIdentityIndexPresent: (await qi.showIndex(table)).some(index => index.unique && index.fields.map(field => field.attribute).join(',') === 'sender_id,channel,conversation_id,request_key') } : {}) }));
        }
    } catch (error) {
        console.error(JSON.stringify({ failure: 'preflight_unavailable', code: /^[A-Z0-9_]+$/.test(error.original?.code || '') ? error.original.code : null }));
        process.exitCode = 1;
    } finally { await db.sequelize.close(); }
})();
