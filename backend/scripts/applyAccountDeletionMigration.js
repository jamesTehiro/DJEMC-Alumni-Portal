const db = require('../models');
const migration = require('../migrations/20261102-create-account-deletion-files');
const { secureConnection } = require('../config/accountDeletionConnection');

// Check-only by default. This runner never replays the historical migration set.
async function main(argv = process.argv.slice(2)) {
    const apply = argv.includes('--apply');
    const option = flag => argv[argv.indexOf(flag) + 1];
    if (apply && (!argv.includes('--host') || !argv.includes('--database')
        || option('--host') !== db.sequelize.config.host || option('--database') !== db.sequelize.config.database)) {
        throw new Error('Apply requires --host and --database matching the configured reviewed target.');
    }
    secureConnection(db.sequelize);
    const qi = db.sequelize.getQueryInterface();
    if (apply) await migration.up(qi, db.Sequelize);
    const state = await migration.inspect(qi);
    console.log(JSON.stringify({ checkOnly: !apply, cleanupTableExists: state.exists, cleanupSchemaReady: state.ready, issues: state.issues, dueIndex: state.dueIndex || null }));
    if (!state.ready) process.exitCode = 1;
    return state;
}
if (require.main === module) main().catch(error => { console.error('[ACCOUNT_DELETION_MIGRATION_FAILED]', { kind: error.name }); process.exitCode = 1; }).finally(() => db.sequelize.close());
module.exports = { main };
