import test from "node:test";
import process from "node:process";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {build} from "esbuild";
import puppeteer from "puppeteer";

test("employer registration selects/removes up to five files and the admin modal views/downloads every submission",async()=>{
    const root=fileURLToPath(new URL("..",import.meta.url));
    const directory=await mkdtemp(path.join(root,"../../tmp/uploads/permit-browser-"));
    const names=["BIR permit + #.pdf","DTI registration.pdf","SEC certificate.pdf","Branch permit.pdf","Local permit.pdf","Sixth permit.pdf"];
    const paths=[];
    for(const [index,name] of names.entries()){const target=path.join(directory,name);await writeFile(target,`%PDF-1.7 submitted document ${index}`);paths.push(target);}
    const result=await build({stdin:{resolveDir:root,loader:"jsx",contents:`
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import EmployerRegisterPage from './src/pages/EmployerRegisterPage'; import AdminVerificationPage from './src/pages/admin/AdminVerificationPage';
        window.submissions=[]; window.reads=[]; window.posts=[];
        window.fixtureApi={
            post:async(path,form)=>{window.posts.push(path);window.submissions=await Promise.all(form.getAll('business_permit').map(async(file,index)=>({id:String(index+1),name:file.name,mime_type:file.type,size:file.size,body:await file.text(),url:'/api/admin/employer/users/82/business-permits/'+(index+1)})));return{msg:'Registration successful'};},
            get:async()=>[{id:82,name:'Fixture Employer',email:'fixture@example.invalid',role:'employer',account_status:'pending',createdAt:new Date().toISOString(),EmployerProfile:{organization_name:'Fixture Employer',business_permit_documents:window.submissions}}]
        };
        window.fixtureFile=async(url,auth)=>{if(!auth)throw Error('Missing authorization');window.reads.push(url);const id=url.split('/').pop().split('?')[0];const document=window.submissions.find(doc=>doc.id===id);if(!document)throw Error('Document could not be found');return new Blob([document.body],{type:document.mime_type});};
        const root=createRoot(document.getElementById('root'));
        window.showAdmin=()=>{localStorage.setItem('user',JSON.stringify({id:1,role:'admin',admin_scope:'employer'}));localStorage.setItem('token','fixture-token');root.render(<MemoryRouter><AdminVerificationPage role="employer"/></MemoryRouter>);};
        root.render(<MemoryRouter><EmployerRegisterPage/></MemoryRouter>);
    `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"import.meta.env":"{}","process.env.NODE_ENV":'"test"'},plugins:[{name:"fixtures",setup(builder){
        builder.onResolve({filter:/\.css$/},()=>({path:"css",namespace:"css"}));builder.onLoad({filter:/.*/,namespace:"css"},()=>({contents:"export default {};"}));
        builder.onResolve({filter:/\/services\/api$/},()=>({path:"api",namespace:"api"}));builder.onLoad({filter:/.*/,namespace:"api"},()=>({contents:"export const API_BASE_URL='http://fixture/api';export const api={get:(...args)=>window.fixtureApi.get(...args),post:(...args)=>window.fixtureApi.post(...args)};export const fetchFile=(...args)=>window.fixtureFile(...args);"}));
    }}],logLevel:"silent"});
    const bundle=result.outputFiles[0].text;
    const server=createServer((req,res)=>{if(req.url==="/bundle.js"){res.setHeader("Content-Type","text/javascript");res.end(bundle);}else res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');}).listen(0,"127.0.0.1");
    await new Promise(resolve=>server.once("listening",resolve));
    let browser;
    try{
        browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH});
        const page=await browser.newPage();
        const errors=[];page.on("pageerror",error=>errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForSelector('input[type="file"]');
        const input=await page.$('input[type="file"]');
        assert.equal(await input.evaluate(element=>element.multiple),true);
        await input.uploadFile(...paths);
        await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('up to five'));
        assert.equal(await page.$$eval('[aria-label="Selected business permit documents"] li',items=>items.length),0);
        await input.uploadFile(...paths.slice(0,5));
        await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Selected business permit documents"] li').length===5);
        await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Remove SEC certificate.pdf').click());
        await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Selected business permit documents"] li').length===4);
        await input.uploadFile(paths[2]);
        await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Selected business permit documents"] li').length===5);
        await page.type('input[name="name"]','Fixture Employer');await page.type('input[name="email"]','fixture@example.invalid');await page.type('input[name="companyAddress"]','Fixture Address');await page.type('input[name="password"]','Valid-password-123');
        await page.type('input[name="confirmPassword"]','Valid-password-123');
        await page.click('.consent-row .highlight-link');
        await page.waitForSelector('.consent-body');
        await page.$eval('.consent-body',element=>{element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
        await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='I Understand & Agree'&&!button.disabled));
        await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='I Understand & Agree').click());
        await page.click('input[name="consent"]');
        await page.click('button[type="submit"]');
        await page.waitForFunction(()=>window.submissions.length===5);
        const submitted=await page.evaluate(()=>window.submissions);
        assert.deepEqual(submitted.map(document=>document.name),[names[0],names[1],names[3],names[4],names[2]]);
        assert.deepEqual(submitted.map(document=>document.body),[0,1,3,4,2].map(index=>`%PDF-1.7 submitted document ${index}`));
        await page.evaluate(()=>window.showAdmin());
        await page.waitForFunction(()=>[...document.querySelectorAll('details button')].some(button=>button.textContent==='View'));
        await page.evaluate(()=>[...document.querySelectorAll('details button')].find(button=>button.textContent==='View').click());
        await page.waitForSelector('[aria-label="Business Permit Documents"]');
        assert.equal(await page.$$eval('[aria-label="Business Permit Documents"] li',items=>items.length),5);
        assert.equal(await page.evaluate(()=>document.body.textContent.includes('Upload replacement business permit')),false);
        assert.equal(await page.evaluate(()=>document.querySelectorAll('.modal input[type="file"]').length),0);
        for(const document of submitted){
            await page.evaluate(name=>[...window.document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='View '+name).click(),document.name);
            await page.waitForFunction(name=>window.document.querySelector('iframe')?.title===name,{},document.name);
            assert.equal(await page.$eval('iframe',element=>element.src.startsWith('blob:')),true);
            await page.evaluate(()=>{const modals=window.document.querySelectorAll('.modal');modals[modals.length-1].querySelector('.btn-close').click();});
            await page.waitForFunction(()=>!window.document.querySelector('iframe'));
            await page.evaluate(name=>[...window.document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Download '+name).click(),document.name);
            await page.waitForFunction(url=>window.reads.includes(url+'?download=1'),{},document.url);
        }
        assert.equal(await page.evaluate(()=>window.posts.length),1);
        assert.deepEqual(errors,[]);
    }finally{
        if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
        assert.ok(path.resolve(directory).startsWith(path.resolve(root,"../../tmp/uploads")+path.sep));
        await rm(directory,{recursive:true,force:true});
    }
});
