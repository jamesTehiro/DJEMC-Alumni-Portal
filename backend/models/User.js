
module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "User",
        {
            name: DataTypes.STRING,
            email: {
                type: DataTypes.STRING,
                unique: true,
                set(value) {
                    this.setDataValue("email", typeof value === "string" ? value.trim().toLowerCase() : value);
                }
            },
            password: DataTypes.STRING,
            email_verified_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
            role: DataTypes.STRING,
            admin_scope: DataTypes.STRING,
            admin_department: DataTypes.STRING,
            admin_avatar_url: DataTypes.TEXT("long"),
            account_status: {
                type: DataTypes.STRING,
                defaultValue: "pending"
            },
            alumni_record_id: {
                type: DataTypes.INTEGER,
                allowNull: true
            }
        },
        {
            tableName: "users",
            indexes: [
                { unique: true, fields: ["email"] },
                { unique: true, fields: ["role", "admin_scope"] }
            ]
        }
    );
};
