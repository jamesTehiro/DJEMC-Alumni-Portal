// Read-only connection/configuration preflight. Never reads user rows or runs DDL.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

async function check({ env, source = 'runtime', connect = mysql.createConnection }) {
    const local = /^(localhost|127\.0\.0\.1|::1)$/i.test(env.DB_HOST || '');
    const report = { source, readOnly: true, localDatabase: local,
        permanentDeletionEnabled: env.ACCOUNT_DELETION_POLICY === 'retain-memberships-v1',
        workerStorageCredentialsPresent: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].every(key => !!env[key]),
        workerStorageProviderSupported: !env.OBJECT_STORAGE_PROVIDER || env.OBJECT_STORAGE_PROVIDER === 'cloudinary',
        deploymentRuntimeVerified: false };
    let connection;
    try {
        if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER) throw Object.assign(new Error('Missing config'), { code: 'DB_CONFIG_MISSING' });
        connection = await connect({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME,
            user: env.DB_USER, password: env.DB_PASS || '', connectTimeout: 5000,
            ...(!local && { ssl: { rejectUnauthorized: true, ca: fs.readFileSync(env.DB_CA_FILE || path.join(__dirname, '../cert/ca.pem')) } }) });
        const [[identity]] = await connection.query('SELECT VERSION() AS version, @@version_comment AS version_comment');
        report.databaseVersion = identity.version;
        report.mysql84 = /^8\.4\./.test(identity.version) && !/mariadb/i.test(identity.version + identity.version_comment);
        const [tables] = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='account_deletion_files'");
        report.cleanupTableExists = tables.length === 1;
        report.cleanupEngineTransactional = tables[0]?.engine === 'InnoDB';
        const [indexes] = await connection.query("SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='account_deletion_files' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
        report.cleanupDueIndexExists = indexes.some(index => index.name === 'account_deletion_files_due' && index.column_name === 'status' && Number(index.position) === 1)
            && indexes.some(index => index.name === 'account_deletion_files_due' && index.column_name === 'next_attempt_at' && Number(index.position) === 2);
    } catch (error) { report.connectionError = error.code || error.name; }
    finally { if (connection) await connection.end(); }
    return report;
}
async function main() {
    const args = process.argv.slice(2), fileAt = args.indexOf('--env-file');
    const env = fileAt < 0 ? process.env : dotenv.parse(fs.readFileSync(path.resolve(args[fileAt + 1])));
    const report = await check({ env, source: fileAt < 0 ? 'runtime process' : 'selected local config file' });
    console.log(JSON.stringify(report, null, 2));
    if (report.connectionError) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error('[ACCOUNT_DELETION_PREFLIGHT_FAILED]', { kind: error.name }); process.exitCode = 1; });
module.exports = { check };
