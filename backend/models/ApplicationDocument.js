module.exports = (sequelize, DataTypes) => {
    return sequelize.define("ApplicationDocument", {
        application_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        requirement_code: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        file_path: {
            // Object-storage references contain provider URLs and may exceed 500 characters.
            type: DataTypes.TEXT,
            allowNull: false
        },
        file_name: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        file_size: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        mime_type: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        review_status: {
            type: DataTypes.ENUM("pending_review", "approved", "rejected", "needs_revision"),
            defaultValue: "pending_review"
        },
        review_notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        reviewed_by: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        reviewed_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        original_document_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        version: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1
        }
    }, {
        tableName: "applicationdocuments",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at"
    });
};
