"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const columns = await queryInterface.describeTable("alumniprofiles");
        if (!columns.proof_document_path) throw new Error("Expected alumniprofiles.proof_document_path is missing.");
        if (!columns.proof_documents) {
            await queryInterface.addColumn("alumniprofiles", "proof_documents", { type: Sequelize.TEXT, allowNull: true, defaultValue: null });
        } else if (!/^(?:TEXT|MEDIUMTEXT|LONGTEXT)$/i.test(columns.proof_documents.type)) {
            throw new Error("Unexpected alumni proof document column type; manual review required.");
        }
    },
    async down() { throw new Error("Refusing to remove alumni proof document references. Preserve the column on rollback."); }
};
