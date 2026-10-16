module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "ConversationParticipant",
        {
            conversation_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            unread_count: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            last_read_at: {
                type: DataTypes.DATE,
                allowNull: true
            }
        },
        {
            tableName: "conversationparticipants",
            indexes: [
                { unique: true, fields: ["conversation_id", "user_id"], name: "conversation_participants_conversation_id_user_id" },
                { fields: ["user_id"], name: "conversation_participants_user_id" },
                { fields: ["conversation_id"], name: "conversation_participants_conversation_id" }
            ]
        }
    );
};
