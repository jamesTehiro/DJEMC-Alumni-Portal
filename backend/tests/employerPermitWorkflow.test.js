const test = require("node:test");
const assert = require("node:assert/strict");
process.env.OBJECT_STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "permit-fixture";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
process.env.JWT_SECRET = "permit-test-secret";
process.env.MAX_UPLOAD_MB = "1";
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("node:fs/promises");
const fsSystem = require("node:fs");
const path = require("node:path");
const db = require("../models");
const { registrationUpload, employerRegistrationUpload } = require("../middleware/uploadMiddleware");
const auth = require("../controllers/authController");
const files = require("../controllers/fileController");
const admin = require("../controllers/adminController");
const permits = require("../controllers/employerPermitController");
const authentication = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const scope = require("../middleware/adminScopeMiddleware");
test.after(() => db.sequelize.close());

test("multipart permit registration, admin preview/replacement, validation and persistence failure", async () => {
    const saved = [];
    const override = (object, key, value) => { saved.push([object, key, object[key]]); object[key] = value; };
    let user = null, profile = null, rejectSave = false;
    const createdPermitPaths = new Set();
    const makeProfile = () => ({ business_permit_path: null, update: async function(values) { if (!rejectSave) Object.assign(this, values); }, reload: async function() { return this; } });
    override(db.User, "findOne", async () => null);
    override(db.User, "create", async values => { user = { id: 82, account_status: "pending", ...values }; profile = makeProfile(); return user; });
    override(db.User, "findByPk", async () => user);
    override(db.User, "findAll", async () => [{ id: user.id, toJSON: () => ({ ...user, EmployerProfile: { business_permit_path: profile.business_permit_path, business_permit_documents: profile.business_permit_documents } }) }]);
    override(db.EmployerProfile, "findOrCreate", async () => [profile, false]);
    override(db.EmployerProfile, "findOne", async options => {
        if (options.where.user_id) return profile;
        const values = options.where.business_permit_path?.[db.Sequelize.Op.in] || [options.where.business_permit_path];
        return values.includes(profile?.business_permit_path) ? profile : null;
    });
    override(db.EmployerProfile, "findAll", async () => []);
    override(db.Application, "findOne", async () => null);
    override(db.AlumniProfile, "findOne", async () => null);
    override(db.AuditLog, "findAll", async () => []);
    override(db.sequelize, "transaction", async callback => {
        const beforeUser = user, beforeProfile = profile;
        try { return await callback({ LOCK: { UPDATE: "UPDATE" } }); }
        catch (error) { user = beforeUser; profile = beforeProfile; throw error; }
    });
    const app = express();
    app.post("/register", registrationUpload, auth.register);
    app.get("/api/files/secure/:token", authentication, files.getSecureStoredFile);
    app.get("/api/files/:folder/:fileName", authentication, files.getSecureFile);
    app.get("/uploads/:fileName", files.getPublicImage);
    app.get("/admin/employers", authentication, role("admin"), scope("employer"), admin.getEmployerUsers);
    app.get("/api/admin/employer/users/:userId/business-permits/:documentId", authentication, role("admin"), scope("employer"), permits.getDocument);
    app.put("/admin/employers/:userId/permit", authentication, role("admin"), scope("employer"), employerRegistrationUpload, permits.replacePermit);
    app.use((error, _req, res, _next) => res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.code === "LIMIT_UNEXPECTED_FILE" ? 400 : error.status || 500).json({ msg: error.code === "LIMIT_FILE_SIZE" ? "File is too large." : error.publicMessage || error.message }));
    const server = await new Promise(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = claims => ({ Authorization: `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}` });
    const adminHeaders = headers({ id: 1, role: "admin", admin_scope: "employer" });
    const form = (bytes, type, name, registration = true) => {
        const form = new FormData();
        if (registration) for (const [key,value] of Object.entries({ name: "Fixture Employer", email: "permit@example.invalid", password: "test-password", role: "employer" })) form.append(key,value);
        form.append("business_permit", new Blob([bytes], { type }), name); return form;
    };
    const legacyName = `permit-test-${process.pid}-${Date.now()}.pdf`;
    const legacyDiskPath = path.join(__dirname,"..","uploads","documents",legacyName);
    try {
        const originalMkdir = fsSystem.promises.mkdir;
        fsSystem.promises.mkdir = async (target, ...args) => {
            if (path.resolve(target) === path.join(__dirname,"..","uploads","business-permits")) throw new Error("simulated disk failure");
            return originalMkdir.call(fsSystem.promises,target,...args);
        };
        try {
            const unavailable = await fetch(`${base}/register`,{method:"POST",body:form(Buffer.from("%PDF-1.7 storage error"),"application/pdf","storage-error.pdf")});
            assert.equal(unavailable.status,503);
            assert.match((await unavailable.json()).msg,/Business permit storage is unavailable/);
        } finally { fsSystem.promises.mkdir = originalMkdir; }

        for (const [bytes,type,name] of [[Buffer.from([137,80,78,71,13,10,26,10]),"image/png","permit.png"], [Buffer.from("%PDF-1.7 fixture"),"application/pdf","permit.pdf"]]) {
            const response = await fetch(`${base}/register`, { method: "POST", body: form(bytes,type,name) });
            assert.equal(response.status, 201, await response.text());
            assert.match(profile.business_permit_path, /^\/uploads\/business-permits\/business-permit-[0-9a-f-]+\.(pdf|png)$/);
            createdPermitPaths.add(profile.business_permit_path);
            assert.deepEqual(await fs.readFile(path.join(__dirname,"..","uploads",profile.business_permit_path.slice("/uploads/".length))),bytes);
            const listed = await (await fetch(`${base}/admin/employers`, { headers: adminHeaders })).json();
            const previewPath = listed[0].EmployerProfile.business_permit_path;
            assert.equal(listed[0].EmployerProfile.business_permit_name, name);
            const preview = await fetch(`${base}${previewPath}`, { headers: adminHeaders });
            assert.equal(preview.status,200); assert.equal(preview.headers.get("content-type").split(";")[0],type);
            assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);
            assert.equal((await fetch(`${base}${profile.business_permit_path}`)).status,404);
            for (const claims of [null,{id:82,role:"employer"},{id:2,role:"admin",admin_scope:"alumni"}]) {
                const denied = await fetch(`${base}${previewPath}`, { headers: claims ? headers(claims) : {} });
                assert.ok([401,403].includes(denied.status));
            }
        }
        for (const count of [1,2,3,4,5]) {
            const body = form(Buffer.from("%PDF-1.7 first"), "application/pdf", "BIR permit + # résumé.pdf");
            for (let index=1; index<count; index++) body.append("business_permit",new Blob([Buffer.from([0xff,0xd8,0xff,0xe0,index])],{type:"image/jpeg"}),`DTI document ${index}.jpeg`);
            const registered = await fetch(`${base}/register`,{method:"POST",body});
            assert.equal(registered.status,201,await registered.clone().text());
            const stored = JSON.parse(profile.business_permit_documents);
            stored.forEach(document=>createdPermitPaths.add(document.storage_ref));
            assert.equal(stored.length,count);
            assert.equal(profile.business_permit_path,stored[0].storage_ref);
            assert.equal(user.account_status,"pending");
            const listed = await (await fetch(`${base}/admin/employers`,{headers:adminHeaders})).json();
            const documents = listed[0].EmployerProfile.business_permit_documents;
            assert.equal(documents.length,count);
            assert.equal(documents[0].name,"BIR permit + # résumé.pdf");
            assert.equal(JSON.stringify(documents).includes("cld:"),false);
            assert.equal(JSON.stringify(documents).includes("res.cloudinary.com"),false);
            for (const [index,document] of documents.entries()) {
                assert.equal(document.name,stored[index].name);
                for (const download of [false,true]) {
                    const result=await fetch(`${base}${document.url}${download?"?download=1":""}`,{headers:adminHeaders});
                    assert.equal(result.status,200);
                    assert.match(stored[index].storage_ref,/^\/uploads\/business-permits\/business-permit-[0-9a-f-]+\.(pdf|jpe?g)$/);
                    assert.deepEqual(Buffer.from(await result.arrayBuffer()),await fs.readFile(path.join(__dirname,"..","uploads",stored[index].storage_ref.slice("/uploads/".length))));
                    assert.match(result.headers.get("content-disposition"),download?/^attachment;/:/^inline;/);
                    assert.equal(result.headers.get("cache-control"),"private, no-store");
                }
            }
            for (const claims of [null,{id:82,role:"employer"},{id:99,role:"alumni"},{id:2,role:"admin",admin_scope:"alumni"},{id:3,role:"admin",admin_scope:"registrar"}]) {
                const denied=await fetch(`${base}${documents[count-1].url}`,{headers:claims?headers(claims):{}});
                assert.ok([401,403].includes(denied.status));
            }
            assert.equal(user.account_status,"pending");
        }
        const tooMany=form(Buffer.from("%PDF-1.7 first"),"application/pdf","first.pdf");
        for(let index=1;index<6;index++) tooMany.append("business_permit",new Blob(["%PDF-1.7 extra"],{type:"application/pdf"}),`extra-${index}.pdf`);
        assert.equal((await fetch(`${base}/register`,{method:"POST",body:tooMany})).status,400);
        const noPermit=new FormData();
        for(const [key,value] of Object.entries({name:"Missing Permit",email:"missing@example.invalid",password:"test-password",role:"employer"})) noPermit.append(key,value);
        assert.equal((await fetch(`${base}/register`,{method:"POST",body:noPermit})).status,400);
        const permitFilesBeforeInvalid = await fs.readdir(path.join(__dirname,"..","uploads","business-permits"));
        for (const [bytes,type,name,expected] of [[Buffer.from("invalid"),"image/png","fake.png",415],[Buffer.alloc(2*1024*1024),"application/pdf","huge.pdf",413],[Buffer.from("text"),"text/plain","file.txt",415],[Buffer.from("%PDF-1.7 disguised"),"image/jpeg","wrong.jpg",415],[Buffer.from("%PDF-1.7"),"application/pdf","wrong.png",415],[Buffer.from("GIF89a"),"image/gif","not-allowed.gif",415],[Buffer.from("%PDF-1.7"),"application/pdf","permit.pdf.exe",415]]) {
            const response = await fetch(`${base}/register`, { method:"POST",body:form(bytes,type,name) }); assert.equal(response.status,expected);
        }
        assert.deepEqual(await fs.readdir(path.join(__dirname,"..","uploads","business-permits")),permitFilesBeforeInvalid);
        const traversal = await fetch(`${base}/register`,{method:"POST",body:form(Buffer.from("%PDF-1.7 traversal"),"application/pdf","../../outside.pdf")});
        assert.equal(traversal.status,201,await traversal.clone().text());
        createdPermitPaths.add(profile.business_permit_path);
        assert.match(profile.business_permit_path,/^\/uploads\/business-permits\/business-permit-[0-9a-f-]+\.pdf$/);
        assert.equal(JSON.parse(profile.business_permit_documents)[0].name,"outside.pdf");
        assert.ok((await fs.readFile(path.join(__dirname,"..","uploads",profile.business_permit_path.slice("/uploads/".length)))).toString().startsWith("%PDF-1.7"));
        rejectSave = true;
        const filesBeforeFailedSave = await fs.readdir(path.join(__dirname,"..","uploads","business-permits"));
        const failed = await fetch(`${base}/register`,{method:"POST",body:form(Buffer.from("%PDF-1.7"),"application/pdf","failure.pdf")});
        assert.equal(failed.status,500); assert.match((await failed.json()).msg,/could not be saved/);
        await new Promise(resolve=>setTimeout(resolve,25));
        assert.deepEqual(await fs.readdir(path.join(__dirname,"..","uploads","business-permits")),filesBeforeFailedSave);
        rejectSave = false;
        profile.business_permit_documents = null;
        const oldUser = user;
        const originalReference = profile.business_permit_path;
        const replacement = await fetch(`${base}/admin/employers/82/permit`,{method:"PUT",headers:adminHeaders,body:form(Buffer.from("%PDF-1.7 replacement"),"application/pdf","replacement.pdf",false)});
        assert.equal(replacement.status,200); assert.equal(user,oldUser); assert.equal(user.account_status,"pending");
        assert.equal(profile.business_permit_path,originalReference);
        assert.ok(JSON.parse(profile.business_permit_documents).some(document=>document.storage_ref===originalReference));
        const savedPermits=await replacement.json();
        assert.match(savedPermits.business_permit_path,/^\/api\/admin\/employer\/users\/82\/business-permits\//);
        assert.equal(JSON.stringify(savedPermits).includes("cld:"),false);
        JSON.parse(profile.business_permit_documents).forEach(document=>createdPermitPaths.add(document.storage_ref));
        const denied = await fetch(`${base}/admin/employers/82/permit`,{method:"PUT",headers:headers({id:82,role:"employer"}),body:form(Buffer.from("%PDF-1.7"),"application/pdf","no.pdf",false)});
        assert.equal(denied.status,403);
        await fs.mkdir(path.dirname(legacyDiskPath),{recursive:true});
        await fs.writeFile(legacyDiskPath,"%PDF-1.7 legacy fixture",{flag:"wx"});
        profile.business_permit_path = `/api/files/documents/${legacyName}`;
        const legacy = await fetch(`${base}${profile.business_permit_path}`,{headers:adminHeaders});
        assert.equal(legacy.status,200);
        assert.equal(await legacy.text(),"%PDF-1.7 legacy fixture");
        assert.equal(profile.business_permit_path,`/api/files/documents/${legacyName}`);
        const listed = await (await fetch(`${base}/admin/employers`,{headers:adminHeaders})).json();
        const original = listed[0].EmployerProfile.business_permit_documents.find(document=>document.id==="original");
        assert.ok(original);
        const originalResponse=await fetch(`${base}${original.url}`,{headers:adminHeaders});
        assert.equal(originalResponse.status,200);
        assert.equal(await originalResponse.text(),"%PDF-1.7 legacy fixture");
        profile.business_permit_path="/uploads/documents/permit-does-not-exist.pdf";
        profile.business_permit_documents=null;
        const missing=await fetch(`${base}/api/admin/employer/users/82/business-permits/original`,{headers:adminHeaders});
        assert.equal(missing.status,404);
        assert.match((await missing.json()).msg,/could not be found/);
        profile.business_permit_path="/uploads/business-permits/../../server.js";
        const traversalPreview=await fetch(`${base}/api/admin/employer/users/82/business-permits/original`,{headers:adminHeaders});
        assert.equal(traversalPreview.status,404);
    } finally {
        await new Promise(resolve => server.close(resolve));
        await fs.unlink(legacyDiskPath).catch(error => { if(error.code !== "ENOENT") throw error; });
        await Promise.all([...createdPermitPaths].map(reference=>fs.unlink(path.join(__dirname,"..","uploads",reference.slice("/uploads/".length))).catch(error=>{if(error.code!=="ENOENT")throw error;})));
        for (const [object,key,value] of saved) object[key]=value;
    }
});
