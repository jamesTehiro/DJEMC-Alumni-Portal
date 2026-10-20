const Sequelize = require('sequelize');
const migration = require('../migrations/20261018-repair-messaging-storage');
const approvedActions = new Set(['widen:messages:file_url', 'widen:employermessages:attachment', 'create_ledger:message_send_requests:']);
function validateProductionPlan(plan) {
    if (plan.some(item => !approvedActions.has(`${item.action}:${item.table}:${item.column || ''}`))) {
        throw new Error('The schema differs from the reviewed three-change production plan. No production-plan writes are allowed.');
    }
}

async function guardedApply(db, databaseName, timeout, operation) {
    const sequelize = db.sequelize;
    const connection = await sequelize.connectionManager.getConnection();
    const query = (sql, options = {}) => sequelize.query(sql, { ...options, connection });
    // Pin every query-interface operation, including nested widening SQL, to
    // the same connection as the advisory lock and session lock-wait limit.
    const scopedSequelize = new Proxy(sequelize, { get(target, key) { return key === 'query' ? query : Reflect.get(target, key); } });
    const qi = new Proxy(sequelize.getQueryInterface(), { get(target, key) { return key === 'sequelize' ? scopedSequelize : Reflect.get(target, key); } });
    const lock = 'djemc_messaging_' + require('node:crypto').createHash('sha256').update(databaseName).digest('hex').slice(0, 32);
    let acquired = false, originalTimeout, clean = true;
    try {
        const [settings] = await query('SELECT @@SESSION.lock_wait_timeout AS lock_wait_timeout', { type: Sequelize.QueryTypes.SELECT });
        originalTimeout = Number(settings.lock_wait_timeout);
        if (!Number.isSafeInteger(originalTimeout) || originalTimeout < 1) throw new Error('Could not inspect session lock timeout.');
        const [result] = await query('SELECT GET_LOCK(:name, 0) AS acquired', { replacements: { name: lock }, type: Sequelize.QueryTypes.SELECT });
        if (Number(result.acquired) !== 1) throw new Error('Another messaging migration is running. No schema changes performed.');
        acquired = true;
        await query('SET SESSION lock_wait_timeout = :seconds', { replacements: { seconds: timeout } });
        await operation(qi);
    } finally {
        try {
            if (originalTimeout) await query('SET SESSION lock_wait_timeout = :seconds', { replacements: { seconds: originalTimeout } });
            if (acquired) await query('SELECT RELEASE_LOCK(:name) AS released', { replacements: { name: lock }, type: Sequelize.QueryTypes.SELECT });
        } catch { clean = false; }
        if (clean) await sequelize.connectionManager.releaseConnection(connection);
        else await sequelize.connectionManager.destroyConnection(connection);
    }
}
async function run(db, args = process.argv.slice(2), report = console.log) {
    const apply = args.includes('--apply');
    const value = flag => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
    const database = value('--database'), host = value('--host');
    const productionPlan = args.includes('--production-plan');
    const timeout = Number(value('--lock-wait-seconds') || 15);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60) throw new Error('Lock wait must be between 1 and 60 seconds.');
    if (apply && (!database || !host)) throw new Error('--apply requires the reviewed --database and --host.');
    await db.sequelize.authenticate();
    const [identity] = await db.sequelize.query('SELECT DATABASE() AS database_name', { type: Sequelize.QueryTypes.SELECT });
    if (database && identity.database_name !== database || host && db.sequelize.config.host !== host) throw new Error('Database/host identity mismatch; no changes performed.');
    const qi = db.sequelize.getQueryInterface();
    const plan = await migration.inspect(qi, Sequelize);
    if (productionPlan) {
        validateProductionPlan(plan);
        const tables = await db.sequelize.query("SELECT TABLE_NAME AS table_name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('messages','employermessages','conversations','employerconversations','conversationparticipants','message_send_requests')", { type: Sequelize.QueryTypes.SELECT });
        if (tables.some(table => table.engine !== 'InnoDB')) throw new Error('The production plan requires InnoDB tables. Review table engines separately.');
        const [server] = await db.sequelize.query('SELECT VERSION() AS server_version', { type: Sequelize.QueryTypes.SELECT });
        if (!['localhost', '127.0.0.1', '::1'].includes(db.sequelize.config.host) && !/^8\./.test(server.server_version)) throw new Error('Validate this plan on the actual MySQL major version before applying remotely.');
    }
    report(JSON.stringify({ mode: apply ? 'apply' : 'check-only', changes: plan.map(({ action, table, column }) => ({ action, table, column })) }));
    if (apply) {
        if (productionPlan && plan.length) await guardedApply(db, identity.database_name, timeout, async scoped => {
            validateProductionPlan(await migration.inspect(scoped, Sequelize));
            await migration.up(scoped, Sequelize);
        });
        else if (!productionPlan) await migration.up(qi, Sequelize);
        report('Messaging schema verified. Existing messages and attachments were preserved.');
    }
}
if (require.main === module) {
    let db;
    (async () => {
        try {
            db = require('../models');
            if (process.argv.includes('--production-plan') && (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(db.sequelize.config.host))) {
                if (!process.env.MIGRATION_DB_CA_FILE) throw new Error('A verified database CA file is required for the remote production plan.');
                const ssl = { ca: require('node:fs').readFileSync(process.env.MIGRATION_DB_CA_FILE, 'utf8'), rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' };
                db.sequelize.options.dialectOptions = { ...db.sequelize.options.dialectOptions, ssl };
                db.sequelize.config.dialectOptions = { ...db.sequelize.config.dialectOptions, ssl };
            }
            await run(db);
        } catch (error) {
            const code = error.original?.code || error.code;
            console.error('Messaging schema repair failed; review the target, TLS certificate, arguments and schema preflight.', { code: /^[A-Z0-9_]{1,64}$/.test(code || '') ? code : null });
            process.exitCode = 1;
        } finally { if (db) await db.sequelize.close(); }
    })();
}
module.exports = { run, validateProductionPlan, guardedApply };
