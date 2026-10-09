const db = require('./models');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Replicate the EXACT functions from messageController.js
const slugify = (value = "") =>
    String(value)
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .toUpperCase();

const canAccessForum = (user) => {
    if (!user) return false;
    if (user.role === "alumni") return user.account_status === "verified";
    if (user.role === "admin") {
        return ["employer", "alumni"].includes(user.admin_scope || "");
    }
    return false;
};

const canAccessBatch = (user) =>
    user?.role === "alumni" &&
    user?.account_status === "verified" &&
    !!user?.AlumniProfile?.graduation_year &&
    !!user?.AlumniProfile?.course;

const getBatchConversationKey = (user) =>
    `${user.AlumniProfile.graduation_year}_${slugify(user.AlumniProfile.course)}`;

const canAccessCourse = (user) =>
    user?.role === "alumni" &&
    user?.account_status === "verified" &&
    !!user?.AlumniProfile?.course;

const getCourseConversationKey = (course) =>
    `course_${slugify(course)}`;

const getConversationDescriptors = (user) => {
    const descriptors = [];

    if (canAccessForum(user)) {
        descriptors.push({
            key: "forum_global",
            type: "forum",
            name: "Forum",
            subtitle: "Global alumni forum"
        });
    }

    if (canAccessCourse(user)) {
        descriptors.push({
            key: getCourseConversationKey(user.AlumniProfile.course),
            type: "course",
            name: `All ${user.AlumniProfile.course}`,
            subtitle: "Your course community",
            course: user.AlumniProfile.course
        });
    }

    if (canAccessBatch(user)) {
        descriptors.push({
            key: getBatchConversationKey(user),
            type: "batch",
            name: `${user.AlumniProfile.graduation_year} ${user.AlumniProfile.course}`,
            subtitle: "Your batch and course group",
            batch_year: user.AlumniProfile.graduation_year,
            course: user.AlumniProfile.course
        });
    }

    return descriptors;
};

const getUserWithProfiles = (userId) =>
    db.User.findByPk(userId, {
        include: [{ model: db.AlumniProfile }, { model: db.EmployerProfile }]
    });

const ensureConversation = async (descriptor) => {
    const [conversation] = await db.Conversation.findOrCreate({
        where: { conversation_key: descriptor.key },
        defaults: {
            conversation_key: descriptor.key,
            name: descriptor.name,
            type: descriptor.type,
            batch_year: descriptor.batch_year || null,
            course: descriptor.course || null,
            last_message_text: "",
            last_message_at: null
        }
    });

    const updates = {};
    if (conversation.name !== descriptor.name) updates.name = descriptor.name;
    if (conversation.type !== descriptor.type) updates.type = descriptor.type;
    if ((conversation.batch_year || null) !== (descriptor.batch_year || null)) {
        updates.batch_year = descriptor.batch_year || null;
    }
    if ((conversation.course || null) !== (descriptor.course || null)) {
        updates.course = descriptor.course || null;
    }
    if (Object.keys(updates).length) {
        await conversation.update(updates);
    }

    return conversation;
};

const ensureParticipant = async (conversationId, userId) =>
    db.ConversationParticipant.findOrCreate({
        where: {
            conversation_id: conversationId,
            user_id: userId
        },
        defaults: {
            conversation_id: conversationId,
            user_id: userId,
            last_read_at: new Date()
        }
    });

(async () => {
    try {
        await db.sequelize.authenticate();
        console.log('DB connected\n');

        // Test with user 7 (james tehiro - BSIT 2026)
        const userId = 7;
        console.log(`=== FULL E2E TEST: getAccessibleConversations for user ${userId} ===`);
        const user = await getUserWithProfiles(userId);

        console.log('User loaded:', !!user);
        console.log('AlumniProfile loaded:', !!user?.AlumniProfile,
            'course:', user?.AlumniProfile?.course,
            'grad_year:', user?.AlumniProfile?.graduation_year);

        console.log('\n--- Step 1: getConversationDescriptors ---');
        const descriptors = getConversationDescriptors(user);
        console.log(`Descriptors count: ${descriptors.length}`);
        descriptors.forEach(d => console.log(`  type: ${d.type}, key: ${d.key}`));

        console.log('\n--- Step 2: ensureConversation + ensureParticipant for each descriptor ---');
        const conversations = [];
        for (const descriptor of descriptors) {
            console.log(`\n  Processing descriptor: ${descriptor.type} (${descriptor.key})`);
            try {
                const conversation = await ensureConversation(descriptor);
                console.log(`  -> ensureConversation succeeded: id=${conversation.id}`);

                const [participant, created] = await ensureParticipant(conversation.id, userId);
                console.log(`  -> ensureParticipant succeeded: ${created ? 'created' : 'found'}`);

                conversations.push(conversation);
            } catch (err) {
                console.log(`  -> FAILED: ${err.message}`);
                console.log(`  -> Stack: ${err.stack?.split('\n').slice(0, 3).join('\n')}`);
            }
        }

        console.log(`\n--- Step 3: Results ---`);
        console.log(`Ensured conversations count: ${conversations.length}`);
        conversations.forEach(c => console.log(`  type: ${c.type}, key: ${c.conversation_key}, id: ${c.id}`));

        console.log('\n--- Step 4: Verify in database ---');
        const [allConvs] = await db.sequelize.query('SELECT id, conversation_key, type, course, batch_year FROM conversations ORDER BY id');
        console.log('All conversations in DB:');
        allConvs.forEach(c => console.log(`  id=${c.id} key=${c.conversation_key} type=${c.type}`));

        process.exit(0);
    } catch (e) {
        console.error('FATAL ERROR:', e.message);
        console.error(e.stack);
        process.exit(1);
    }
})();