// Temporary, opt-in startup diagnostic. Never publishes database details via HTTP.
exports.logJobTableDiagnostics = async (db, env = process.env, logger = console) => {
 if (env.JOB_TABLE_DIAGNOSTICS !== 'true') return;
 const table = db.Job.getTableName();
 const jobTable = typeof table === 'string' ? table : table.tableName;
 const revision = env.RENDER_GIT_COMMIT || env.COMMIT_SHA || env.SOURCE_VERSION || '';
 const diagnostic = {
  commit: /^[a-f0-9]{7,64}$/i.test(revision) ? revision : 'unknown',
  jobTable,
  configuredDatabase: db.sequelize.config.database
 };
 try {
  const [identity] = await db.sequelize.query('SELECT DATABASE() AS database_name', { type: db.Sequelize.QueryTypes.SELECT });
  const tables = await db.sequelize.query("SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'jobs'", { type: db.Sequelize.QueryTypes.SELECT });
  diagnostic.connectedDatabase = identity.database_name;
  diagnostic.lowercaseJobsExists = tables.some(row => row.table_name === 'jobs');
  diagnostic.result = jobTable !== 'jobs' ? 'model-table-mismatch' : diagnostic.lowercaseJobsExists ? 'mapped-table-present' : 'lowercase-jobs-missing';
 } catch (err) {
  diagnostic.result = 'diagnostic-query-failed';
  diagnostic.errorCode = err.original?.code || 'DATABASE_QUERY_FAILED';
 }
 logger.log('[job-table-diagnostic]', JSON.stringify(diagnostic));
};
