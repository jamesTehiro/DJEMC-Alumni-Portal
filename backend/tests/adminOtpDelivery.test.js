const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const email = require('../utils/email');
const { enqueueEmails } = require('../utils/emailQueue');
const { createRegistrationOtp } = require('../services/registrationOtp');
const { createAdminOtpQueue } = require('../services/adminOtpQueue');
const { assertAdminOtpConfiguration } = require('../services/adminOtpConfiguration');
const { processJob } = require('../workers/emailQueueWorker');
const { emailKey } = require('../utils/registrationEmail');
test.after(() => db.sequelize.close());
const recipient = 'admin.fixture@gmail.com', session='e'.repeat(64);
async function fixture(run) {
    const configured={EMAIL_PROVIDER:'brevo',BREVO_API_KEY:'fixture-rest-key',EMAIL_FROM:'sender@fixture.test',EMAIL_FROM_NAME:'Fixture Portal',REGISTRATION_OTP_SECRET:'a'.repeat(64),ADMIN_BOOTSTRAP_SECRET:'fixture-admin-secret',DB_HOST:'127.0.0.1',DB_NAME:'admin_delivery_fixture',DB_USER:'fixture',DB_PORT:'1'};
    const saved=Object.fromEntries(Object.keys(configured).map(key=>[key,process.env[key]]));
    Object.assign(process.env,configured);
    const originals={transaction:db.sequelize.transaction,query:db.sequelize.query,findUser:db.User.findOne,findOtp:db.RegistrationEmailVerification.findByPk,updateOtp:db.RegistrationEmailVerification.update,bulkCreate:db.EmailQueueJob.bulkCreate,findJob:db.EmailQueueJob.findOne,updateJob:db.EmailQueueJob.update,fetch:global.fetch};
    let row, requests=[], jobs=[];
    const same=(record,where)=>Object.entries(where).every(([key,value])=>record[key]===value);
    const attach=values=>{values.update=async fields=>Object.assign(values,fields);return values;};
    db.sequelize.transaction=async callback=>callback({LOCK:{UPDATE:'UPDATE'}});
    db.sequelize.query=async (_sql,{replacements})=>{if(!row)row=attach({email_key:replacements[0],email:replacements[1],session_hash:replacements[2],status:'failed',sent_at:new Date(0),resend_history:[],failed_attempts:0,consumed_at:null});};
    db.User.findOne=async()=>null;
    db.RegistrationEmailVerification.findByPk=async key=>key===emailKey(recipient)?row:null;
    db.RegistrationEmailVerification.update=async(values,{where})=>{if(!row||!same(row,where))return[0];await row.update(values);return[1];};
    db.EmailQueueJob.bulkCreate=async values=>values.map(value=>{const job={...value,id:jobs.length+1,max_attempts:5};jobs.push(job);return job;});
    db.EmailQueueJob.findOne=async({where})=>jobs.find(job=>same(job,where));
    db.EmailQueueJob.update=async(values,{where})=>{const job=jobs.find(job=>same(job,where));if(!job)return[0];Object.assign(job,values);return[1];};
    global.fetch=async(url,options)=>{requests.push({url,options});return Response.json({messageId:'<fixture-admin-accepted>'},{status:201});};
    const transport=createAdminOtpQueue({db,enqueueEmails,validateConfiguration:()=>{const config=assertAdminOtpConfiguration();assert.equal(email.validateConfiguration().provider,'brevo');return config;}});
    const otp=createRegistrationOtp({db,...transport,purpose:'admin-registration',randomInt:()=>123456});
    const reserve=()=>{const job=jobs[0];Object.assign(job,{status:'processing',attempts:1,processing_started_at:new Date()});return job;};
    try{await run({otp,jobs,requests,reserve,row:()=>row,configured});}
    finally{
        Object.assign(db.sequelize,{transaction:originals.transaction,query:originals.query});db.User.findOne=originals.findUser;
        Object.assign(db.RegistrationEmailVerification,{findByPk:originals.findOtp,update:originals.updateOtp});
        Object.assign(db.EmailQueueJob,{bulkCreate:originals.bulkCreate,findOne:originals.findJob,update:originals.updateJob});
        global.fetch=originals.fetch;
        for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    }
}
test('Admin OTP uses existing queue, real worker and Brevo adapter with mocked HTTPS acceptance',async()=>fixture(async f=>{
    const queued=await f.otp.send(recipient,session);
    assert.equal(queued.email_status,'pending');assert.equal(queued.verified,false);assert.equal(f.requests.length,0);
    assert.ok(f.jobs[0].dedupe_key.length<=191);assert.ok(!f.jobs[0].dedupe_key.includes('fixture-rest-key'));
    await assert.rejects(f.otp.verify(recipient,session,'123456'),error=>error.code==='OTP_QUEUED');
    await processJob(f.reserve());
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'https://api.brevo.com/v3/smtp/email');
    assert.equal(f.requests[0].options.headers['api-key'],f.configured.BREVO_API_KEY);
    const body=JSON.parse(f.requests[0].options.body);
    assert.deepEqual(body.sender,{email:f.configured.EMAIL_FROM,name:f.configured.EMAIL_FROM_NAME});
    assert.match(body.subject,/Admin Registration/);assert.match(body.textContent,/123456/);assert.equal(f.jobs[0].status,'sent');
    assert.equal((await f.otp.status(recipient,session)).email_status,'sent');
    const verified=await f.otp.verify(recipient,session,'123456');assert.equal(verified.verified,true);assert.ok(verified.registration_authorization);
}));
test('Brevo rejection produces failed queue state and cannot verify Admin OTP',async()=>fixture(async f=>{
    global.fetch=async()=>Response.json({message:'private provider details'},{status:401});
    await f.otp.send(recipient,session);await processJob(f.reserve());
    assert.equal(f.jobs[0].status,'failed');assert.ok(!f.jobs[0].last_error.includes('private'));
    assert.equal((await f.otp.status(recipient,session)).email_status,'failed');
    await assert.rejects(f.otp.verify(recipient,session,'123456'),error=>error.code==='OTP_DELIVERY_FAILED');
    assert.equal(f.row().status,'sent');assert.equal(f.row().verified_at,null);
}));
test('worker rejects expired and replaced Admin OTPs before any delivery',async()=>{
    for(const replaced of [false,true])await fixture(async f=>{
        await f.otp.send(recipient,session);if(replaced)f.row().otp_hash='f'.repeat(64);else f.row().expires_at=new Date(0);
        await processJob(f.reserve());assert.equal(f.requests.length,0);assert.equal(f.jobs[0].status,'failed');
    });
});
test('separate worker with different sender or database refuses Admin jobs',async()=>{
    for(const key of ['EMAIL_FROM_NAME','DB_NAME','BREVO_API_KEY'])await fixture(async f=>{
        await f.otp.send(recipient,session);process.env[key]='different-fixture-setting';
        await processJob(f.reserve());assert.equal(f.requests.length,0);assert.equal(f.jobs[0].status,'failed');
        assert.match(f.jobs[0].last_error,/CONFIG_MISMATCH/);
    });
});
test('missing worker Admin mail config is held without sending or success status',async()=>fixture(async f=>{
    await f.otp.send(recipient,session);delete process.env.EMAIL_FROM_NAME;
    await processJob(f.reserve());assert.equal(f.requests.length,0);assert.equal(f.jobs[0].status,'failed');assert.match(f.jobs[0].last_error,/ADMIN_OTP_CONFIG/);
}));
test('unstamped earlier Admin jobs are held; ordinary email jobs keep their existing behavior',async()=>fixture(async f=>{
    await f.otp.send(recipient,session);f.jobs[0].dedupe_key=f.jobs[0].dedupe_key.replace(/:[a-f0-9]{24}$/,'');
    await processJob(f.reserve());assert.equal(f.requests.length,0);assert.equal(f.jobs[0].status,'failed');
    Object.assign(f.jobs[0],{dedupe_key:'normal-notification',status:'processing'});delete process.env.ADMIN_BOOTSTRAP_SECRET;delete process.env.REGISTRATION_OTP_SECRET;
    await processJob(f.jobs[0]);assert.equal(f.requests.length,1);assert.equal(f.jobs[0].status,'sent');
}));
