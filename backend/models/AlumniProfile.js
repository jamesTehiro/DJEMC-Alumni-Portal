
module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "AlumniProfile",
        {
            user_id: DataTypes.INTEGER,
            course: DataTypes.STRING,
            major: { type: DataTypes.STRING(255), allowNull: true },
            graduation_year: DataTypes.INTEGER,
            phone: DataTypes.STRING,
            address: DataTypes.STRING,
            profile_visibility: DataTypes.STRING,
            avatar_url: DataTypes.TEXT,
            proof_document_path: DataTypes.TEXT,
            proof_documents: DataTypes.TEXT,
            employment_status: DataTypes.STRING(30),
            current_company: DataTypes.STRING,
            job_title: DataTypes.STRING
        },
        {
            tableName: "alumniprofiles",
            defaultScope: { attributes: { exclude: ["proof_documents"] } }
        }
    );
};
