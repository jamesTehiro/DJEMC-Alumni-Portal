"use strict";
const legacy = require("./20261017-expand-employer-permit-reference");
const table = "employerprofiles";
const column = "business_permit_documents";
const inspect = async (qi, Sequelize) => ({ legacy: await legacy.inspect(qi, Sequelize), documents: (await qi.describeTable(table))[column] || null });
module.exports = {
    inspect,
    async up(qi, Sequelize) {
        const columns = await qi.describeTable(table);
        if (!columns.business_permit_path) throw new Error("Expected employerprofiles.business_permit_path is missing.");
        if (columns[column] && !/^(?:TEXT|MEDIUMTEXT|LONGTEXT)$/i.test(columns[column].type)) throw new Error("Unexpected permit document column type; manual review required.");
        await legacy.up(qi, Sequelize);
        if (!columns[column]) await qi.addColumn(table, column, { type: Sequelize.TEXT, allowNull: true, defaultValue: null });
        const verified = await qi.describeTable(table);
        if (!/^(?:TEXT|MEDIUMTEXT|LONGTEXT)$/i.test(verified[column]?.type || "")) throw new Error("Permit document column was not created.");
    },
    async down() { throw new Error("Refusing to remove permit document references. Preserve the columns on rollback."); }
};
