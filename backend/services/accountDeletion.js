const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const POLICY = 'retain-memberships-v1';
const resumeChildren = ['ResumePersonalInfo', 'ResumeSummary', 'ResumeEducation', 'ResumeWorkExperience',
    'ResumeSkill', 'ResumeProject', 'ResumeCertification', 'ResumeTraining', 'ResumeSeminar', 'ResumeAward',
    'ResumeOrganization', 'ResumeVolunteerWork', 'ResumeLanguage', 'ResumeReference', 'ResumeVersion'];
// Each reference is handled explicitly before deleting its original user.
const retainedReferences = [
    ['Message', 'sender_id'], ['EmployerMessage', 'senderId'], ['Post', 'user_id'], ['Comment', 'user_id'],
    ['AuditLog', 'actor_id'], ['Conversation', 'user1Id'], ['Conversation', 'user2Id'],
    ['EmployerConversation', 'employerId'], ['EmployerConversation', 'adminId'],
    ['MembershipApplication', 'alumni_user_id'], ['Announcement', 'admin_id'],
    ['ApplicationDocument', 'reviewed_by'], ['ApplicationResponse', 'reviewed_by'],
    ['AlumniProfileUpdateRequest', 'requested_by'], ['MembershipAdministrator', 'granted_by']
];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const table = Model => Model.getTableName();

function createAccountDeletion({ db, env = process.env }) {
    const { Op } = db.Sequelize;
    const inIds = rows => ({ [Op.in]: rows.map(row => row.id) });
    const approved = () => env.ACCOUNT_DELETION_POLICY === POLICY;
    const authorize = (actor, role, id) => {
        if (!actor) fail(401, 'Authentication required.');
        if (!['alumni', 'employer'].includes(role) || actor.role !== 'admin' || (actor.admin_scope || 'alumni') !== role) fail(403, 'Admin scope access denied.');
        if (!Number.isSafeInteger(id) || id < 1) fail(400, 'Invalid account ID.');
        if (Number(actor.id) === id) fail(403, 'You cannot delete your own account.');
    };
    const secret = () => {
        if (!env.JWT_SECRET) fail(503, 'Deletion confirmation is not configured.');
        return env.JWT_SECRET;
    };

    // Check actual incoming FKs, including unmodeled tables that might cascade.
    // The reviewed inventory is an allowlist, never an instruction to cascade.
    async function verifySchema(transaction) {
        const reviewed = require('../docs/account-deletion-schema.json').foreignKeys;
        const allowed = new Set(reviewed.map(f => `${f.table_name}.${f.column_name}>${f.referenced_table}.${f.referenced_column}`));
        // Some installations additionally enforce the modeled notification owner FK.
        allowed.add('notifications.userId>users.id');
        allowed.add('message_send_requests.sender_id>users.id');
        // Private reminder clocks cascade with their owner; no shared records.
        allowed.add('alumni_profile_reminders.user_id>users.id');
        const deleting = ['User', 'Application', 'ApplicationDocument', 'ApplicationResponse', 'Interview', 'Job',
            'JobRequirement', 'RequirementGroup', 'JobRequirementSnapshot', 'Resume', ...resumeChildren,
            'AlumniProfile', 'EmployerProfile', 'EmploymentHistory', 'Notification', 'PasswordResetToken',
            'AlumniProfileUpdateRequest', 'RegistrationEmailVerification', 'MessageSendRequest', 'ConversationParticipant', 'MembershipAdministrator'];
        const parents = new Set(deleting.map(name => table(db[name])));
        const fks = await db.sequelize.query(`SELECT DISTINCT TABLE_NAME AS child_table, COLUMN_NAME AS child_column,
            REFERENCED_TABLE_NAME AS parent_table, REFERENCED_COLUMN_NAME AS parent_column
            FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { type: db.Sequelize.QueryTypes.SELECT, transaction });
        for (const f of fks) {
            if (parents.has(f.parent_table) && !allowed.has(`${f.child_table}.${f.child_column}>${f.parent_table}.${f.parent_column}`)) {
                fail(409, 'Unreviewed database dependency. Account deletion requires schema review.');
            }
        }
        const engines = await db.sequelize.query('SELECT TABLE_NAME AS table_name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
            { type: db.Sequelize.QueryTypes.SELECT, transaction });
        const touched = new Set([...parents, ...retainedReferences.map(([name]) => table(db[name])), table(db.EmailQueueJob), table(db.AccountDeletionFile)]);
        for (const name of touched) {
            if (!engines.some(row => row.table_name === name && row.engine === 'InnoDB')) {
                fail(503, `Account deletion schema is not ready: required table "${name}" must exist and use InnoDB.`);
            }
        }
        const cleanupSchema = await require('./accountDeletionSchema').inspect(db.sequelize.getQueryInterface());
        if (!cleanupSchema.ready) {
            fail(503, `Account deletion cleanup schema is not ready (${cleanupSchema.issues.join(', ')}). Apply the reviewed account deletion migration.`);
        }
    }

    async function buildPlan(actor, role, id, transaction, lock = false) {
        authorize(actor, role, id);
        const options = { transaction, ...(lock && { lock: transaction.LOCK.UPDATE }) };
        const currentActor = await db.User.findByPk(actor.id, { ...options, attributes: ['id', 'role', 'admin_scope', 'account_status'] });
        authorize(currentActor, role, id);
        if (currentActor.account_status !== 'verified') fail(403, 'A verified administrator is required.');
        const user = await db.User.findByPk(id, { ...options, attributes: ['id', 'role', 'admin_scope', 'name', 'email', 'account_status', 'alumni_record_id', 'updatedAt'] });
        if (!user) fail(404, 'Account not found or already deleted.');
        if (user.role !== role) fail(403, 'Target account is outside this administrator scope.');
        const protectedIds = String(env.ACCOUNT_DELETION_PROTECTED_IDS || '').split(',').map(value => Number(value.trim()));
        if (user.admin_scope || protectedIds.includes(id)) fail(403, 'Protected system accounts cannot be deleted.');
        await verifySchema(transaction);
        const operations = [];
        const read = async (name, where, attributes) => db[name].unscoped().findAll({ ...options, where, raw: true, ...(attributes && { attributes }), order: [[db[name].primaryKeyAttribute, 'ASC']] });
        const owned = async (name, where) => {
            const rows = await read(name, where);
            operations.push({ name, rows }); return rows;
        };
        const jobs = await read('Job', { employer_id: id });
        if (role === 'alumni' && jobs.length) fail(409, 'Alumni account has unexpected job ownership. Review its data first.');
        const apps = await read('Application', role === 'employer' ? { job_id: inIds(jobs) } : { alumni_id: id });
        const docs = await owned('ApplicationDocument', { application_id: inIds(apps) });
        await owned('ApplicationResponse', { application_id: inIds(apps) });
        await owned('JobRequirementSnapshot', { [Op.or]: [{ application_id: inIds(apps) }, { job_id: inIds(jobs) }] });
        const interviews = await owned('Interview', { application_id: inIds(apps) });
        operations.push({ name: 'Application', rows: apps });
        await owned('JobRequirement', { job_id: inIds(jobs) });
        await owned('RequirementGroup', { job_id: inIds(jobs) });
        operations.push({ name: 'Job', rows: jobs });
        const resumes = await read('Resume', { user_id: id });
        for (const name of resumeChildren) await owned(name, { resume_id: inIds(resumes) });
        operations.push({ name: 'Resume', rows: resumes });
        const profiles = await read('AlumniProfile', { user_id: id });
        await owned('EmploymentHistory', { alumni_id: inIds(profiles) });
        operations.push({ name: 'AlumniProfile', rows: profiles });
        await owned('EmployerProfile', { user_id: id });
        await owned('AlumniProfileUpdateRequest', { alumni_user_id: id });
        await owned('Notification', { userId: id });
        await owned('PasswordResetToken', { user_id: id });
        await owned('RegistrationEmailVerification', { consumed_by_user_id: id });
        await owned('MessageSendRequest', { sender_id: id });
        const memberships = await owned('ConversationParticipant', { user_id: id });
        const directConversations = await read('Conversation', { type: 'direct', id: { [Op.in]: memberships.map(row => row.conversation_id) } });
        await owned('MembershipAdministrator', { user_id: id });
        const retained = [];
        for (const [name, column] of retainedReferences) retained.push({ name, column, rows: await read(name, { [column]: id }) });
        const interviewNotifications = await read('Notification', { interview_id: inIds(interviews), userId: { [Op.ne]: id } });
        const revisions = await read('ApplicationDocument', { original_document_id: inIds(docs), id: { [Op.notIn]: docs.map(row => row.id) } });
        const groupRequirements = await read('JobRequirement', { group_id: inIds(operations.find(o => o.name === 'RequirementGroup').rows), job_id: { [Op.notIn]: jobs.map(row => row.id) } });
        if (groupRequirements.length) fail(409, 'Requirements are shared across jobs. Review before deletion.');
        // Email is used only after primary-key verification, never to identify a target account.
        const emails = await read('EmailQueueJob', { to: user.email, status: { [Op.in]: ['pending', 'processing', 'failed'] } });
        const blocked = [];
        if (!approved()) blocked.push('Permanent deletion awaits deployment approval of the retention policy.');
        if (emails.some(row => row.status === 'processing')) blocked.push('Email delivery is in progress. Retry after it finishes.');
        const counts = Object.fromEntries(operations.map(operation => [operation.name, operation.rows.length]));
        counts.ApplicationFiles = apps.reduce((n, app) => n + ['resume_path', 'transcript_path', 'certificate_path'].filter(key => app[key]).length, 0);
        const preserved = Object.fromEntries(retained.map(item => [`${item.name}.${item.column}`, item.rows.length]));
        preserved.RegistrarMasterRecords = user.alumni_record_id ? 1 : 0;
        preserved.InterviewNotifications = interviewNotifications.length;
        preserved.DocumentRevisionLinks = revisions.length;
        preserved.EmailHistory = await db.EmailQueueJob.count({ where: { to: user.email }, transaction });
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ user: user.toJSON(), operations, retained, directConversations, interviewNotifications, revisions, emails, preserved })).digest('hex');
        return { user, operations, retained, directConversations, interviewNotifications, revisions, emails, counts, preserved, fingerprint, blocked };
    }

    async function preview({ actor, role, id }) {
        authorize(actor, role, id);
        return db.sequelize.transaction({ isolationLevel: db.Sequelize.Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async transaction => {
            const plan = await buildPlan(actor, role, id, transaction);
            const confirmationToken = jwt.sign({ purpose: 'account-deletion', actor: Number(actor.id), target: id, role, policy: POLICY, fingerprint: plan.fingerprint }, secret(), { expiresIn: '10m' });
            return { account: { id, name: plan.user.name, email: plan.user.email, role }, counts: plan.counts,
                preserved: plan.preserved, policy: POLICY, canDelete: plan.blocked.length === 0, blockers: plan.blocked, confirmationToken };
        });
    }

    async function remove({ actor, role, id, confirmation, confirmationToken, ip }) {
        authorize(actor, role, id);
        if (confirmation !== 'DELETE') fail(400, 'Type DELETE to confirm permanent deletion.');
        if (!approved()) fail(403, 'Permanent deletion awaits deployment approval of the retention policy.');
        let token;
        try { token = jwt.verify(confirmationToken, secret(), { algorithms: ['HS256'] }); }
        catch { fail(409, 'Deletion preview expired or invalid. Load a fresh impact preview.'); }
        if (token.purpose !== 'account-deletion' || token.actor !== Number(actor.id) || token.target !== id || token.role !== role || token.policy !== POLICY) fail(409, 'Deletion preview does not match this request.');
        return db.sequelize.transaction({ isolationLevel: db.Sequelize.Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
            const plan = await buildPlan(actor, role, id, transaction, true);
            if (plan.blocked.length) fail(409, plan.blocked[0]);
            if (plan.fingerprint !== token.fingerprint) fail(409, 'Account data changed. Load and review a fresh deletion impact preview.');
            const options = { transaction };
            const identity = await db.User.create({ name: 'Deleted account', email: `deleted-${crypto.randomUUID()}@accounts.invalid`,
                password: null, role: 'deleted', admin_scope: null, account_status: 'deactivated', alumni_record_id: null }, options);
            // Keep a visible departed participant in direct-message history.
            if (plan.directConversations.length) await db.ConversationParticipant.bulkCreate(plan.directConversations.map(conversation => ({ conversation_id: conversation.id, user_id: identity.id, unread_count: 0 })), options);
            for (const item of plan.retained) {
                if (item.rows.length) await db[item.name].update({ [item.column]: identity.id }, { ...options, where: { [item.column]: id } });
            }
            // Detach retained references explicitly, irrespective of existing FK delete rules.
            if (plan.interviewNotifications.length) await db.Notification.update({ interview_id: null }, { ...options, where: { id: inIds(plan.interviewNotifications) } });
            const documents = plan.operations.find(operation => operation.name === 'ApplicationDocument').rows;
            if (documents.length) await db.ApplicationDocument.update({ original_document_id: null }, { ...options, where: { [Op.or]: [{ id: inIds(documents) }, { original_document_id: inIds(documents) }] } });
            const notificationIds = plan.operations.find(operation => operation.name === 'Notification').rows;
            if (notificationIds.length) await db.AlumniProfileUpdateRequest.update({ notification_id: null }, { ...options, where: { notification_id: inIds(notificationIds) } });
            if (plan.emails.length) await db.EmailQueueJob.update({ status: 'failed', attempts: db.sequelize.col('max_attempts'),
                processing_started_at: null, last_error: JSON.stringify({ code: 'ACCOUNT_DELETED' }) }, { ...options, where: { id: inIds(plan.emails) } });
            const references = new Map();
            const add = (value, uploadOwned = true) => {
                if (typeof value === 'string' && value && !value.startsWith('data:')) references.set(value, references.get(value) === true || uploadOwned);
            };
            const metadataFiles = value => {
                if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return; } }
                if (Array.isArray(value)) for (const doc of value) add(doc?.storage_ref);
            };
            const snapshotFiles = value => {
                if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return; } }
                if (Array.isArray(value)) { value.forEach(snapshotFiles); return; }
                if (!value || typeof value !== 'object') return;
                for (const [key, entry] of Object.entries(value)) {
                    if (['photo_url', 'storage_ref', 'file_path', 'resume_path', 'transcript_path', 'certificate_path'].includes(key)) add(entry, false);
                    else if (entry && typeof entry === 'object') snapshotFiles(entry);
                }
            };
            for (const operation of plan.operations) {
                for (const row of operation.rows) {
                    if (operation.name === 'Application') { ['resume_path', 'transcript_path', 'certificate_path'].forEach(key => add(row[key])); snapshotFiles(row.resume_snapshot); }
                    if (operation.name === 'ApplicationDocument') add(row.file_path);
                    if (operation.name === 'AlumniProfile') { add(row.proof_document_path); add(row.avatar_url, false); metadataFiles(row.proof_documents); }
                    if (operation.name === 'EmployerProfile') { add(row.business_permit_path); add(row.logo_url, false); metadataFiles(row.business_permit_documents); }
                    if (operation.name === 'ResumePersonalInfo') add(row.photo_url, false);
                    if (operation.name === 'ResumeVersion') snapshotFiles(row.snapshot_data);
                }
                if (operation.rows.length) {
                    const keys = db[operation.name].primaryKeyAttributes;
                    if (!keys.length) fail(409, 'A dependent record has no verified primary key.');
                    await db[operation.name].destroy({ ...options, where: { [Op.or]: operation.rows.map(row => Object.fromEntries(keys.map(key => [key, row[key]]))) } });
                }
            }
            // Editable photo URLs/snapshots do not prove upload ownership. Keep
            // cleanup evidence for review rather than deleting arbitrary assets.
            if (references.size) await db.AccountDeletionFile.bulkCreate([...references].map(([reference, uploadOwned]) => ({ reference,
                status: uploadOwned ? 'pending' : 'manual_review', last_error: uploadOwned ? null : 'OWNERSHIP_REVIEW', next_attempt_at: new Date() })), options);
            // Audit failure is fatal here: deletion must never succeed without its audit record.
            await db.AuditLog.create({ actor_id: actor.id, actor_role: 'admin', action: 'account.permanently_deleted',
                target_type: role, target_id: id, metadata: { policy: POLICY, retention_identity_id: identity.id, counts: plan.counts, preserved: plan.preserved, cleanup_files: references.size },
                ip_address: ip || null }, options);
            const deleted = await db.User.destroy({ ...options, where: { id, role } });
            if (deleted !== 1) fail(409, 'Account changed during deletion.');
            return { success: true, deletedUserId: id, role, cleanup: references.size ? 'pending' : 'none', msg: 'Account permanently deleted. Retained records were preserved; private file cleanup is queued.' };
        });
    }
    return { preview, remove };
}
module.exports = { createAccountDeletion, POLICY, resumeChildren, retainedReferences };
