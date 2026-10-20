const Sequelize = require('sequelize');
const migration = require('../migrations/20261018-repair-messaging-storage');
async function run(db, args = process.argv.slice(2), report = console.log) {
    const apply = args.includes('--apply');
    const value = flag => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
    const database = value('--database'), host = value('--host');
    if (apply && (!database || !host)) throw new Error('--apply requires the reviewed --database and --host.');
    await db.sequelize.authenticate();
    const [identity] = await db.sequelize.query('SELECT DATABASE() AS database_name', { type: Sequelize.QueryTypes.SELECT });
    if (database && identity.database_name !== database || host && db.sequelize.config.host !== host) throw new Error('Database/host identity mismatch; no changes performed.');
    const qi = db.sequelize.getQueryInterface();
    const plan = await migration.inspect(qi, Sequelize);
    report(JSON.stringify({ mode: apply ? 'apply' : 'check-only', changes: plan.map(({ action, table, column }) => ({ action, table, column })) }));
    if (apply) { await migration.up(qi, Sequelize); report('Messaging schema verified. Existing messages and attachments were preserved.'); }
}
if (require.main === module) {
    const db = require('../models');
    run(db).catch(error => { console.error('Messaging schema repair failed:', error.original?.code || error.message); process.exitCode = 1; }).finally(() => db.sequelize.close());
}
module.exports = { run };
