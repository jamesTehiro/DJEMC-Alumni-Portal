const TABLE = 'account_deletion_files';
const INDEX = 'account_deletion_files_due';
const fields = ['status', 'next_attempt_at'];
const definitions = {
    id: { type: /^INT(?:\(\d+\))?$/i, nullable: false },
    reference: { type: /^TEXT$/i, nullable: false },
    status: { type: /^VARCHAR\(24\)$/i, nullable: false },
    attempts: { type: /^INT(?:\(\d+\))?$/i, nullable: false },
    next_attempt_at: { type: /^DATETIME$/i, nullable: false },
    last_error: { type: /^VARCHAR\(80\)$/i, nullable: true },
    createdAt: { type: /^DATETIME$/i, nullable: false },
    updatedAt: { type: /^DATETIME$/i, nullable: false }
};
async function inspect(qi) {
    const tables = await qi.showAllTables();
    if (tables.some(name => String(name).toLowerCase() === TABLE && name !== TABLE)) throw new Error('Cleanup table has an incompatible case variant. Review before migration.');
    if (!tables.includes(TABLE)) return { exists: false, ready: false, issues: ['cleanup_table_missing'] };
    const columns = await qi.describeTable(TABLE);
    const issues = [];
    for (const [name, expected] of Object.entries(definitions)) {
        const actual = columns[name];
        if (!actual || !expected.type.test(actual.type) || actual.allowNull !== expected.nullable) issues.push(`incompatible_column:${name}`);
    }
    if (!columns.id?.primaryKey || !columns.id?.autoIncrement) issues.push('incompatible_primary_key');
    if (columns.status?.defaultValue !== 'pending' || Number(columns.attempts?.defaultValue) !== 0 || columns.attempts?.defaultValue == null) issues.push('incompatible_defaults');
    const engines = await qi.sequelize.query('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table', { replacements: { table: TABLE }, type: 'SELECT' });
    if (engines[0]?.engine !== 'InnoDB') issues.push('nontransactional_engine');
    const indexes = await qi.showIndex(TABLE);
    const matches = index => !index.unique && index.fields.length === fields.length && index.fields.every((field, n) => field.attribute === fields[n] && !field.length);
    const named = indexes.find(index => index.name === INDEX);
    if (named && !matches(named)) issues.push('conflicting_due_index');
    const dueIndex = indexes.find(matches);
    if (!dueIndex) issues.push('cleanup_due_index_missing');
    return { exists: true, ready: issues.length === 0, issues, dueIndex: dueIndex?.name || null };
}
module.exports = { TABLE, INDEX, fields, inspect };
