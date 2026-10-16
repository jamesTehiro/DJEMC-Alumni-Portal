'use strict';
const Sequelize = require('sequelize');
const migration = require('../migrations/20261016-repair-email-queue-dedupe-key');
async function run(db, args = process.argv.slice(2)) {
 const apply = args.includes('--apply');
 const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
 const expectedDatabase = value('--database');
 const expectedHost = value('--host');
 if (apply && (!expectedDatabase || !expectedHost)) throw new Error('--apply requires --database and --host matching the intended deployment.');
 await db.sequelize.authenticate();
 const [identity] = await db.sequelize.query('SELECT DATABASE() AS database_name', { type: Sequelize.QueryTypes.SELECT });
 if ((expectedDatabase && identity.database_name !== expectedDatabase) || (expectedHost && db.sequelize.config.host !== expectedHost)) throw new Error('Connected database identity does not match --database/--host. No schema changes performed.');
 console.log(JSON.stringify({ mode: apply ? 'apply' : 'check-only', database: identity.database_name, configuredDatabaseMatches: db.sequelize.config.database === identity.database_name }));
 const qi = db.sequelize.getQueryInterface();
 console.log('Email queue schema:', JSON.stringify(await migration.inspect(qi, Sequelize)));
 // Audit all registered models without selecting any application records.
 const columns = await db.sequelize.query('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()', { type: Sequelize.QueryTypes.SELECT });
 const inventory = new Map();
 for (const row of columns) { if (!inventory.has(row.table_name)) inventory.set(row.table_name, new Set()); inventory.get(row.table_name).add(row.column_name); }
 const gaps = Object.values(db.sequelize.models).map(model => ({ model: model.name, table: model.getTableName(), missingColumns: Object.values(model.rawAttributes).map(a => a.field).filter(field => !inventory.get(model.getTableName())?.has(field)) })).filter(row => row.missingColumns.length);
 console.log('Read-only model/schema gaps (no unrelated changes will be applied):', JSON.stringify(gaps));
 if (apply) { await migration.up(qi, Sequelize); console.log('Email queue dedupe migration applied and verified. Existing records preserved.'); }
 else console.log('Check only: no schema changes performed. Use --apply --database <name> --host <host> only after reviewing this report.');
}
if (require.main === module) {
 const db = require('../models');
 run(db).catch(error => { console.error('Email queue migration failed:', error.original?.code || error.name); console.error(error.original ? 'Database operation failed; inspect the database privately for details.' : error.message); process.exitCode = 1; }).finally(() => db.sequelize.close());
}
module.exports = { run };
