const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./models");

const run = async () => {
    await db.sequelize.authenticate();
    console.log("\n=== COURSE CHAT VERIFICATION REPORT ===\n");

    // Find all course conversations
    const courseConversations = await db.Conversation.findAll({
        where: { type: "course" },
        order: [["id", "ASC"]]
    });

    console.log(`Total course conversations found: ${courseConversations.length}`);

    for (const convo of courseConversations) {
        console.log(`\n--- Course Conversation ---`);
        console.log(`  ID:            ${convo.id}`);
        console.log(`  conversation_key: ${convo.conversation_key}`);
        console.log(`  name:          ${convo.name}`);
        console.log(`  type:          ${convo.type}`);
        console.log(`  course:        ${convo.course}`);

        // Get all participants for this conversation
        const participants = await db.ConversationParticipant.findAll({
            where: { conversation_id: convo.id },
            include: [{
                model: db.User,
                include: [{ model: db.AlumniProfile }]
            }]
        });

        console.log(`  Total participants: ${participants.length}`);

        // Get all alumni with the same course
        const alumniWithCourse = await db.User.findAll({
            where: {
                role: "alumni",
                account_status: "verified"
            },
            include: [{
                model: db.AlumniProfile,
                where: { course: convo.course },
                attributes: ["course"]
            }],
            attributes: ["id", "name", "email", "account_status"]
        });

        console.log(`  Total alumni with course "${convo.course}": ${alumniWithCourse.length}`);

        // Check for mismatches
        const participantUserIds = new Set(participants.map(p => p.user_id));
        const alumniUserIds = alumniWithCourse.map(a => a.id);

        console.log(`  Participant user IDs: ${Array.from(participantUserIds).sort((a, b) => a - b).join(", ")}`);
        console.log(`  Alumni user IDs:      ${alumniUserIds.sort((a, b) => a - b).join(", ")}`);

        const missingParticipants = alumniUserIds.filter(id => !participantUserIds.has(id));
        const extraParticipants = Array.from(participantUserIds).filter(id => !alumniUserIds.includes(id));

        if (missingParticipants.length > 0) {
            console.log(`  ⚠️  MISSING PARTICIPANTS (alumni with course but not in conversation): ${missingParticipants.join(", ")}`);
        } else {
            console.log(`  ✅ All alumni with course "${convo.course}" are participants`);
        }

        if (extraParticipants.length > 0) {
            console.log(`  ℹ️  Extra participants (not matching course criteria): ${extraParticipants.join(", ")}`);
        }

        // Check conversation_key consistency
        const expectedKey = `course_${convo.course.toString().trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toUpperCase()}`;
        if (convo.conversation_key !== expectedKey) {
            console.log(`  ⚠️  conversation_key mismatch! Expected: ${expectedKey}, Got: ${convo.conversation_key}`);
        } else {
            console.log(`  ✅ conversation_key is consistent: ${convo.conversation_key}`);
        }
    }

    // Check for duplicate course conversations for the same course
    console.log(`\n=== DUPLICATE CHECK ===`);
    for (const convo of courseConversations) {
        const duplicates = courseConversations.filter(c => c.course === convo.course && c.id !== convo.id);
        if (duplicates.length > 0) {
            console.log(`  ⚠️  Duplicate conversations for course "${convo.course}": IDs ${convo.id} and ${duplicates.map(d => d.id).join(", ")}`);
        }
    }

    if (courseConversations.length > 0 && courseConversations.every(c => {
        const dups = courseConversations.filter(cc => cc.course === c.course && cc.id !== c.id);
        return dups.length === 0;
    })) {
        console.log(`  ✅ No duplicate course conversations found`);
    }

    // Summary
    console.log(`\n=== SUMMARY ===`);
    const allMissing = [];
    for (const convo of courseConversations) {
        const participants = await db.ConversationParticipant.findAll({
            where: { conversation_id: convo.id },
            include: [{ model: db.AlumniProfile }]
        });
        const participantUserIds = new Set(participants.map(p => p.user_id));

        const alumniWithCourse = await db.User.findAll({
            where: { role: "alumni", account_status: "verified" },
            include: [{
                model: db.AlumniProfile,
                where: { course: convo.course },
                attributes: []
            }],
            attributes: ["id"]
        });

        const missing = alumniWithCourse.filter(a => !participantUserIds.has(a.id));
        if (missing.length > 0) {
            allMissing.push({ course: convo.course, conversationId: convo.id, missingUsers: missing.map(m => m.id) });
        }
    }

    if (allMissing.length > 0) {
        console.log(`\n  ❌ ISSUES FOUND:`);
        allMissing.forEach(issue => {
            console.log(`    - Course "${issue.course}" (conversation ${issue.conversationId}): missing users ${issue.missingUsers.join(", ")}`);
        });
        console.log(`\n  RECOMMENDATION: The issue is that ConversationParticipant records are missing.`);
        console.log(`  The server needs to sync participants when sending a message.`);
    } else {
        console.log(`\n  ✅ All course conversations have correct participants!`);
    }

    await db.sequelize.close();
    console.log("\n=== END OF REPORT ===\n");
    process.exit(allMissing.length > 0 ? 1 : 0);
};

run().catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
});