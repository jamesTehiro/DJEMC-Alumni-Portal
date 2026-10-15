module.exports = (sequelize, DataTypes) => {

    return sequelize.define("Job", {

        title: DataTypes.STRING,
        description: DataTypes.TEXT,
        location: DataTypes.STRING,
        employment_type: DataTypes.STRING,
        course_target: DataTypes.STRING,
        expected_salary: DataTypes.STRING,
        posting_details: {
            type: DataTypes.JSON,
            allowNull: true,
            get() {
                const value = this.getDataValue("posting_details");
                // MariaDB JSON storage is LONGTEXT; mysql2 can return its value as text.
                if (typeof value === "string") {
                    try {
                        const parsed = JSON.parse(value);
                        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
                    } catch { return null; }
                }
                return value;
            }
        },
        interview_venue: DataTypes.STRING,
        interview_place: DataTypes.TEXT,
        interview_date: DataTypes.DATEONLY,
        interview_time: DataTypes.STRING,
        interview_contact_info: DataTypes.STRING,
        interview_what_to_bring: DataTypes.TEXT,
        employer_id: DataTypes.INTEGER,
        current_requirement_version: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        has_requirements: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        recruitment_status: {
            type: DataTypes.STRING,
            defaultValue: "active",
            allowNull: false,
            validate: {
                isIn: [["active", "closed"]]
            }
        }

    })

}
