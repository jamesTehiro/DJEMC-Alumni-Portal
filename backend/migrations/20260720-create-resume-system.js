"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            // Main Resumes table
            if (!(await hasTable(queryInterface, "Resumes"))) {
                await queryInterface.createTable(
                    "Resumes",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        user_id: { type: Sequelize.INTEGER, allowNull: false },
                        title: { type: Sequelize.STRING(255), defaultValue: "My Resume" },
                        template_id: { type: Sequelize.STRING(100), defaultValue: "modern-professional" },
                        font_family: { type: Sequelize.STRING(100), defaultValue: "Inter, sans-serif" },
                        font_size: { type: Sequelize.INTEGER, defaultValue: 11 },
                        line_spacing: { type: Sequelize.FLOAT, defaultValue: 1.5 },
                        color_theme: { type: Sequelize.STRING(100), defaultValue: "#155a43" },
                        settings: { type: Sequelize.JSON, defaultValue: {} },
                        is_default: { type: Sequelize.BOOLEAN, defaultValue: false },
                        is_archived: { type: Sequelize.BOOLEAN, defaultValue: false },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("Resumes", ["user_id"], { transaction });
                await queryInterface.addIndex("Resumes", ["user_id", "is_archived"], { transaction });
            }

            // Resume Personal Information
            if (!(await hasTable(queryInterface, "ResumePersonalInfo"))) {
                await queryInterface.createTable(
                    "ResumePersonalInfo",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        full_name: { type: Sequelize.STRING(255), allowNull: true },
                        professional_title: { type: Sequelize.STRING(255), allowNull: true },
                        email: { type: Sequelize.STRING(255), allowNull: true },
                        phone: { type: Sequelize.STRING(50), allowNull: true },
                        address: { type: Sequelize.TEXT, allowNull: true },
                        linkedin: { type: Sequelize.STRING(500), allowNull: true },
                        github: { type: Sequelize.STRING(500), allowNull: true },
                        portfolio: { type: Sequelize.STRING(500), allowNull: true },
                        website: { type: Sequelize.STRING(500), allowNull: true },
                        photo_url: { type: Sequelize.TEXT, allowNull: true },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumePersonalInfo", ["resume_id"], { unique: true, transaction });
            }

            // Resume Summary
            if (!(await hasTable(queryInterface, "ResumeSummaries"))) {
                await queryInterface.createTable(
                    "ResumeSummaries",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        content: { type: Sequelize.TEXT, allowNull: true },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeSummaries", ["resume_id"], { unique: true, transaction });
            }

            // Resume Education
            if (!(await hasTable(queryInterface, "ResumeEducation"))) {
                await queryInterface.createTable(
                    "ResumeEducation",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        institution: { type: Sequelize.STRING(255), allowNull: true },
                        degree: { type: Sequelize.STRING(255), allowNull: true },
                        field_of_study: { type: Sequelize.STRING(255), allowNull: true },
                        start_date: { type: Sequelize.DATE, allowNull: true },
                        end_date: { type: Sequelize.DATE, allowNull: true },
                        is_current: { type: Sequelize.BOOLEAN, defaultValue: false },
                        gpa: { type: Sequelize.STRING(20), allowNull: true },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeEducation", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeEducation", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Work Experience
            if (!(await hasTable(queryInterface, "ResumeWorkExperience"))) {
                await queryInterface.createTable(
                    "ResumeWorkExperience",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        job_title: { type: Sequelize.STRING(255), allowNull: true },
                        company: { type: Sequelize.STRING(255), allowNull: true },
                        location: { type: Sequelize.STRING(255), allowNull: true },
                        start_date: { type: Sequelize.DATE, allowNull: true },
                        end_date: { type: Sequelize.DATE, allowNull: true },
                        is_current: { type: Sequelize.BOOLEAN, defaultValue: false },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeWorkExperience", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeWorkExperience", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Skills
            if (!(await hasTable(queryInterface, "ResumeSkills"))) {
                await queryInterface.createTable(
                    "ResumeSkills",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        category: { type: Sequelize.STRING(100), allowNull: true },
                        skill_name: { type: Sequelize.STRING(255), allowNull: false },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeSkills", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeSkills", ["resume_id", "category"], { transaction });
            }

            // Resume Projects
            if (!(await hasTable(queryInterface, "ResumeProjects"))) {
                await queryInterface.createTable(
                    "ResumeProjects",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        project_name: { type: Sequelize.STRING(255), allowNull: true },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        technologies: { type: Sequelize.TEXT, allowNull: true },
                        url: { type: Sequelize.STRING(500), allowNull: true },
                        start_date: { type: Sequelize.DATE, allowNull: true },
                        end_date: { type: Sequelize.DATE, allowNull: true },
                        is_current: { type: Sequelize.BOOLEAN, defaultValue: false },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeProjects", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeProjects", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Certifications
            if (!(await hasTable(queryInterface, "ResumeCertifications"))) {
                await queryInterface.createTable(
                    "ResumeCertifications",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        name: { type: Sequelize.STRING(255), allowNull: true },
                        issuer: { type: Sequelize.STRING(255), allowNull: true },
                        issue_date: { type: Sequelize.DATE, allowNull: true },
                        expiry_date: { type: Sequelize.DATE, allowNull: true },
                        credential_id: { type: Sequelize.STRING(255), allowNull: true },
                        url: { type: Sequelize.STRING(500), allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeCertifications", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeCertifications", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Trainings
            if (!(await hasTable(queryInterface, "ResumeTrainings"))) {
                await queryInterface.createTable(
                    "ResumeTrainings",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        training_name: { type: Sequelize.STRING(255), allowNull: true },
                        provider: { type: Sequelize.STRING(255), allowNull: true },
                        completion_date: { type: Sequelize.DATE, allowNull: true },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeTrainings", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeTrainings", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Seminars
            if (!(await hasTable(queryInterface, "ResumeSeminars"))) {
                await queryInterface.createTable(
                    "ResumeSeminars",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        seminar_name: { type: Sequelize.STRING(255), allowNull: true },
                        organizer: { type: Sequelize.STRING(255), allowNull: true },
                        date: { type: Sequelize.DATE, allowNull: true },
                        location: { type: Sequelize.STRING(255), allowNull: true },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeSeminars", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeSeminars", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Awards
            if (!(await hasTable(queryInterface, "ResumeAwards"))) {
                await queryInterface.createTable(
                    "ResumeAwards",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        title: { type: Sequelize.STRING(255), allowNull: true },
                        issuer: { type: Sequelize.STRING(255), allowNull: true },
                        date: { type: Sequelize.DATE, allowNull: true },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeAwards", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeAwards", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Organizations
            if (!(await hasTable(queryInterface, "ResumeOrganizations"))) {
                await queryInterface.createTable(
                    "ResumeOrganizations",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        organization_name: { type: Sequelize.STRING(255), allowNull: true },
                        position: { type: Sequelize.STRING(255), allowNull: true },
                        start_date: { type: Sequelize.DATE, allowNull: true },
                        end_date: { type: Sequelize.DATE, allowNull: true },
                        is_current: { type: Sequelize.BOOLEAN, defaultValue: false },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeOrganizations", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeOrganizations", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Volunteer Experience
            if (!(await hasTable(queryInterface, "ResumeVolunteerWork"))) {
                await queryInterface.createTable(
                    "ResumeVolunteerWork",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        organization: { type: Sequelize.STRING(255), allowNull: true },
                        role: { type: Sequelize.STRING(255), allowNull: true },
                        start_date: { type: Sequelize.DATE, allowNull: true },
                        end_date: { type: Sequelize.DATE, allowNull: true },
                        is_current: { type: Sequelize.BOOLEAN, defaultValue: false },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeVolunteerWork", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeVolunteerWork", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Languages
            if (!(await hasTable(queryInterface, "ResumeLanguages"))) {
                await queryInterface.createTable(
                    "ResumeLanguages",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        language: { type: Sequelize.STRING(100), allowNull: true },
                        proficiency: { type: Sequelize.STRING(100), allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeLanguages", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeLanguages", ["resume_id", "sort_order"], { transaction });
            }

            // Resume References
            if (!(await hasTable(queryInterface, "ResumeReferences"))) {
                await queryInterface.createTable(
                    "ResumeReferences",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        name: { type: Sequelize.STRING(255), allowNull: true },
                        relationship: { type: Sequelize.STRING(255), allowNull: true },
                        company: { type: Sequelize.STRING(255), allowNull: true },
                        email: { type: Sequelize.STRING(255), allowNull: true },
                        phone: { type: Sequelize.STRING(50), allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeReferences", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeReferences", ["resume_id", "sort_order"], { transaction });
            }

            // Resume Versions for version history
            if (!(await hasTable(queryInterface, "ResumeVersions"))) {
                await queryInterface.createTable(
                    "ResumeVersions",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        resume_id: { type: Sequelize.INTEGER, allowNull: false },
                        version_number: { type: Sequelize.INTEGER, allowNull: false },
                        snapshot_data: { type: Sequelize.JSON, allowNull: true },
                        change_summary: { type: Sequelize.TEXT, allowNull: true },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ResumeVersions", ["resume_id"], { transaction });
                await queryInterface.addIndex("ResumeVersions", ["resume_id", "version_number"], { unique: true, transaction });
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            console.error("Resume migration error:", err);
            throw err;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            const tables = [
                "Resumes",
                "ResumePersonalInfo",
                "ResumeSummaries",
                "ResumeEducation",
                "ResumeWorkExperience",
                "ResumeSkills",
                "ResumeProjects",
                "ResumeCertifications",
                "ResumeTrainings",
                "ResumeSeminars",
                "ResumeAwards",
                "ResumeOrganizations",
                "ResumeVolunteerWork",
                "ResumeLanguages",
                "ResumeReferences",
                "ResumeVersions"
            ];

            for (const table of tables) {
                if (await hasTable(queryInterface, table)) {
                    await queryInterface.dropTable(table, { transaction });
                }
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};