const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,real}=require('./helpers/accountDeletionFixture.cjs');
test.after(()=>real.sequelize.close());
const request=(f,role)=>({actor:f.actor(role),role,id:role==='employer'?10:20});
for(const role of ['employer','alumni']){
 test(role+' synthetic deletion preserves unrelated accounts, membership drafts/submissions and Registrar records',async()=>{
  const f=fixture(),req=request(f,role),preview=await f.service.preview(req);assert.equal(preview.canDelete,true);assert.equal(preview.counts.Application,role==='employer'?1:2);
  const result=await f.service.remove({...req,confirmation:'DELETE',confirmationToken:preview.confirmationToken});assert.equal(result.success,true);assert.ok(!f.rows('User').some(row=>row.id===req.id));
  assert.ok(f.rows('User').some(row=>row.id===(role==='employer'?20:10)));assert.equal(f.rows('AlumniRecord').length,1);assert.equal(f.rows('MembershipApplication').length,2);
  if(role==='employer'){assert.deepEqual(f.rows('Job').map(row=>row.id),[31]);assert.equal(f.rows('Resume').length,1);}else{assert.equal(f.rows('Job').length,2);assert.equal(f.rows('Resume').length,0);assert.ok(f.rows('MembershipApplication').every(row=>row.alumni_user_id!==20));}
  assert.equal(f.rows('ApplicationDocument').find(row=>row.id===52).original_document_id,null);assert.equal(f.rows('Notification').find(row=>row.id===54).interview_id,null);
  assert.ok(f.calls.indexOf('ApplicationDocument.destroy')<f.calls.indexOf('Application.destroy'));assert.ok(f.rows('AuditLog').some(row=>row.action==='account.permanently_deleted'&&row.target_id===req.id));assert.ok(f.rows('AccountDeletionFile').length>0);
  await assert.rejects(f.service.remove({...req,confirmation:'DELETE',confirmationToken:preview.confirmationToken}),error=>error.status===404);
 });
 test(role+' late audit or FK failures roll back account, audit, shared identities and cleanup jobs',async()=>{
  for(const failure of ['AuditLog.create','User.destroy']){const f=fixture(),req=request(f,role),preview=await f.service.preview(req),before=JSON.stringify(['User','Application','AuditLog','AccountDeletionFile','MembershipApplication','Message'].map(name=>f.rows(name)));f.fail(failure);await assert.rejects(f.service.remove({...req,confirmation:'DELETE',confirmationToken:preview.confirmationToken}));assert.equal(JSON.stringify(['User','Application','AuditLog','AccountDeletionFile','MembershipApplication','Message'].map(name=>f.rows(name))),before);}
 });
 test(role+' preview rejects missing schema and unknown FK; disabled policy never opens a write transaction',async()=>{
  const f=fixture();f.missing();await assert.rejects(f.service.preview(request(f,role)),error=>error.status===503&&error.message.includes('"account_deletion_files"'));
  const g=fixture();g.unknown();await assert.rejects(g.service.preview(request(g,role)),error=>error.status===409);
  const h=fixture();delete h.env.ACCOUNT_DELETION_POLICY;const preview=await h.service.preview(request(h,role));assert.equal(preview.canDelete,false);await assert.rejects(h.service.remove({...request(h,role),confirmation:'DELETE',confirmationToken:preview.confirmationToken}),error=>error.status===403);
 });
}
test('cleanup retries safely and preserves objects that still have retained references',async()=>{
 const {createCleanup}=require('../services/accountDeletionCleanup');const f=fixture();let now=new Date(),attempts=0;
 await f.db.AccountDeletionFile.create({reference:'/uploads/documents/fixture-retry.pdf',status:'pending',next_attempt_at:now});
 const worker=createCleanup({db:f.db,now:()=>now,removeFile:async()=>{attempts++;if(attempts===1)throw new Error('synthetic provider failure');}});
 assert.equal(await worker.processOne(),true);assert.equal(f.rows('AccountDeletionFile')[0].status,'pending');assert.equal(await worker.processOne(),false);
 now=new Date(now.getTime()+3600000);assert.equal(await worker.processOne(),true);assert.equal(f.rows('AccountDeletionFile')[0].status,'completed');assert.equal(attempts,2);assert.equal(await worker.processOne(),false);
 await f.db.AccountDeletionFile.create({reference:'/uploads/documents/fixture52.pdf',status:'pending',next_attempt_at:now});await worker.processOne();assert.equal(f.rows('AccountDeletionFile')[1].status,'retained');assert.equal(attempts,2);
});
