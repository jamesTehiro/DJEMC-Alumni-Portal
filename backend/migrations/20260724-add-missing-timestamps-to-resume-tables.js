'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            const tablesToFix = [
                'ResumePersonalInfo',
                'ResumeSummaries',
                'ResumeEducation',
                'ResumeWorkExperience',
                'ResumeSkills',
                'ResumeProjects',
                'ResumeCertifications',
                'ResumeTrainings',
                'ResumeSeminars',
                'ResumeAwards',
                'ResumeOrganizations',
                'ResumeVolunteerWork',
                'ResumeLanguages',
                'ResumeReferences',
                'ResumeVersions'
            ];

            const existingTables = await queryInterface.showAllTables({ transaction });
            const existingLower = existingTables.map(t => t.toLowerCase());

            for (const tableName of tablesToFix) {
                if (!existingLower.includes(tableName.toLowerCase())) {
                    continue;
                }

                const columns = await queryInterface.describeTable(tableName, { transaction });

                if (!columns.created_at) {
                    await queryInterface.addColumn(tableName, 'created_at', {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                    }, { transaction });
                }

                if (!columns.updated_at) {
                    await queryInterface.addColumn(tableName, 'updated_at', {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                    }, { transaction });
                }
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            console.error("Migration error:", err);
            throw err;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            const tablesToFix = [
                'ResumePersonalInfo',
                'ResumeSummaries',
                'ResumeEducation',
                'ResumeWorkExperience',
                'ResumeSkills',
                'ResumeProjects',
                'ResumeCertifications',
                'ResumeTrainings',
                'ResumeSeminars',
                'ResumeAwards',
                'ResumeOrganizations',
                'ResumeVolunteerWork',
                'ResumeLanguages',
                'ResumeReferences',
                'ResumeVersions'
            ];

            const existingTables = await queryInterface.showAllTables({ transaction });
            const existingLower = existingTables.map(t => t.toLowerCase());

            for (const tableName of tablesToFix) {
                if (!existingLower.includes(tableName.toLowerCase())) {
                    continue;
                }

                const columns = await queryInterface.describeTable(tableName, { transaction });

                if (columns.updated_at) {
                    await queryInterface.removeColumn(tableName, 'updated_at', { transaction });
                }
                if (columns.created_at) {
                    await queryInterface.removeColumn(tableName, 'created_at', { transaction });
                }
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            console.error("Migration down error:", err);
            throw err;
        }
    }
};