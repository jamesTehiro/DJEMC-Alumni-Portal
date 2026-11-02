// Metadata only: no account records, credentials, DDL or data mutations.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
(async () => {
    let connection;
    try {
        const local = /^(localhost|127\.0\.0\.1|::1)$/i.test(env.DB_HOST);
        connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
            database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASS, connectTimeout: 10000,
            ...(!local && { ssl: { rejectUnauthorized: true, ca: fs.readFileSync(path.join(__dirname, '../cert/ca.pem')) } }) });
        const [foreignKeys] = await connection.query(`SELECT DISTINCT k.TABLE_NAME AS table_name, k.COLUMN_NAME AS column_name,
            k.REFERENCED_TABLE_NAME AS referenced_table, k.REFERENCED_COLUMN_NAME AS referenced_column,
            r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k
            JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
            AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
            WHERE k.TABLE_SCHEMA=DATABASE() ORDER BY k.TABLE_NAME,k.COLUMN_NAME`);
        const [tables] = await connection.query('SELECT TABLE_NAME AS table_name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
        const report = { metadataOnly: true, remote: !local, inspectedAt: new Date().toISOString(), tables, foreignKeys };
        fs.writeFileSync(path.join(__dirname, '../docs/account-deletion-schema.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ metadataOnly: true, remote: !local, tables: tables.length, foreignKeys: foreignKeys.length, report: 'docs/account-deletion-schema.json' }));
    } catch (error) { console.error('Schema inspection failed:', error.code || error.name); process.exitCode = 1; }
    finally { if (connection) await connection.end(); }
})();
