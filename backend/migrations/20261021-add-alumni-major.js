const tables = ["alumnirecords", "alumniprofiles"];

async function inspect(queryInterface) {
    const plan = [];
    // Inspect both actual tables before executing any DDL. A missing table is an error.
    for (const table of tables) {
        const columns = await queryInterface.describeTable(table);
        if (!columns.course) throw new Error(`Expected course column is missing from ${table}.`);
        const major = Object.entries(columns).find(([name]) => name.toLowerCase() === "major")?.[1];
        if (!major) plan.push({ table, column: "major", type: "VARCHAR(255)", allowNull: true });
        else if (!/^(VARCHAR\(255\)|TEXT)$/i.test(major.type) || major.allowNull !== true) {
            throw new Error(`Existing major column in ${table} needs manual review; it will not be changed automatically.`);
        }
    }
    return plan;
}
async function up(queryInterface, Sequelize) {
    const plan = await inspect(queryInterface);
    for (const item of plan) await queryInterface.addColumn(item.table, "major", { type: Sequelize.STRING(255), allowNull: true });
}
// Deliberately no destructive down: dropping major would lose newly recorded data.
module.exports = { inspect, up };
