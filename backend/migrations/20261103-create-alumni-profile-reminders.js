const TABLE = "alumni_profile_reminders";

async function inspect(qi) {
    const parents = await qi.sequelize.query("SELECT TABLE_NAME AS table_name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users', 'notifications')", { type: require("sequelize").QueryTypes.SELECT });
    if (!["users", "notifications"].every(name => parents.some(row => row.table_name === name && row.engine === "InnoDB"))) throw new Error("Reminder owners and notifications require existing InnoDB tables.");
    const tables = await qi.showAllTables();
    if (!tables.some(table => (typeof table === "string" ? table : table.tableName) === TABLE)) return [{ action: "create", table: TABLE }];
    const columns = await qi.describeTable(TABLE);
    for (const name of ["user_id", "next_reminder_at", "last_reminded_at", "last_profile_updated_at"]) {
        const field = columns[name];
        if (!field || (name === "user_id" ? !/^INT(?:EGER)?(?:\(\d+\))?$/i.test(field.type) || !field.primaryKey : !/^DATETIME(?:\(3\))?$/i.test(field.type))
            || field.allowNull !== ["last_reminded_at", "last_profile_updated_at"].includes(name)) throw new Error(`Review incompatible reminder column: ${name}.`);
    }
    const fks = await qi.getForeignKeyReferencesForTable(TABLE);
    const indexes = await qi.showIndex(TABLE);
    if (!indexes.some(index => index.primary && index.fields.length === 1 && index.fields[0].attribute === "user_id")) throw new Error("Reminder clock requires a single-column user_id primary key.");
    if (!fks.some(fk => fk.columnName === "user_id" && fk.referencedTableName === "users" && fk.referencedColumnName === "id")) throw new Error("Reminder owner foreign key is missing.");
    const [table] = await qi.sequelize.query("SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table", {
        replacements: { table: TABLE }, type: require("sequelize").QueryTypes.SELECT
    });
    const [constraint] = await qi.sequelize.query("SELECT DELETE_RULE AS delete_rule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = :table AND REFERENCED_TABLE_NAME = 'users'", {
        replacements: { table: TABLE }, type: require("sequelize").QueryTypes.SELECT
    });
    if (table?.engine !== "InnoDB" || constraint?.delete_rule !== "CASCADE") throw new Error("Reminder table requires InnoDB and owner ON DELETE CASCADE.");
    return [];
}

async function up(qi, Sequelize) {
    if (!(await inspect(qi)).length) return;
    await qi.createTable(TABLE, {
        user_id: { type: Sequelize.INTEGER, primaryKey: true, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
        next_reminder_at: { type: Sequelize.DATE(3), allowNull: false },
        last_reminded_at: { type: Sequelize.DATE(3), allowNull: true },
        last_profile_updated_at: { type: Sequelize.DATE(3), allowNull: true }
    }, { engine: "InnoDB" });
    await inspect(qi);
}
// Retain the schedule on rollback: dropping it could cause repeat reminders.
module.exports = { TABLE, inspect, up };
