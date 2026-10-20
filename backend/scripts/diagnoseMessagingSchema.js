// Temporary deployment diagnostic: schema metadata only, no application rows,
// storage lookups, raw exceptions, credential values, or public HTTP endpoints.
const modelNames = ['Message', 'EmployerMessage', 'Conversation', 'EmployerConversation', 'ConversationParticipant', 'MessageSendRequest'];
const safeCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_DATA_TOO_LONG', 'DIAGNOSTIC_READ_ONLY']);
const safeCode = error => { const code = error.original?.code || error.code; return safeCodes.has(code) ? code : null; };
const emit = value => console.log('[messaging-schema-diagnostic] ' + JSON.stringify(value));
const engineQuery = 'SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table';
const columnType = value => {
    const type = String(value || '').toUpperCase();
    if (/^(ENUM|SET)\(/.test(type)) return type.split('(')[0];
    return /^(?:(?:TINY|SMALL|MEDIUM|BIG)?INT(?:EGER)?|VARCHAR|CHAR|(?:MEDIUM|LONG|TINY)?TEXT|DATETIME|TIMESTAMP|DATE|TIME|BOOLEAN|DECIMAL|FLOAT|DOUBLE|BLOB|JSON)(?:\(\d+(?:,\d+)?\))?(?: UNSIGNED)?$/.test(type) ? type : 'unrecognized_type';
};

// Give both diagnostics and the existing migration dry-run only these schema
// operations. A future accidental write/query cannot reach the real database.
function createReadOnlyDatabase(db) {
    const tables = new Set(modelNames.map(name => db[name].getTableName()));
    const qi = db.sequelize.getQueryInterface();
    const blocked = () => { throw Object.assign(new Error('Only schema reads are allowed.'), { code: 'DIAGNOSTIC_READ_ONLY' }); };
    const metadata = Object.fromEntries(modelNames.map(name => [name, Object.freeze({
        rawAttributes: db[name].rawAttributes, options: db[name].options,
        getTableName: () => db[name].getTableName()
    })]));
    const readOnlyInterface = Object.freeze({
        showAllTables: () => qi.showAllTables(),
        describeTable: table => tables.has(table) ? qi.describeTable(table) : blocked(),
        showIndex: table => tables.has(table) ? qi.showIndex(table) : blocked()
    });
    return Object.freeze({ ...metadata, Sequelize: db.Sequelize, sequelize: Object.freeze({
        config: Object.freeze({ host: db.sequelize.config.host }),
        authenticate: () => db.sequelize.authenticate(),
        getQueryInterface: () => readOnlyInterface,
        query: (sql, options) => {
            if (sql !== 'SELECT DATABASE() AS database_name' && (sql !== engineQuery || !tables.has(options?.replacements?.table))) return blocked();
            return db.sequelize.query(sql, options);
        }
    }) });
}

async function diagnose(db, report = emit) {
    db = createReadOnlyDatabase(db);
    report({ event: 'begin', version: 1, mode: 'read-only', apply: false });
    await db.sequelize.authenticate();
    const qi = db.sequelize.getQueryInterface();
    const tables = (await qi.showAllTables()).map(value => typeof value === 'string' ? value : value.tableName || value.table_name);
    for (const name of modelNames) {
        const model = db[name], table = model.getTableName();
        const matches = tables.filter(value => value.toLowerCase() === table.toLowerCase());
        if (matches.length !== 1 || matches[0] !== table) {
            report({ event: 'table', table, status: !matches.length ? 'missing' : 'case_or_mapping_review', matchingTables: matches.length });
            continue;
        }
        const columns = await qi.describeTable(table);
        const indexes = await qi.showIndex(table);
        const fields = Object.entries(model.rawAttributes).map(([key, value]) => value.field || key);
        const missingColumns = fields.filter(field => !columns[field]);
        const indexFields = index => index.fields.map(field => typeof field === 'string' ? field : field.attribute || field.name);
        const expectedIndexes = [...(model.options.indexes || [])];
        for (const [field, attribute] of Object.entries(model.rawAttributes)) {
            // Sequelize uses a shared string for composite uniqueness. That
            // does not require either participant column to be unique alone.
            if (attribute.unique === true) expectedIndexes.push({ fields: [attribute.field || field], unique: true });
        }
        const primaryFields = Object.entries(model.rawAttributes).filter(([, attribute]) => attribute.primaryKey).map(([field, attribute]) => attribute.field || field);
        if (primaryFields.length) expectedIndexes.push({ fields: primaryFields, unique: true });
        const missingIndexes = expectedIndexes.filter(expected => !indexes.some(actual => {
            const wanted = indexFields(expected), found = indexFields(actual);
            return (!expected.unique || actual.unique) && wanted.every((field, index) => found[index] === field) && (!expected.unique || wanted.length === found.length);
        })).map(index => ({ fields: indexFields(index), unique: !!index.unique }));
        const columnTypes = Object.fromEntries(fields.filter(field => columns[field]).map(field => [field, columnType(columns[field].type)]));
        const [metadata] = await db.sequelize.query(engineQuery, { replacements: { table }, type: db.Sequelize.QueryTypes.SELECT });
        report({ event: 'table', table, status: missingColumns.length ? 'missing_columns' : 'present', missingColumns, columnTypes, missingIndexes, transactionalEngine: metadata?.engine === 'InnoDB' });
    }
    try {
        // Empty, fixed arguments are intentional. Never forward CLI arguments,
        // environment flags or --apply to the existing guarded migration runner.
        await require('./repairMessagingStorage').run(db, [], line => {
            const result = JSON.parse(line);
            if (result.mode !== 'check-only') throw new Error('Unexpected diagnostic mode.');
            report({ event: 'migration-dry-run', mode: result.mode, changes: result.changes });
        });
    } catch (error) {
        // The table summaries above identify the missing components. The raw
        // exception can contain SQL/credentials; do not print it or its stack.
        report({ event: 'migration-dry-run', mode: 'check-only', status: 'manual_schema_review_required', code: safeCode(error) });
    }
    report({ event: 'complete', productionWrites: false, note: 'Missing indexes or non-InnoDB tables may require separate review beyond the additive migration.' });
}

async function main() {
    let db;
    try { db = require('../models'); await diagnose(db); }
    catch (error) { emit({ event: 'unavailable', code: safeCode(error), productionWrites: false }); }
    finally {
        try { if (db) await db.sequelize.close(); }
        catch { emit({ event: 'connection_cleanup_failed' }); }
    }
}
if (require.main === module) main();
module.exports = { diagnose, createReadOnlyDatabase };
