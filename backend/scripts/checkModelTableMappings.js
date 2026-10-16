// Read-only connection and schema audit. Uses the same environment as the backend.
const db = require('../models');
(async () => {
 try {
  await db.sequelize.authenticate();
  const [identity] = await db.sequelize.query('SELECT DATABASE() AS database_name, @@hostname AS server_hostname, @@port AS server_port, @@lower_case_table_names AS lower_case_table_names', { type: db.Sequelize.QueryTypes.SELECT });
  console.log(JSON.stringify({ configured: { host: db.sequelize.config.host, port: db.sequelize.config.port, database: db.sequelize.config.database }, connected: identity }, null, 2));
  const rows = await db.sequelize.query('SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()', { type: db.Sequelize.QueryTypes.SELECT });
  const tables = rows.map(row => row.table_name);
  const mappings = Object.values(db.sequelize.models).map(model => {
   const expected = model.getTableName();
   return { model: model.name, expected, exists_exactly: tables.includes(expected), case_variants: tables.filter(t => t.toLowerCase() === expected.toLowerCase() && t !== expected) };
  });
  const queryGenerator = db.sequelize.getQueryInterface().queryGenerator;
  for (const mapping of mappings) {
   mapping.query_ok = false;
   if (!mapping.exists_exactly) continue;
   try {
    // Validate SELECT permission and resolution without reading any records.
    await db.sequelize.query(`SELECT 1 FROM ${queryGenerator.quoteTable(mapping.expected)} WHERE 1 = 0`, { type: db.Sequelize.QueryTypes.SELECT });
    mapping.query_ok = true;
   } catch (err) {
    mapping.query_error = err.original?.code || err.name;
   }
  }
  console.log(JSON.stringify({ mappings }, null, 2));
  if (mappings.some(m => !m.exists_exactly || !m.query_ok)) process.exitCode = 1;
 } catch (err) {
  console.error('Read-only database verification failed:', err.original?.code || err.name, err.message);
  process.exitCode = 1;
 } finally { await db.sequelize.close(); }
})();
