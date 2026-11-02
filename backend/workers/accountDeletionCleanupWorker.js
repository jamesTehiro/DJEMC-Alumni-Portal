const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../models');
const { createCleanup } = require('../services/accountDeletionCleanup');
const { POLICY } = require('../services/accountDeletion');
const { inspectConfiguration } = require('../services/accountDeletionWorkerConfig');
const { inspect } = require('../services/accountDeletionSchema');
const { secureConnection } = require('../config/accountDeletionConnection');
async function main({ checkOnly = false } = {}) {
    const configuration = inspectConfiguration();
    if (!checkOnly && process.env.ACCOUNT_DELETION_POLICY !== POLICY) throw new Error('Approved deletion policy must be configured before cleanup.');
    if (!configuration.storageConfigured) throw new Error('Cleanup storage configuration must be complete before reserving jobs.');
    secureConnection(db.sequelize);
    await db.sequelize.authenticate();
    const schema = await inspect(db.sequelize.getQueryInterface());
    if (checkOnly) {
        console.log(JSON.stringify({ readOnly: true, ...configuration, cleanupSchemaReady: schema.ready, schemaIssues: schema.issues, canStart: configuration.policyEnabled && schema.ready }));
        if (!schema.ready) process.exitCode = 1;
        await db.sequelize.close(); return;
    }
    if (!schema.ready) throw new Error('Cleanup schema must be ready before reserving jobs.');
    const cleanup = createCleanup({ db });
    let stopping = false, wake;
    const stop = () => { stopping = true; wake?.(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    while (!stopping) {
        try { if (await cleanup.processOne()) continue; }
        catch { console.error('[ACCOUNT_DELETION_CLEANUP_FAILED]', { code: 'QUEUE_OR_SCHEMA_ERROR' }); }
        if (!stopping) await new Promise(resolve => { const timer = setTimeout(resolve, 10000); wake = () => { clearTimeout(timer); resolve(); }; });
    }
    await db.sequelize.close();
}
if (require.main === module) main({ checkOnly: process.argv.includes('--check') }).catch(async () => { console.error('[ACCOUNT_DELETION_CLEANUP_START_FAILED]'); process.exitCode = 1; await db.sequelize.close(); });
module.exports = { main };
