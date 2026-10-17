"use strict";
const targets = [["employerprofiles", "business_permit_path"]];
async function inspect(qi, Sequelize) {
    return qi.sequelize.query(`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
        DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable,
        CASE WHEN COLUMN_DEFAULT = 'NULL' AND VERSION() LIKE '%MariaDB%'
             THEN NULL ELSE COLUMN_DEFAULT END AS column_default,
        COLUMN_COMMENT AS column_comment, CHARACTER_SET_NAME AS character_set,
        COLLATION_NAME AS collation, EXTRA AS extra, CHARACTER_MAXIMUM_LENGTH AS maximum_length
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
        AND (TABLE_NAME = 'employerprofiles' AND COLUMN_NAME = 'business_permit_path')`,
        { type: Sequelize.QueryTypes.SELECT });
}
module.exports = {
    inspect,
    async up(qi, Sequelize) {
        const columns = await inspect(qi, Sequelize);
        if (!columns.some(c => c.table_name === "employerprofiles" && c.column_name === "business_permit_path")) {
            throw new Error("Expected lowercase employerprofiles.business_permit_path is missing; no tables will be created.");
        }
        const plans = [];
        for (const [table, column] of targets) {
            const c = columns.find(c => c.table_name === table && c.column_name === column);
            if (!c) continue;
            if (["text", "mediumtext", "longtext"].includes(c.data_type.toLowerCase())) continue;
            if (!["varchar", "char"].includes(c.data_type.toLowerCase()) || c.column_default != null || c.extra || Number(c.maximum_length) > 16383) {
                throw new Error(`Unsupported definition for ${table}.${column}; manual review required.`);
            }
            if ((await qi.showIndex(table)).some(index => index.fields.some(field => field.attribute === column))) {
                throw new Error(`Indexed ${table}.${column}; review constraints before widening.`);
            }
            if (![c.character_set, c.collation].every(value => /^[a-zA-Z0-9_]+$/.test(value || ""))) {
                throw new Error("Invalid character set/collation metadata.");
            }
            const quote = value => qi.queryGenerator.quoteIdentifier(value);
            plans.push(`ALTER TABLE ${quote(table)} MODIFY COLUMN ${quote(column)} TEXT CHARACTER SET ${c.character_set} COLLATE ${c.collation} ${c.is_nullable === "YES" ? "NULL DEFAULT NULL" : "NOT NULL"} COMMENT ${qi.sequelize.escape(c.column_comment || "")}`);
        }
        // Preflight every target before DDL; MySQL DDL commits independently.
        for (const sql of plans) await qi.sequelize.query(sql);
        for (const c of await inspect(qi, Sequelize)) {
            if (!["text", "mediumtext", "longtext"].includes(c.data_type.toLowerCase())) throw new Error("Attachment column did not widen.");
        }
    },
    async down() { throw new Error("Refusing to narrow attachment references: long values could be truncated. Retain TEXT on code rollback."); }
};
