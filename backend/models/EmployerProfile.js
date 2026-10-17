
module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "EmployerProfile",
        {
            user_id: DataTypes.INTEGER,
            organization_name: DataTypes.STRING,
            industry: DataTypes.STRING,
            website_url: DataTypes.STRING,
            business_permit_path: DataTypes.TEXT,
            business_permit_documents: DataTypes.TEXT,
            address: DataTypes.STRING,
            contact_email: DataTypes.STRING,
            logo_url: DataTypes.TEXT("long"),
            verified: DataTypes.BOOLEAN
        },
        {
            tableName: "employerprofiles",
            // Permit references must only be explicitly loaded for authorized
            // verification/document operations, never general profile responses.
            defaultScope: { attributes: { exclude: ["business_permit_documents"] } }
        }
    );
};
