"use strict";

const COLUMNS = {
    organization_type: { type: "STRING(32)", allowNull: true },
    government_agency_details: { type: "TEXT", allowNull: true },
    government_agency_documents: { type: "TEXT", allowNull: true }
};

async function inspect(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("employerprofiles");
    return Object.fromEntries(Object.keys(COLUMNS).map(name => [name, Object.hasOwn(table, name)]));
}

async function up(queryInterface, Sequelize) {
    const present = await inspect(queryInterface, Sequelize);
    for (const [name, definition] of Object.entries(COLUMNS)) {
        if (!present[name]) {
            const [type, length] = definition.type.match(/^([A-Z]+)(?:\((\d+)\))?$/).slice(1);
            await queryInterface.addColumn("employerprofiles", name, {
                type: length ? Sequelize[type](Number(length)) : Sequelize[type],
                allowNull: definition.allowNull
            });
        }
    }
}

async function down() {
    throw new Error("Refusing to remove government agency registration details and private document references. Preserve the additive columns on code rollback.");
}

module.exports = { up, down, inspect };
