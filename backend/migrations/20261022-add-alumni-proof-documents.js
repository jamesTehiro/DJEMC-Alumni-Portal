"use strict";

const TABLE = "alumniprofiles";

async function readSchema(queryInterface) {
    const columns = await queryInterface.describeTable(TABLE);
    if (!columns.proof_document_path) throw new Error("Expected alumniprofiles.proof_document_path is missing.");
    const pick = column => column ? { type: column.type, allowNull: column.allowNull, defaultValue: column.defaultValue ?? null } : null;
    return { table: TABLE, proof_document_path: pick(columns.proof_document_path), proof_documents: pick(columns.proof_documents) };
}

async function inspect(queryInterface) {
    const schema = await readSchema(queryInterface);
    if (!schema.proof_documents) return [{ table: TABLE, column: "proof_documents", type: "TEXT", allowNull: true, defaultValue: null }];
    if (!/^(?:TEXT|MEDIUMTEXT|LONGTEXT)$/i.test(schema.proof_documents.type)) {
        throw new Error("Unexpected alumni proof document column type; manual review required.");
    }
    return [];
}

module.exports = {
    async up(queryInterface, Sequelize) {
        const changes = await inspect(queryInterface);
        if (changes.length) {
            await queryInterface.addColumn(TABLE, "proof_documents", {
                type: Sequelize.TEXT,
                allowNull: true,
                defaultValue: null
            });
        }
    },
    inspect,
    readSchema,
    async down() { throw new Error("Refusing to remove alumni proof document references. Preserve the column on rollback."); }
};
