"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            const existing = await queryInterface.sequelize.query(
                "SELECT COUNT(*) as count FROM RequirementLibrary",
                { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
            );

            if (parseInt(existing[0]?.count || 0, 10) > 0) {
                await transaction.commit();
                return;
            }

            const now = new Date();

            const items = [
                // ── Personal Documents (document_upload, file) ──
                { requirement_code: "resume", category: "Personal Documents", label: "Resume / Curriculum Vitae (CV)", requirement_type: "document_upload", value_type: "file", sort_order: 1 },
                { requirement_code: "cover_letter", category: "Personal Documents", label: "Cover Letter", requirement_type: "document_upload", value_type: "file", sort_order: 2 },
                { requirement_code: "recent_id_picture", category: "Personal Documents", label: "Recent ID Picture", requirement_type: "document_upload", value_type: "file", sort_order: 3 },
                { requirement_code: "valid_govt_id", category: "Personal Documents", label: "Valid Government ID", requirement_type: "document_upload", value_type: "file", sort_order: 4 },
                { requirement_code: "psa_birth_certificate", category: "Personal Documents", label: "PSA Birth Certificate", requirement_type: "document_upload", value_type: "file", sort_order: 5 },
                { requirement_code: "marriage_certificate", category: "Personal Documents", label: "Marriage Certificate (if applicable)", requirement_type: "document_upload", value_type: "file", sort_order: 6 },
                { requirement_code: "barangay_clearance", category: "Personal Documents", label: "Barangay Clearance", requirement_type: "document_upload", value_type: "file", sort_order: 7 },
                { requirement_code: "police_clearance", category: "Personal Documents", label: "Police Clearance", requirement_type: "document_upload", value_type: "file", sort_order: 8 },
                { requirement_code: "nbi_clearance", category: "Personal Documents", label: "NBI Clearance", requirement_type: "document_upload", value_type: "file", sort_order: 9 },
                { requirement_code: "passport", category: "Personal Documents", label: "Passport", requirement_type: "document_upload", value_type: "file", sort_order: 10 },
                { requirement_code: "drivers_license", category: "Personal Documents", label: "Driver's License", requirement_type: "document_upload", value_type: "file", sort_order: 11 },

                // ── Educational Documents (document_upload, file) ──
                { requirement_code: "diploma", category: "Educational Documents", label: "Diploma", requirement_type: "document_upload", value_type: "file", sort_order: 1 },
                { requirement_code: "tor", category: "Educational Documents", label: "Transcript of Records (TOR)", requirement_type: "document_upload", value_type: "file", sort_order: 2 },
                { requirement_code: "certificate_of_graduation", category: "Educational Documents", label: "Certificate of Graduation", requirement_type: "document_upload", value_type: "file", sort_order: 3 },
                { requirement_code: "certificate_of_completion", category: "Educational Documents", label: "Certificate of Completion", requirement_type: "document_upload", value_type: "file", sort_order: 4 },
                { requirement_code: "good_moral_certificate", category: "Educational Documents", label: "Good Moral Certificate", requirement_type: "document_upload", value_type: "file", sort_order: 5 },
                { requirement_code: "academic_awards", category: "Educational Documents", label: "Academic Awards / Recognition", requirement_type: "document_upload", value_type: "file", sort_order: 6 },

                // ── Government & Civil Service ──
                { requirement_code: "pds", category: "Government & Civil Service", label: "Personal Data Sheet (PDS)", requirement_type: "document_upload", value_type: "file", sort_order: 1 },
                { requirement_code: "csc_eligibility", category: "Government & Civil Service", label: "CSC Eligibility", requirement_type: "document_upload", value_type: "file", sort_order: 2 },
                { requirement_code: "professional_license", category: "Government & Civil Service", label: "Professional License (e.g., PRC)", requirement_type: "document_upload", value_type: "file", sort_order: 3 },
                { requirement_code: "board_rating", category: "Government & Civil Service", label: "Board Rating", requirement_type: "document_upload", value_type: "file", sort_order: 4 },
                { requirement_code: "board_certificate", category: "Government & Civil Service", label: "Board Certificate", requirement_type: "document_upload", value_type: "file", sort_order: 5 },
                { requirement_code: "sss_number", category: "Government & Civil Service", label: "SSS Number", requirement_type: "information_field", value_type: "text", sort_order: 6 },
                { requirement_code: "philhealth_number", category: "Government & Civil Service", label: "PhilHealth Number", requirement_type: "information_field", value_type: "text", sort_order: 7 },
                { requirement_code: "pagibig_number", category: "Government & Civil Service", label: "Pag-IBIG Number", requirement_type: "information_field", value_type: "text", sort_order: 8 },
                { requirement_code: "tin", category: "Government & Civil Service", label: "Tax Identification Number (TIN)", requirement_type: "information_field", value_type: "text", sort_order: 9 },

                // ── Health Requirements (document_upload, file) ──
                { requirement_code: "medical_certificate", category: "Health Requirements", label: "Medical Certificate", requirement_type: "document_upload", value_type: "file", sort_order: 1 },
                { requirement_code: "drug_test_result", category: "Health Requirements", label: "Drug Test Result", requirement_type: "document_upload", value_type: "file", sort_order: 2 },
                { requirement_code: "psychological_exam", category: "Health Requirements", label: "Psychological Examination Result", requirement_type: "document_upload", value_type: "file", sort_order: 3 },
                { requirement_code: "fit_to_work", category: "Health Requirements", label: "Fit-to-Work Certificate", requirement_type: "document_upload", value_type: "file", sort_order: 4 },
                { requirement_code: "vaccination_record", category: "Health Requirements", label: "Vaccination Record", requirement_type: "document_upload", value_type: "file", sort_order: 5 },

                // ── Supporting Documents (document_upload, file) ──
                { requirement_code: "certificate_of_employment", category: "Supporting Documents", label: "Certificate of Employment", requirement_type: "document_upload", value_type: "file", sort_order: 1 },
                { requirement_code: "recommendation_letter", category: "Supporting Documents", label: "Recommendation Letter", requirement_type: "document_upload", value_type: "file", sort_order: 2 },
                { requirement_code: "character_reference", category: "Supporting Documents", label: "Character Reference", requirement_type: "document_upload", value_type: "file", sort_order: 3 },
                { requirement_code: "internship_certificate", category: "Supporting Documents", label: "Internship / OJT Certificate", requirement_type: "document_upload", value_type: "file", sort_order: 4 },
                { requirement_code: "training_certificate", category: "Supporting Documents", label: "Training Certificates", requirement_type: "document_upload", value_type: "file", sort_order: 5 },
                { requirement_code: "seminar_certificate", category: "Supporting Documents", label: "Seminar / Workshop Certificates", requirement_type: "document_upload", value_type: "file", sort_order: 6 },
                { requirement_code: "professional_certification", category: "Supporting Documents", label: "Professional Certifications", requirement_type: "document_upload", value_type: "file", sort_order: 7 },
                { requirement_code: "portfolio", category: "Supporting Documents", label: "Portfolio", requirement_type: "document_upload", value_type: "file", sort_order: 8 },
                { requirement_code: "work_samples", category: "Supporting Documents", label: "Work Samples", requirement_type: "document_upload", value_type: "file", sort_order: 9 },
                { requirement_code: "research_paper", category: "Supporting Documents", label: "Research Paper", requirement_type: "document_upload", value_type: "file", sort_order: 10 },
                { requirement_code: "thesis_capstone", category: "Supporting Documents", label: "Thesis / Capstone", requirement_type: "document_upload", value_type: "file", sort_order: 11 },
                { requirement_code: "publications", category: "Supporting Documents", label: "Publications", requirement_type: "document_upload", value_type: "file", sort_order: 12 },
                { requirement_code: "awards", category: "Supporting Documents", label: "Awards and Recognitions", requirement_type: "document_upload", value_type: "file", sort_order: 13 },
                { requirement_code: "supporting_documents", category: "Supporting Documents", label: "Supporting Documents", requirement_type: "document_upload", value_type: "file", sort_order: 14 },
                { requirement_code: "additional_attachments", category: "Supporting Documents", label: "Additional Attachments", requirement_type: "document_upload", value_type: "file", sort_order: 15 },

                // ── Application Information (information_field) ──
                { requirement_code: "expected_salary", category: "Application Information", label: "Expected Salary", requirement_type: "information_field", value_type: "number", sort_order: 1 },
                { requirement_code: "availability_date", category: "Application Information", label: "Availability Date", requirement_type: "information_field", value_type: "date", sort_order: 2 },
                { requirement_code: "preferred_work_location", category: "Application Information", label: "Preferred Work Location", requirement_type: "information_field", value_type: "text", sort_order: 3 },
                { requirement_code: "emergency_contact", category: "Application Information", label: "Emergency Contact Information", requirement_type: "information_field", value_type: "textarea", sort_order: 4 },
                { requirement_code: "other_requested_info", category: "Application Information", label: "Other Requested Information", requirement_type: "information_field", value_type: "textarea", sort_order: 5 }
            ];

            const records = items.map((item) => ({
                ...item,
                description: null,
                value_options: null,
                is_active: true,
                created_at: now,
                updated_at: now
            }));

            await queryInterface.bulkInsert("RequirementLibrary", records, { transaction });
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.bulkDelete("RequirementLibrary", null, { transaction });
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};