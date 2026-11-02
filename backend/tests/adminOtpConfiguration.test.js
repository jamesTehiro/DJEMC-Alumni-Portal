const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnvironment } = require('../config/adminOtpEnvironment');
const { inspectConfiguration, configurationFingerprint, API_KEYS } = require('../services/adminOtpConfiguration');
const { check } = require('../scripts/checkAdminRegistrationReadiness');
const valid = () => ({ EMAIL_PROVIDER:'brevo', BREVO_API_KEY:'fixture-brevo-rest-key', EMAIL_FROM:'sender@fixture.test', EMAIL_FROM_NAME:'Fixture Admin Portal', REGISTRATION_OTP_SECRET:'a'.repeat(64), ADMIN_BOOTSTRAP_SECRET:'fixture-admin-secret', DB_HOST:'127.0.0.1', DB_PORT:'3306', DB_NAME:'admin_otp_fixture', DB_USER:'fixture', DB_PASS:'fixture-db-password' });
const dotenvText = env => Object.entries(env).map(([key,value]) => `${key}=${value}`).join('\n');

test('explicit staging selection cannot borrow a missing bootstrap secret, including inherited worker values', () => {
    const stage = valid(); delete stage.ADMIN_BOOTSTRAP_SECRET;
    // Simulate another preloaded file or inherited process also supplying a secret.
    const effective = {...valid(), ADMIN_BOOTSTRAP_SECRET:'different-environment-secret'};
    const source = createEnvironment({ env:effective, argv:['--env-file=.env.staging'], cwd:process.cwd(), readFile:() => dotenvText(stage) });
    effective.ADMIN_BOOTSTRAP_SECRET='main-dotenv-fallback';
    assert.equal(source.kind,'explicit-file'); assert.equal(source.get().ADMIN_BOOTSTRAP_SECRET,undefined);
    assert.equal(effective.ADMIN_BOOTSTRAP_SECRET,'main-dotenv-fallback','Legacy process environment is left alone');
    assert.ok(inspectConfiguration(source.get()).issues.some(issue => issue.variable === 'ADMIN_BOOTSTRAP_SECRET' && issue.issue === 'missing'));
    const workerEnv = {...effective};
    const worker = createEnvironment({env:workerEnv, argv:[], readFile:()=>dotenvText(stage)});
    assert.equal(worker.get().ADMIN_BOOTSTRAP_SECRET,undefined);
});
test('complete explicitly preloaded staging config is preserved for API and embedded worker', () => {
    const env=valid(), original=dotenvText(env);
    const api=createEnvironment({env,argv:['--env-file','.env.staging'],readFile:()=>original});
    const worker=createEnvironment({env:{...env},argv:[],readFile:()=>original});
    assert.equal(inspectConfiguration(api.get(),{effectiveEnv:env}).ready,true);
    assert.equal(configurationFingerprint(api.get()),configurationFingerprint(worker.get()));
    env.BREVO_API_KEY='changed-after-selection';
    assert.equal(api.get().BREVO_API_KEY,valid().BREVO_API_KEY);
    assert.ok(inspectConfiguration(api.get(),{effectiveEnv:env}).issues.some(issue => issue.variable === 'BREVO_API_KEY' && issue.issue === 'differs_from_selected_environment'));
});
test('production runtime missing secrets stay missing after default dotenv fills process variables', () => {
    const env={...valid(),NODE_ENV:'production'}; delete env.ADMIN_BOOTSTRAP_SECRET;
    const api=createEnvironment({env,argv:[]}); env.ADMIN_BOOTSTRAP_SECRET='borrowed-main-secret';
    assert.equal(api.kind,'runtime'); assert.equal(api.get().ADMIN_BOOTSTRAP_SECRET,undefined);
    const worker=createEnvironment({env:{...env},argv:[]}); assert.equal(worker.get().ADMIN_BOOTSTRAP_SECRET,undefined);
});
test('ordinary development keeps its existing dotenv behavior and does not auto-select staging', () => {
    const env={NODE_ENV:'staging'};
    const source=createEnvironment({env,argv:[],readFile:()=>assert.fail('No file should be selected')});
    Object.assign(env,valid());
    assert.equal(source.kind,'default-dotenv'); assert.equal(source.get().ADMIN_BOOTSTRAP_SECRET,valid().ADMIN_BOOTSTRAP_SECRET);
    assert.equal(inspectConfiguration(source.get()).ready,true);
});
test('unreadable selected environment is an explicit configuration error', () => {
    const env=valid(); const source=createEnvironment({env,argv:['--env-file-if-exists=.env.staging'],readFile:()=>{throw new Error('private file path');}});
    const result=inspectConfiguration(source.get(),{sourceError:source.sourceError});
    assert.equal(result.ready,false); assert.ok(result.issues.some(issue => issue.issue === 'selected_environment_file_unreadable'));
    assert.ok(!JSON.stringify(result).includes('private file path'));
});
test('every required Admin setting rejects missing and placeholder values with safe field names', () => {
    for(const key of [...API_KEYS,'DB_HOST','DB_NAME','DB_USER']) for(const value of ['', 'REPLACE_WITH_PRIVATE_VALUE', 'YOUR_VALUE', '<secret>']) {
        const env={...valid(),[key]:value}; const result=inspectConfiguration(env);
        assert.equal(result.ready,false,key); assert.ok(result.issues.some(issue=>issue.variable===key));
        assert.ok(!JSON.stringify(result).includes('REPLACE_WITH_PRIVATE_VALUE'));
    }
    assert.equal(inspectConfiguration({...valid(),REGISTRATION_OTP_SECRET:'short'}).ready,false);
    assert.equal(inspectConfiguration({...valid(),EMAIL_PROVIDER:'smtp'}).ready,false);
    assert.equal(inspectConfiguration({...valid(),EMAIL_FROM:'sender@example.invalid\r\nBcc: other@example.invalid'}).ready,false);
    assert.equal(inspectConfiguration({...valid(),EMAIL_FROM_NAME:'invalid\nname'}).ready,false);
});
test('worker needs Brevo and database settings but does not use bootstrap or signing secrets', () => {
    const env=valid(); delete env.ADMIN_BOOTSTRAP_SECRET; delete env.REGISTRATION_OTP_SECRET;
    assert.equal(inspectConfiguration(env,{role:'worker'}).ready,true);
    assert.equal(inspectConfiguration(env).ready,false);
});
test('readiness fails before any DB connection on missing config; configuration-only is offline', async () => {
    const connect=()=>assert.fail('Configuration-only check must not open a DB connection');
    const missing=await check({env:{...valid(),EMAIL_FROM_NAME:''},connect});
    assert.equal(missing.ready,false); assert.equal(missing.databaseCheckAttempted,false);
    const placeholders=await check({env:{...valid(),BREVO_API_KEY:'REPLACE_WITH_PRIVATE_KEY'},configurationOnly:true,connect});
    assert.equal(placeholders.ready,false);
    const complete=await check({env:valid(),configurationOnly:true,connect});
    assert.equal(complete.ready,true); assert.equal(complete.databaseCheckAttempted,false);
    for(const value of [valid().BREVO_API_KEY,valid().ADMIN_BOOTSTRAP_SECRET,valid().REGISTRATION_OTP_SECRET,valid().DB_PASS]) assert.ok(!JSON.stringify(complete).includes(value));
});
test('valid config with missing schema or failed connection cannot pass full readiness', async () => {
    let connections=0;
    const report=await check({env:valid(),connect:async()=>{connections++;throw {code:'ECONNREFUSED'};}});
    assert.equal(connections,1); assert.equal(report.ready,false); assert.equal(report.configurationReady,true); assert.equal(report.connectionError,'ECONNREFUSED');
});
test('configuration fingerprint binds mail account, sender and database without returning values', () => {
    const original=valid(); const fingerprint=configurationFingerprint(original);
    assert.match(fingerprint,/^[a-f0-9]{24}$/);
    for(const key of ['BREVO_API_KEY','EMAIL_FROM','EMAIL_FROM_NAME','DB_HOST','DB_PORT','DB_NAME','DB_USER']) assert.notEqual(configurationFingerprint({...original,[key]:'different'}),fingerprint,key);
    assert.equal(configurationFingerprint({...original,ADMIN_BOOTSTRAP_SECRET:'another-secret'}),fingerprint);
});

test('actual API, worker and database entry loaders capture an explicitly selected file before defaults', () => {
    const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
    const {spawnSync}=require('node:child_process');
    const tempRoot=path.resolve(os.tmpdir());
    const directory=fs.mkdtempSync(path.join(tempRoot,'admin-otp-config-'));
    const file=path.join(directory,'.env.staging');
    try {
        const stage=valid();delete stage.ADMIN_BOOTSTRAP_SECRET;fs.writeFileSync(file,dotenvText(stage));
        for(const entry of ['server.js','workers/emailQueueWorker.js','config/database.js']) {
            const program=`
                const fs=require('node:fs'),path=require('node:path');
                const {createRequire}=require('node:module');
                const entry=path.resolve(${JSON.stringify(entry)});
                const source=fs.readFileSync(entry,'utf8');
                const end=source.indexOf(${JSON.stringify(entry==='server.js'?'const express =':entry.startsWith('workers')?'const { Op }':'const isProduction =')});
                if(end<0)throw new Error('Entry boundary missing');
                const localRequire=createRequire(entry);
                new Function('require','__dirname',source.slice(0,end))(localRequire,path.dirname(entry));
                process.env.ADMIN_BOOTSTRAP_SECRET='forbidden-cross-environment-fallback';
                const {environment}=require('./config/adminOtpEnvironment');
                console.log(JSON.stringify({source:environment.kind,missingSecret:environment.get().ADMIN_BOOTSTRAP_SECRET===undefined,brevoPreserved:environment.get().BREVO_API_KEY==='fixture-brevo-rest-key'}));
            `;
            const result=spawnSync(process.execPath,[`--env-file=${file}`,'-e',program],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'development'},encoding:'utf8',timeout:20000});
            assert.equal(result.status,0,entry);
            const report=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
            assert.deepEqual(report,{source:'explicit-file',missingSecret:true,brevoPreserved:true},entry);
        }
        const script=path.resolve(__dirname,'../scripts/checkAdminRegistrationReadiness.js');
        const blocked=spawnSync(process.execPath,[script,'--configuration-only','--env-file',file],{env:process.env,encoding:'utf8',timeout:20000});
        assert.equal(blocked.status,1);assert.equal(JSON.parse(blocked.stdout).ready,false);
        fs.writeFileSync(file,dotenvText(valid()));
        const ready=spawnSync(process.execPath,[script,'--configuration-only','--env-file',file],{env:process.env,encoding:'utf8',timeout:20000});
        assert.equal(ready.status,0);assert.equal(JSON.parse(ready.stdout).ready,true);assert.equal(JSON.parse(ready.stdout).databaseCheckAttempted,false);
    } finally {
        const target=path.resolve(directory);
        if(!target.startsWith(tempRoot+path.sep)||!path.basename(target).startsWith('admin-otp-config-'))throw new Error('Unexpected temporary test path');
        fs.rmSync(target,{recursive:true,force:true});
    }
});
