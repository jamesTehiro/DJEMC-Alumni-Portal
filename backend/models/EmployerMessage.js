module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "EmployerMessage",
        {
            conversationId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            senderType: {
                type: DataTypes.ENUM("employer", "admin"),
                allowNull: false
            },
            senderId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            message: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            attachment: {
                type: DataTypes.STRING,
                allowNull: true
            },
            file_name: {
                type: DataTypes.STRING,
                allowNull: true
            },
            file_mime: {
                type: DataTypes.STRING,
                allowNull: true
            },
            file_size: {
                type: DataTypes.INTEGER,
                allowNull: true
            }
        },
        {
            tableName: "employermessages",
            indexes: [
                { fields: ["conversationId", "createdAt"], name: "employer_messages_conversation_id_created_at" },
                { fields: ["senderId"], name: "employer_messages_sender_id" }
            ]
        }
    );
};
