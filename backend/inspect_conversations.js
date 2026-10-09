const { sequelize } = require('./models');

(async () => {
    try {
        await sequelize.authenticate();
        console.log('DB connected successfully');

        console.log('\n=== ALL USERS (with alumniprofiles - correct table name) ===');
        const [users] = await sequelize.query(
            'SELECT u.id, u.name, u.role, u.account_status, ap.course, ap.graduation_year ' +
            'FROM users u LEFT JOIN alumniprofiles ap ON ap.user_id = u.id ' +
            'ORDER BY u.id'
        );
        users.forEach(u => console.log(JSON.stringify(u)));

        console.log('\n=== ALL CONVERSATIONS ===');
        const [convs] = await sequelize.query('SELECT * FROM conversations');
        convs.forEach(c => console.log(JSON.stringify(c)));

        console.log('\n=== ALL CONVERSATION PARTICIPANTS ===');
        const [parts] = await sequelize.query(
            'SELECT cp.conversation_id, cp.user_id, c.type, c.conversation_key ' +
            'FROM conversationparticipants cp ' +
            'JOIN conversations c ON c.id = cp.conversation_id'
        );
        parts.forEach(p => console.log(JSON.stringify(p)));

        // Now simulate the exact logic from getAccessibleConversations
        console.log('\n\n=== SIMULATING getAccessibleConversations for each verified alumni user ===');
        const alumniUsers = users.filter(u => u.role === 'alumni' && u.account_status === 'verified');

        for (const user of alumniUsers) {
            console.log(`\n--- User ${user.id} (${user.name}) course="${user.course}" batch=${user.graduation_year} ---`);

            const courseAccess = user.role === 'alumni' && user.account_status === 'verified' && !!user.course;
            const batchAccess = user.role === 'alumni' && user.account_status === 'verified' && !!user.graduation_year && !!user.course;

            console.log(`  canAccessCourse: ${courseAccess} (checks: role=alumni=${user.role === 'alumni'}, verified=${user.account_status === 'verified'}, !!course=${!!user.course})`);
            console.log(`  canAccessBatch: ${batchAccess} (checks: role=alumni=${user.role === 'alumni'}, verified=${user.account_status === 'verified'}, !!grad_year=${!!user.graduation_year}, !!course=${!!user.course})`);

            if (courseAccess) {
                const courseKey = `course_${String(user.course).trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toUpperCase()}`;
                console.log(`  Would create course conversation with key: "${courseKey}"`);

                // Check if conversation exists
                const [existingCourse] = await sequelize.query(
                    `SELECT id FROM conversations WHERE conversation_key = '${courseKey}'`
                );
                console.log(`  Course conversation exists: ${existingCourse.length > 0} (id: ${existingCourse[0]?.id || 'N/A'})`);
            }

            if (batchAccess) {
                const batchKey = `${user.graduation_year}_${String(user.course).trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toUpperCase()}`;
                console.log(`  Would create batch conversation with key: "${batchKey}"`);

                const [existingBatch] = await sequelize.query(
                    `SELECT id FROM conversations WHERE conversation_key = '${batchKey}'`
                );
                console.log(`  Batch conversation exists: ${existingBatch.length > 0} (id: ${existingBatch[0]?.id || 'N/A'})`);
            }
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();