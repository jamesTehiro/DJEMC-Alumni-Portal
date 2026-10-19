// Configuration/schema metadata only. Never sends email or changes queue rows.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const email = require('../utils/email');
const { safeEmailError } = require('../utils/emailDiagnostics');
const { compatibleType } = require('../utils/schemaAudit');

async function inspectSchema(db) {
    const qi = db.sequelize.getQueryInterface();
    const tables = (await qi.showAllTables()).map(row => typeof row === 'string' ? row : row.tableName || row.table_name);
    const [engines] = await db.sequelize.query("SELECT TABLE_NAME AS table_name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('notifications','email_queue_jobs')");
    const results = [];
    for (const name of ['Notification', 'EmailQueueJob']) {
        const model = db[name], table = model.getTableName();
        if (!tables.includes(table)) { results.push({ model: name, table, exists: false }); continue; }
        const columns = await qi.describeTable(table);
        const generator = model.sequelize.dialect.queryGenerator;
        const sqlType = attribute => attribute.type.toSql({ escape: generator.escape.bind(generator) });
        const missingColumns = Object.values(model.rawAttributes).map(attribute => attribute.field).filter(field => !columns[field]);
        const columnTypeDifferences = Object.values(model.rawAttributes).filter(attribute => columns[attribute.field] && !compatibleType(sqlType(attribute), columns[attribute.field].type)).map(attribute => attribute.field);
        const indexes = name === 'EmailQueueJob' ? await qi.showIndex(table) : [];
        const dedupeIndex = name !== 'EmailQueueJob' || indexes.some(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === 'dedupe_key' && !index.fields[0].length);
        results.push({ model: name, table, exists: true, missingColumns, columnTypeDifferences, transactionalEngine: engines.some(row => row.table_name === table && String(row.engine).toLowerCase() === 'innodb'), ...(name === 'EmailQueueJob' ? { uniqueDedupeIndex: dedupeIndex, nullableDedupeKey: columns.dedupe_key?.allowNull === true } : {}) });
    }
    return { ready: results.every(row => row.exists && !row.missingColumns.length && !row.columnTypeDifferences.length && row.transactionalEngine && row.uniqueDedupeIndex !== false && row.nullableDedupeKey !== false), skipLockedSupportedByDialect: Boolean(db.sequelize.dialect.supports.skipLocked), models: results };
}

async function main(args = process.argv.slice(2)) {
    email.logConfiguration();
    let configured = true;
    try { email.validateConfiguration(); } catch (error) { configured = false; console.error('[email] configuration incomplete', safeEmailError(error)); }
    const [major, minor] = process.versions.node.split('.').map(Number);
    const nodeSupported = major > 22 || major === 22 && minor >= 12;
    console.log(JSON.stringify({ embeddedWorkerEnabled: process.env.EMAIL_WORKER_ENABLED !== 'false', nodeSupported, sendsEmail: false }));
    if (!args.includes('--schema')) return { ready: configured && nodeSupported };
    const db = require('../models');
    try {
        const value = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
        const host = value('--host'), database = value('--database');
        if (!host || !database) throw Object.assign(new Error('Schema checks require --host and --database assertions.'), { code: 'EMAIL_CONFIG' });
        if (db.sequelize.config.host !== host || db.sequelize.config.database !== database) throw Object.assign(new Error('Database target mismatch.'), { code: 'EMAIL_CONFIG' });
        const [rows] = await db.sequelize.query('SELECT DATABASE() AS database_name');
        if (rows[0]?.database_name !== database) throw Object.assign(new Error('Database target mismatch.'), { code: 'EMAIL_CONFIG' });
        const result = await inspectSchema(db);
        console.log(JSON.stringify({ targetAssertionsMatched: true, ...result }));
        return { ...result, ready: result.ready && configured && nodeSupported };
    } finally { await db.sequelize.close(); }
}
if (require.main === module) main().then(result => { if (!result.ready) process.exitCode = 1; }).catch(error => { console.error('[notification-audit] check failed', safeEmailError(error)); process.exitCode = 1; });
module.exports = { inspectSchema, main };
