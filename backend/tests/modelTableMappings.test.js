const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Sequelize, DataTypes } = require('sequelize');
const db = require('../models');
const expected = {
 User: 'users', AlumniProfile: 'alumniprofiles', EmployerProfile: 'employerprofiles', EmploymentHistory: 'employmenthistories', Job: 'jobs', Application: 'applications', Announcement: 'announcements', Comment: 'comments', Conversation: 'conversations', ConversationParticipant: 'conversationparticipants', Message: 'messages', Notification: 'notifications', Interview: 'interviews', AlumniRecord: 'alumnirecords', Post: 'posts', EmployerConversation: 'employerconversations', EmployerMessage: 'employermessages', PasswordResetToken: 'password_reset_tokens', EmailQueueJob: 'email_queue_jobs', RateLimitEntry: 'rate_limit_entries', RequirementLibrary: 'requirementlibrary', RequirementGroup: 'requirementgroups', JobRequirement: 'jobrequirements', JobRequirementSnapshot: 'jobrequirementsnapshots', ApplicationDocument: 'applicationdocuments', ApplicationResponse: 'applicationresponses', AuditLog: 'auditlogs', AlumniProfileUpdateRequest: 'alumniprofileupdaterequests', MembershipApplication: 'membershipapplications', MembershipAdministrator: 'membershipadministrators', Resume: 'resumes', ResumePersonalInfo: 'resumepersonalinfo', ResumeSummary: 'resumesummaries', ResumeEducation: 'resumeeducations', ResumeWorkExperience: 'resumeworkexperiences', ResumeSkill: 'resumeskills', ResumeProject: 'resumeprojects', ResumeCertification: 'resumecertifications', ResumeTraining: 'resumetrainings', ResumeSeminar: 'resumeseminars', ResumeAward: 'resumeawards', ResumeOrganization: 'resumeorganizations', ResumeVolunteerWork: 'resumevolunteerworks', ResumeLanguage: 'resumelanguages', ResumeReference: 'resumereferences', ResumeVersion: 'resumeversions'
};
test.after(() => db.sequelize.close());
test('every initialized Sequelize model explicitly targets its existing lowercase table', () => {
 assert.deepEqual(Object.keys(db.sequelize.models).sort(), Object.keys(expected).sort());
 for (const [name, table] of Object.entries(expected)) {
  const model = db.sequelize.models[name];
  assert.equal(model.getTableName(), table, name);
  assert.equal(model.options.tableName, table, name);
  const sql = db.sequelize.dialect.queryGenerator.selectQuery(model.getTableName(), { attributes: ['id'], limit: 1 });
  assert.ok(sql.includes('FROM `' + table + '`'), sql);
 }
});
test('every model factory has an explicit lowercase mapping independent of initialization', async () => {
 const isolated = new Sequelize('unused', 'unused', 'unused', { dialect: 'mysql', logging: false });
 try {
  for (const file of fs.readdirSync(path.join(__dirname, '../models')).filter(f => f.endsWith('.js') && f !== 'index.js')) {
   const factory = require('../models/' + file);
   const model = factory(isolated, DataTypes);
   assert.equal(model.getTableName(), expected[model.name], file);
   assert.match(fs.readFileSync(path.join(__dirname, '../models', file), 'utf8'), /tableName:\s*"[a-z_]+"/, file);
  }
 } finally { await isolated.close(); }
});
test('associations and foreign-key references use mapped tables while retaining model aliases and columns', () => {
 for (const model of Object.values(db.sequelize.models)) {
  for (const association of Object.values(model.associations)) {
   assert.equal(association.target.getTableName(), expected[association.target.name]);
  }
  for (const attribute of Object.values(model.rawAttributes)) {
   if (attribute.references) assert.ok(Object.values(expected).includes(attribute.references.model), model.name + '.' + attribute.field);
  }
 }
 assert.equal(db.Job.associations.User.foreignKey, 'employer_id');
 assert.equal(db.Application.associations.alumni.foreignKey, 'alumni_id');
 assert.equal(db.AlumniProfile.associations.EmploymentHistories.as, 'EmploymentHistories');
 assert.equal(db.EmploymentHistory.associations.AlumniProfile.foreignKey, 'alumni_id');
 assert.equal(db.ApplicationDocument.options.createdAt, 'created_at');
 assert.equal(db.RequirementGroup.options.updatedAt, false);
 assert.equal(db.PasswordResetToken.options.timestamps, false);
});

test('previously generated index names remain stable after table casing changes', () => {
 assert.deepEqual(db.ConversationParticipant.options.indexes.map(i => i.name), ['conversation_participants_conversation_id_user_id', 'conversation_participants_user_id', 'conversation_participants_conversation_id']);
 assert.deepEqual(db.EmployerMessage.options.indexes.map(i => i.name), ['employer_messages_conversation_id_created_at', 'employer_messages_sender_id']);
});

test('many-to-many joins use the registered participant table without generating extra models', () => {
 const joins = Object.values(db.sequelize.models).flatMap(model => Object.values(model.associations))
  .filter(association => association.associationType === 'BelongsToMany');
 assert.equal(joins.length, 2);
 for (const association of joins) {
  assert.equal(association.through.model, db.ConversationParticipant);
  assert.equal(association.through.model.getTableName(), 'conversationparticipants');
  assert.equal(db.sequelize.models[association.through.model.name], association.through.model);
 }
 assert.equal(Object.keys(db.sequelize.models).length, Object.keys(expected).length);
});

test('all HTTP, resume and queue models share the central Sequelize connection', () => {
 for (const model of Object.values(db.sequelize.models)) assert.equal(model.sequelize, db.sequelize, model.name);
 assert.equal(db.Resume.sequelize, db.Job.sequelize);
 assert.equal(db.EmailQueueJob.sequelize, db.Job.sequelize);
 assert.equal(db.MembershipApplication.sequelize, db.Job.sequelize);
});
