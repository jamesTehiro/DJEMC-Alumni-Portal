const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./models');

(async () => {
    try {
        await db.sequelize.authenticate();
        const [msgs] = await db.sequelize.query(
            'SELECT m.id, m.conversation_id, m.message_text, m.sender_id, u.name as sender_name, m.createdAt, c.conversation_key ' +
            'FROM messages m ' +
            'JOIN users u ON u.id = m.sender_id ' +
            'JOIN conversations c ON c.id = m.conversation_id ' +
            'ORDER BY m.id'
        );
        console.log('All messages:');
        msgs.forEach(m => console.log(JSON.stringify(m)));

        console.log('\nMessages for course_BSIT (conv 13):');
        const courseMsgs = msgs.filter(m => m.conversation_id === 13);
        courseMsgs.forEach(m => console.log(JSON.stringify(m)));

        console.log('\nMessages for 2026_BSIT batch (conv 2):');
        const batchMsgs = msgs.filter(m => m.conversation_id === 2);
        batchMsgs.forEach(m => console.log(JSON.stringify(m)));

        // Check participants for course_BSIT
        const [courseParts] = await db.sequelize.query(
            'SELECT cp.*, u.name FROM conversationparticipants cp JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = 13'
        );
        console.log('\nParticipants for course_BSIT:');
        courseParts.forEach(p => console.log(JSON.stringify(p)));

        // Check participants for 2026_BSIT batch (id=2)
        const [batchParts] = await db.sequelize.query(
            'SELECT cp.*, u.name FROM conversationparticipants cp JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = 2'
        );
        console.log('\nParticipants for 2026_BSIT batch:');
        batchParts.forEach(p => console.log(JSON.stringify(p)));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();