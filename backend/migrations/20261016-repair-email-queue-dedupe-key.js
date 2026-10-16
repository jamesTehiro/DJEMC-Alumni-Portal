'use strict';
const table = 'email_queue_jobs';
const indexName = 'email_queue_jobs_dedupe_key_uq';
async function inspect(qi, Sequelize) {
 const tables = await qi.showAllTables();
 if (!tables.some(t => (typeof t === 'string' ? t : t.tableName) === table)) throw new Error('The exact lowercase email_queue_jobs table is missing. Check the database connection; no table will be created.');
 const columns = await qi.describeTable(table);
 const column = columns.dedupe_key;
 if (column && (!/^VARCHAR\(191\)$/i.test(column.type) || column.allowNull !== true)) throw new Error('Existing dedupe_key must be nullable VARCHAR(191). Refusing to alter existing values or column definitions.');
 const indexes = await qi.showIndex(table);
 const fullUnique = index => index.unique === true && index.fields?.length === 1 &&
  index.fields[0].attribute === 'dedupe_key' && !index.fields[0].length;
 const named = indexes.find(index => index.name === indexName);
 if (named && !fullUnique(named)) throw new Error('Existing email_queue_jobs_dedupe_key_uq is not a full single-column unique index. Manual review required.');
 let duplicateGroups = 0;
 if (column) {
  const [result] = await qi.sequelize.query('SELECT COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM `email_queue_jobs` WHERE `dedupe_key` IS NOT NULL GROUP BY `dedupe_key` HAVING COUNT(*) > 1) AS duplicate_keys', { type: Sequelize.QueryTypes.SELECT });
  duplicateGroups = Number(result.duplicate_groups);
  if (!Number.isSafeInteger(duplicateGroups) || duplicateGroups < 0) throw new Error('Could not verify dedupe_key duplicate counts.');
 }
 return { columnPresent: !!column, uniqueIndexPresent: indexes.some(fullUnique), duplicateGroups };
}
module.exports = {
 inspect,
 async up(qi, Sequelize) {
  const before = await inspect(qi, Sequelize);
  if (before.duplicateGroups) throw new Error('Duplicate non-NULL dedupe_key groups exist (' + before.duplicateGroups + '). No records were changed. Resolve manually before retrying.');
  if (!before.columnPresent) await qi.addColumn(table, 'dedupe_key', { type: Sequelize.STRING(191), allowNull: true, defaultValue: null });
  const ready = before.columnPresent ? before : await inspect(qi, Sequelize);
  if (ready.duplicateGroups) throw new Error('Duplicate non-NULL dedupe_key groups appeared before index creation. No email records were changed.');
  if (!ready.uniqueIndexPresent) await qi.addIndex(table, ['dedupe_key'], { name: indexName, unique: true });
  const after = await inspect(qi, Sequelize);
  if (!after.columnPresent || !after.uniqueIndexPresent || after.duplicateGroups) throw new Error('Email queue deduplication schema verification failed.');
 },
 async down() {
  throw new Error('Automatic rollback is disabled to preserve dedupe keys and uniqueness. Roll back application code while retaining this additive schema; any schema rollback requires a separately reviewed plan.');
 }
};
