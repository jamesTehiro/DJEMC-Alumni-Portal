const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { createAccountDeletion, POLICY, resumeChildren } = require('../services/accountDeletion');
const { createCleanup } = require('../services/accountDeletionCleanup');

test('account deletion uses real transactions/FKs in a new isolated loopback database', { skip: process.env.RUN_ACCOUNT_DELETION_DATABASE_TESTS !== 'true' }, async t => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    if (process.env.ACCOUNT_DELETION_REQUIRE_MYSQL84 === 'true') assert.equal(process.env.ACCOUNT_DELETION_TEST_ISOLATED, 'true', 'Confirm a separate disposable service before running production-readiness fixtures.');
    const database = `djemc_account_deletion_${Date.now()}_test`;
    const options = { host: '127.0.0.1', port: Number(process.env.ACCOUNT_DELETION_TEST_PORT || 3311), user: process.env.ACCOUNT_DELETION_TEST_USER || 'root', password: process.env.ACCOUNT_DELETION_TEST_PASSWORD || '' };
    const connection = await mysql.createConnection(options);
    let db, server;
    try {
        const [[engine]] = await connection.query('SELECT VERSION() AS version, @@version_comment AS comment');
        const mysql84 = /^8\.4\./.test(engine.version) && !/mariadb/i.test(engine.version + engine.comment);
        if (process.env.ACCOUNT_DELETION_REQUIRE_MYSQL84 === 'true') assert.ok(mysql84, 'Production readiness requires genuine isolated MySQL 8.4. No fixture database was created.');
        t.diagnostic(JSON.stringify({ engineVersion: engine.version, mysql84 }));
        await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
        Object.assign(process.env, { DB_HOST: options.host, DB_PORT: String(options.port), DB_NAME: database, DB_USER: options.user, DB_PASS: options.password,
            NODE_ENV: 'test', JWT_SECRET: 'isolated-account-deletion-test-secret', ACCOUNT_DELETION_POLICY: POLICY });
        // .env cannot replace these explicit loopback fixture settings.
        db = require('../models');
        assert.equal(db.sequelize.config.host, '127.0.0.1');
        assert.equal(db.sequelize.config.database, database);
        const migration = require('../migrations/20261102-create-account-deletion-files');
        await migration.up(db.sequelize.getQueryInterface(), db.Sequelize);
        await migration.up(db.sequelize.getQueryInterface(), db.Sequelize);
        assert.deepEqual(await db.sequelize.getQueryInterface().showAllTables(), ['account_deletion_files']);
        await db.sequelize.sync(); // New fixture schema only; no force/alter or existing data.
        const express = require('express'); const jwt = require('jsonwebtoken');
        const httpApp = express(); httpApp.use(express.json());
        httpApp.use('/api/admin', require('../routes/adminRoutes'));
        httpApp.post('/api/auth/login', require('../controllers/authController').login);
        httpApp.use('/api/messages', require('../routes/messageRoutes'));
        httpApp.use('/api/admin-employer', require('../routes/adminEmployerMessageRoutes'));
        server = httpApp.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const http = (actor, route, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api${route}`, {
            method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: actor.id }, process.env.JWT_SECRET)}` },
            ...(body && { body: JSON.stringify(body) })
        });
        const service = createAccountDeletion({ db });
        const user = (name, role, extra = {}) => db.User.create({ name, email: `${name}@example.invalid`, password: 'fixture-unusable-hash', role, account_status: 'verified', ...extra });
        const employerAdmin = await user('employer-admin', 'admin', { admin_scope: 'employer' });
        const alumniAdmin = await user('alumni-admin', 'admin', { admin_scope: 'alumni' });
        const employer = await user('target-employer', 'employer');
        const otherEmployer = await user('other-employer', 'employer');
        const master = await db.AlumniRecord.create({ student_id: 'DELETE-TEST-ONLY', full_name: 'Official preserved graduate', course: 'BSIT', batch_year: 2020 });
        const alumni = await user('target-alumni', 'alumni', { alumni_record_id: master.id });
        const otherAlumni = await user('other-alumni', 'alumni');
        const job = await db.Job.create({ employer_id: employer.id, title: 'Delete this job' });
        const otherJob = await db.Job.create({ employer_id: otherEmployer.id, title: 'Keep this job' });
        const app = await db.Application.create({ job_id: job.id, alumni_id: alumni.id, resume_path: '/uploads/documents/shared.pdf', transcript_path: '/uploads/documents/employer-only.pdf' });
        const app2 = await db.Application.create({ job_id: job.id, alumni_id: otherAlumni.id });
        const remainingApp = await db.Application.create({ job_id: otherJob.id, alumni_id: alumni.id, resume_path: '/uploads/documents/alumni-only.pdf' });
        const unrelatedApp = await db.Application.create({ job_id: otherJob.id, alumni_id: otherAlumni.id, resume_path: '/uploads/documents/shared.pdf' });
        const group = await db.RequirementGroup.create({ job_id: job.id, group_label: 'Fixture group' });
        await db.JobRequirement.create({ job_id: job.id, group_id: group.id, requirement_code: 'PROOF', label: 'Proof' });
        const doc = await db.ApplicationDocument.create({ application_id: app.id, requirement_code: 'PROOF', file_name: 'one.pdf', file_path: '/uploads/documents/shared.pdf' });
        await db.ApplicationDocument.create({ application_id: app.id, requirement_code: 'PROOF', file_name: 'two.pdf', file_path: '/uploads/documents/revision.pdf', original_document_id: doc.id });
        const remainingDoc = await db.ApplicationDocument.create({ application_id: remainingApp.id, requirement_code: 'PROOF', file_name: 'keep.pdf', file_path: '/uploads/documents/keep.pdf', original_document_id: doc.id });
        await db.ApplicationResponse.create({ application_id: app.id, requirement_code: 'INFO', response_value: 'Fixture response' });
        await db.JobRequirementSnapshot.create({ application_id: app.id, job_id: job.id, version: 1, snapshot_data: { fixture: true } });
        const interview = await db.Interview.create({ application_id: app.id, venue: 'Fixture', place: 'Fixture', date: '2026-11-02', time: '09:00', contact_info: 'Fixture' });
        const retainedNotification = await db.Notification.create({ userId: alumni.id, interview_id: interview.id, message: 'Retained history' });
        await db.Notification.create({ userId: employer.id, message: 'Private employer notice' });
        const alumniProfile = await db.AlumniProfile.create({ user_id: alumni.id, proof_document_path: '/uploads/documents/proof.pdf', proof_documents: JSON.stringify([{ storage_ref: '/uploads/documents/proof-2.pdf' }]) });
        await db.EmploymentHistory.create({ alumni_id: alumniProfile.id, company_name: 'Fixture' });
        await db.EmployerProfile.create({ user_id: employer.id, business_permit_path: '/uploads/documents/permit.pdf', business_permit_documents: JSON.stringify([{ storage_ref: '/uploads/documents/permit-2.pdf' }]) });
        const resume = await db.Resume.create({ user_id: alumni.id });
        for (const name of resumeChildren) await db[name].create({ resume_id: resume.id, skill_name: 'Fixture skill', version_number: 1, snapshot_data: { fixture: true } });
        const otherResume = await db.Resume.create({ user_id: otherAlumni.id });
        await db.ResumePersonalInfo.update({ photo_url: '/uploads/images/editable-photo-unproven.png' }, { where: { resume_id: resume.id } });
        const membership = await db.MembershipApplication.create({ alumni_user_id: alumni.id, application_status: 'draft', applicant_name: 'Preserved draft' });
        const conversation = await db.Conversation.create({ type: 'group', name: 'Preserved forum', user1Id: alumni.id, user2Id: otherAlumni.id });
        await db.ConversationParticipant.bulkCreate([{ conversation_id: conversation.id, user_id: alumni.id }, { conversation_id: conversation.id, user_id: otherAlumni.id }]);
        const sharedMessage = await db.Message.create({ conversation_id: conversation.id, sender_id: alumni.id, message_text: 'Preserved text', file_url: '/uploads/documents/proof.pdf' });
        const otherMessage = await db.Message.create({ conversation_id: conversation.id, sender_id: otherAlumni.id, message_text: 'Other participant text' });
        const direct = await db.Conversation.create({ type: 'direct', user1Id: alumni.id, user2Id: otherAlumni.id, conversation_key: `direct_${alumni.id}_${otherAlumni.id}` });
        await db.ConversationParticipant.bulkCreate([{ conversation_id: direct.id, user_id: alumni.id }, { conversation_id: direct.id, user_id: otherAlumni.id }]);
        await db.Message.create({ conversation_id: direct.id, sender_id: alumni.id, message_text: 'Preserved direct history' });
        const employerConversation = await db.EmployerConversation.create({ employerId: employer.id, adminId: employerAdmin.id });
        const employerMessage = await db.EmployerMessage.create({ conversationId: employerConversation.id, senderType: 'employer', senderId: employer.id, message: 'Preserve employer text' });
        const post = await db.Post.create({ user_id: alumni.id, text: 'Shared post' });
        const otherComment = await db.Comment.create({ user_id: otherAlumni.id, post_id: post.id, comment: 'Keep other comment' });
        const audit = await db.AuditLog.create({ actor_id: alumni.id, actor_role: 'alumni', action: 'fixture', target_type: 'application', target_id: app.id });
        const mail = await db.EmailQueueJob.create({ to: employer.email, subject: 'Fixture', message: 'No real mail', status: 'pending' });
        const sentMail = await db.EmailQueueJob.create({ to: employer.email, subject: 'History', message: 'Keep history', status: 'sent' });
        const request = (actor, role, id) => ({ actor, role, id });
        const remove = async (actor, role, id, extra = {}) => {
            const preview = await service.preview(request(actor, role, id));
            return service.remove({ ...request(actor, role, id), confirmation: 'DELETE', confirmationToken: preview.confirmationToken, ...extra });
        };
        await t.test('preview is read-only and reports real counts; protected/mismatched/missing targets are rejected', async () => {
            const before = await db.User.count();
            const preview = await service.preview(request(employerAdmin, 'employer', employer.id));
            assert.equal(preview.counts.Job, 1); assert.equal(preview.counts.Application, 2); assert.equal(preview.counts.ApplicationDocument, 2);
            assert.equal(preview.counts.ApplicationFiles, 2); assert.equal(preview.counts.JobRequirementSnapshot, 1);
            assert.equal(await db.User.count(), before); assert.equal(await db.AccountDeletionFile.count(), 0);
            await assert.rejects(service.preview(request(employerAdmin, 'employer', alumni.id)), e => e.status === 403);
            await assert.rejects(service.preview(request(employerAdmin, 'employer', 999999)), e => e.status === 404);
            const protectedService = createAccountDeletion({ db, env: { ...process.env, ACCOUNT_DELETION_PROTECTED_IDS: String(employer.id) } });
            await assert.rejects(protectedService.preview(request(employerAdmin, 'employer', employer.id)), e => e.status === 403);
            const gated = createAccountDeletion({ db, env: { ...process.env, ACCOUNT_DELETION_POLICY: '' } });
            assert.equal((await gated.preview(request(employerAdmin, 'employer', employer.id))).canDelete, false);
        });
        await t.test('stale/cross-account preview and in-flight emails prevent deletion', async () => {
            const preview = await service.preview(request(employerAdmin, 'employer', employer.id));
            await db.ApplicationResponse.create({ application_id: app2.id, requirement_code: 'CHANGED', response_value: 'Changed after preview' });
            await assert.rejects(service.remove({ ...request(employerAdmin, 'employer', employer.id), confirmation: 'DELETE', confirmationToken: preview.confirmationToken }), e => e.status === 409);
            await assert.rejects(service.remove({ ...request(employerAdmin, 'employer', otherEmployer.id), confirmation: 'DELETE', confirmationToken: preview.confirmationToken }), e => e.status === 409);
            await mail.update({ status: 'processing' });
            assert.equal((await service.preview(request(employerAdmin, 'employer', employer.id))).canDelete, false);
            await mail.update({ status: 'pending' });
        });
        await t.test('injected late failure rolls back deletion, shared reassignment, email cancellation, audit and cleanup outbox', async () => {
            const original = db.User.destroy;
            db.User.destroy = async () => { throw new Error('Fixture final deletion failure'); };
            try { await assert.rejects(remove(employerAdmin, 'employer', employer.id), /Fixture final deletion failure/); }
            finally { db.User.destroy = original; }
            assert.ok(await db.User.findByPk(employer.id)); assert.ok(await db.Job.findByPk(job.id));
            assert.equal((await employerConversation.reload()).employerId, employer.id);
            assert.equal((await mail.reload()).status, 'pending'); assert.equal(await db.AccountDeletionFile.count(), 0);
            assert.equal(await db.User.count({ where: { role: 'deleted' } }), 0);
            assert.equal(await db.AuditLog.count({ where: { action: 'account.permanently_deleted' } }), 0);
        });
        await t.test('concurrent requests delete employer once, remove only its jobs/applications, preserve alumni and shared content', async () => {
            const preview = await service.preview(request(employerAdmin, 'employer', employer.id));
            const payload = { ...request(employerAdmin, 'employer', employer.id), confirmation: 'DELETE', confirmationToken: preview.confirmationToken };
            const results = await Promise.allSettled([service.remove(payload), service.remove(payload)]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(await db.User.findByPk(employer.id), null); assert.equal(await db.Job.findByPk(job.id), null);
            assert.equal(await db.Application.findByPk(app.id), null); assert.equal(await db.Application.findByPk(app2.id), null);
            for (const id of [alumni.id, otherAlumni.id, otherEmployer.id]) assert.ok(await db.User.findByPk(id));
            assert.ok(await db.Job.findByPk(otherJob.id)); assert.ok(await db.Application.findByPk(remainingApp.id));
            assert.ok(await db.Resume.findByPk(resume.id));
            assert.equal((await retainedNotification.reload()).interview_id, null);
            assert.equal((await remainingDoc.reload()).original_document_id, null);
            assert.notEqual((await employerConversation.reload()).employerId, employer.id);
            assert.notEqual((await employerMessage.reload()).senderId, employer.id);
            assert.equal((await mail.reload()).status, 'failed'); assert.equal(mail.attempts, mail.max_attempts);
            assert.equal((await sentMail.reload()).status, 'sent');
        });
        await t.test('alumni deletion removes private applications/resumes, preserves Registrar, draft membership, shared forum and remaining participants', async () => {
            const preview = await service.preview(request(alumniAdmin, 'alumni', alumni.id));
            assert.equal(preview.counts.Application, 1); assert.equal(preview.counts.Resume, 1); assert.equal(preview.counts.ResumeVersion, 1);
            assert.equal(preview.preserved['MembershipApplication.alumni_user_id'], 1);
            await remove(alumniAdmin, 'alumni', alumni.id);
            assert.equal(await db.User.findByPk(alumni.id), null); assert.equal(await db.Application.findByPk(remainingApp.id), null);
            assert.equal(await db.Resume.findByPk(resume.id), null);
            for (const name of resumeChildren) assert.equal(await db[name].count({ where: { resume_id: resume.id } }), 0);
            assert.ok(await db.Job.findByPk(otherJob.id)); assert.ok(await db.User.findByPk(otherAlumni.id));
            assert.ok(await db.Resume.findByPk(otherResume.id)); assert.ok(await db.Application.findByPk(unrelatedApp.id));
            assert.ok(await db.AlumniRecord.findByPk(master.id));
            assert.equal((await membership.reload()).applicant_name, 'Preserved draft'); assert.notEqual(membership.alumni_user_id, alumni.id);
            assert.equal((await sharedMessage.reload()).message_text, 'Preserved text'); assert.notEqual(sharedMessage.sender_id, alumni.id);
            assert.equal((await otherMessage.reload()).sender_id, otherAlumni.id);
            assert.ok(await db.Comment.findByPk(otherComment.id)); assert.notEqual((await post.reload()).user_id, alumni.id);
            assert.notEqual((await audit.reload()).actor_id, alumni.id);
            const participants = await db.ConversationParticipant.findAll({ where: { conversation_id: conversation.id } });
            assert.deepEqual(participants.map(p => p.user_id), [otherAlumni.id]);
            const identity = await db.User.findByPk(membership.alumni_user_id);
            assert.equal(identity.name, 'Deleted account'); assert.equal(identity.password, null); assert.equal(identity.account_status, 'deactivated'); assert.equal(identity.alumni_record_id, null);
            const login = await http(identity, '/auth/login', 'POST', { email: identity.email, password: 'arbitrary-password' });
            assert.equal(login.status, 403); assert.equal((await login.json()).token, undefined);
            assert.equal((await http(identity, '/messages/conversations')).status, 403);
            assert.equal((await http(alumni, '/messages/conversations')).status, 401);
            await assert.rejects(service.preview(request(alumniAdmin, 'alumni', identity.id)), e => e.status === 403);
        });
        await t.test('cleanup preserves reused files; provider failure is durable and retried after commit', async () => {
            const unprovenPhoto = await db.AccountDeletionFile.findOne({ where: { reference: '/uploads/images/editable-photo-unproven.png' } });
            assert.equal(unprovenPhoto.status, 'manual_review'); assert.equal(unprovenPhoto.last_error, 'OWNERSHIP_REVIEW');
            const removed = [];
            let failProvider = true;
            const cleanup = createCleanup({ db, removeFile: async reference => { if (failProvider && reference.endsWith('employer-only.pdf')) throw new Error('Synthetic outage'); removed.push(reference); } });
            while (await cleanup.processOne()) { /* process currently due jobs only */ }
            assert.ok(!removed.some(ref => ref.endsWith('shared.pdf') || ref.endsWith('proof.pdf')));
            const failed = await db.AccountDeletionFile.findOne({ where: { reference: '/uploads/documents/employer-only.pdf' } });
            assert.equal(failed.status, 'pending'); assert.equal(failed.last_error, 'CLEANUP_RETRY');
            assert.equal(await db.User.findByPk(employer.id), null);
            failProvider = false; await failed.update({ next_attempt_at: new Date(0) });
            await cleanup.processOne(); assert.equal((await failed.reload()).status, 'completed');
            assert.ok(removed.some(ref => ref.endsWith('employer-only.pdf')));
            // Crash recovery: expired lease is safely resumed.
            await db.AccountDeletionFile.create({ reference: '/uploads/documents/crash-recovery.pdf', status: 'processing', attempts: 1, next_attempt_at: new Date(0) });
            await cleanup.processOne(); assert.ok(removed.some(ref => ref.endsWith('crash-recovery.pdf')));
        });
        await t.test('retained employer and direct histories stay accessible and cannot receive new messages', async () => {
            const employerIdentityId = (await employerConversation.reload()).employerId;
            const listResponse = await http(employerAdmin, '/admin-employer/conversations');
            assert.equal(listResponse.status, 200);
            const history = (await listResponse.json()).find(row => row.employerId === employerIdentityId);
            assert.ok(history); assert.equal(history.employer.name, 'Deleted account'); assert.equal(history.read_only, true);
            assert.equal(history.employer.email, null);
            const employerHistory = await http(employerAdmin, `/admin-employer/messages/${employerIdentityId}`);
            assert.equal(employerHistory.status, 200);
            assert.ok((await employerHistory.json()).messages.some(row => row.message === 'Preserve employer text'));
            assert.equal((await http(employerAdmin, '/admin-employer/messages', 'POST', { employerId: employerIdentityId, message: 'Blocked' })).status, 404);
            const directHistory = await http(otherAlumni, `/messages/${direct.id}`);
            assert.equal(directHistory.status, 200);
            const directPayload = await directHistory.json();
            assert.equal(directPayload.messages[0].sender.name, 'Deleted account');
            assert.equal((await http(otherAlumni, `/messages/${direct.id}`, 'POST', { message_text: 'Blocked' })).status, 410);
            const directMembers = await db.ConversationParticipant.findAll({ where: { conversation_id: direct.id } });
            assert.equal(directMembers.length, 2); assert.ok(directMembers.some(row => row.user_id === otherAlumni.id));
        });
        await t.test('real HTTP preview and confirmed deletion remove a disposable account', async () => {
            const disposable = await user('http-disposable', 'employer');
            const previewResponse = await http(employerAdmin, `/admin/employer/users/${disposable.id}/deletion-impact`);
            assert.equal(previewResponse.status, 200); assert.equal(previewResponse.headers.get('cache-control'), 'private, no-store');
            const preview = await previewResponse.json();
            const result = await http(employerAdmin, `/admin/employer/users/${disposable.id}`, 'DELETE', { confirmation: 'DELETE', confirmationToken: preview.confirmationToken });
            assert.equal(result.status, 200); assert.equal((await result.json()).deletedUserId, disposable.id);
            assert.equal(await db.User.findByPk(disposable.id), null);
        });
        await t.test('submitted membership content is preserved in full, just like draft forms', async () => {
            const submittedOwner = await user('submitted-membership-fixture', 'alumni');
            const form = await db.MembershipApplication.create({ alumni_user_id: submittedOwner.id, application_status: 'submitted', applicant_name: 'Preserved submitted form',
                personal_details: { fixture: 'retained' }, educational_attainment: [{ school: 'Fixture school' }], consent_accepted: true, submitted_at: new Date('2026-11-01T01:00:00Z') });
            const before = form.toJSON();
            await remove(alumniAdmin, 'alumni', submittedOwner.id); await form.reload();
            const after = form.toJSON();
            for (const key of Object.keys(before).filter(key => !['alumni_user_id', 'updated_at'].includes(key))) assert.deepEqual(after[key], before[key], key);
            assert.notEqual(after.alumni_user_id, submittedOwner.id); assert.equal(after.application_status, 'submitted');
            assert.equal((await membership.reload()).application_status, 'draft');
        });
        await t.test('unknown cascading FK fails closed before mutation', async () => {
            await db.sequelize.query('CREATE TABLE unreviewed_dependents (id INT PRIMARY KEY, user_id INT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB');
            await assert.rejects(service.preview(request(employerAdmin, 'employer', otherEmployer.id)), e => e.status === 409);
            assert.ok(await db.User.findByPk(otherEmployer.id));
        });
        await t.test('actual administrator endpoints reject regular users, wrong scope and self-deletion', async () => {
            const call = (actor, route) => http(actor, `/admin/${route}`, 'DELETE', { confirmation: 'DELETE' });
            assert.equal((await call(otherEmployer, `employer/users/${otherEmployer.id}`)).status, 403);
            assert.equal((await call(employerAdmin, `alumni/users/${otherAlumni.id}`)).status, 403);
            assert.equal((await call(employerAdmin, `employer/users/${employerAdmin.id}`)).status, 403);
        });
        t.diagnostic(JSON.stringify({ database, loopbackOnly: true, existingDatabasesChanged: false, realEmails: false, realStorageDeletes: false, fixtureRetainedForReview: true }));
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (db) await db.sequelize.close();
        await connection.end();
    }
});
