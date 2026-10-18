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
    const nativeFetch = global.fetch;
    let user = null, profile = null, rejectSave = false;
    let uploads = 0;
    const cloudFiles = new Map();
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
    global.fetch = async (url, options) => {
        const address = String(url);
        if (address.startsWith("https://api.cloudinary.com/") && address.includes("/download?")) {
            const request = new URL(address);
            assert.match(request.pathname, /\/(image|raw)\/download$/);
            assert.equal(request.searchParams.get("type"), "authenticated");
            assert.ok(request.searchParams.get("api_key"));
            assert.ok(request.searchParams.get("signature"));
            const id = request.searchParams.get("public_id");
            const file = cloudFiles.get(id);
            return file
                ? new Response(file.bytes, { status: 200, headers: { "Content-Type": file.type } })
                : new Response("missing", { status: 404 });
        }
        if (address.startsWith("https://api.cloudinary.com/") && address.endsWith("/upload")) {
            uploads++;
            assert.equal(options.body.get("type"), "authenticated");
            const id = options.body.get("public_id");
            const file = options.body.get("file");
            cloudFiles.set(id, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type });
            const resource = address.includes("/image/") ? "image" : "raw";
            return { ok: true, json: async () => ({ public_id: id, resource_type: resource, type: "authenticated", secure_url: `https://res.cloudinary.com/permit-fixture/${resource}/authenticated/v1/${id}` }) };
        }
        return nativeFetch(url, options);
    };
    const app = express();
    app.post("/register", registrationUpload, auth.register);
    app.get("/api/files/secure/:token", authentication, files.getSecureStoredFile);
    app.get("/api/files/:folder/:fileName", authentication, files.getSecureFile);
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
        for (const [bytes,type,name] of [[Buffer.from([137,80,78,71,13,10,26,10]),"image/png","permit.png"], [Buffer.from("%PDF-1.7 fixture"),"application/pdf","permit.pdf"]]) {
            const response = await fetch(`${base}/register`, { method: "POST", body: form(bytes,type,name) });
            assert.equal(response.status, 201, await response.text());
            assert.match(profile.business_permit_path, /^cld:/);
            assert.ok(profile.business_permit_path.length > 255);
            const listed = await (await fetch(`${base}/admin/employers`, { headers: adminHeaders })).json();
            const path = listed[0].EmployerProfile.business_permit_path;
            assert.equal(listed[0].EmployerProfile.business_permit_name, name);
            const preview = await fetch(`${base}${path}`, { headers: adminHeaders });
            assert.equal(preview.status,200); assert.equal(preview.headers.get("content-type").split(";")[0],type);
            assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);
            for (const claims of [null,{id:82,role:"employer"},{id:2,role:"admin",admin_scope:"alumni"}]) {
                const denied = await fetch(`${base}${path}`, { headers: claims ? headers(claims) : {} });
                assert.ok([401,403].includes(denied.status));
            }
        }
        for (const count of [1,2,3,4,5]) {
            const body = form(Buffer.from("%PDF-1.7 first"), "application/pdf", "BIR permit + # résumé.pdf");
            for (let index=1; index<count; index++) body.append("business_permit",new Blob([Buffer.from([0xff,0xd8,0xff,0xe0,index])],{type:"image/jpeg"}),`DTI document ${index}.jpeg`);
            const registered = await fetch(`${base}/register`,{method:"POST",body});
            assert.equal(registered.status,201,await registered.clone().text());
            const stored = JSON.parse(profile.business_permit_documents);
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
                    const reference=require("../services/objectStorage").parseStoredFileReference(stored[index].storage_ref);
                    assert.deepEqual(Buffer.from(await result.arrayBuffer()),cloudFiles.get(reference.publicId).bytes);
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
        for (const [bytes,type,name,expected] of [[Buffer.from("invalid"),"image/png","fake.png",415],[Buffer.alloc(2*1024*1024),"application/pdf","huge.pdf",413],[Buffer.from("text"),"text/plain","file.txt",415],[Buffer.from("%PDF-1.7 disguised"),"image/jpeg","wrong.jpg",415],[Buffer.from("%PDF-1.7"),"application/pdf","wrong.png",415],[Buffer.from("GIF89a"),"image/gif","not-allowed.gif",415],[Buffer.from("%PDF-1.7"),"application/pdf","permit.pdf.exe",415]]) {
            const response = await fetch(`${base}/register`, { method:"POST",body:form(bytes,type,name) }); assert.equal(response.status,expected);
        }
        rejectSave = true;
        const failed = await fetch(`${base}/register`,{method:"POST",body:form(Buffer.from("%PDF-1.7"),"application/pdf","failure.pdf")});
        assert.equal(failed.status,500); assert.match((await failed.json()).msg,/could not be saved/);
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
        const before = uploads;
        const denied = await fetch(`${base}/admin/employers/82/permit`,{method:"PUT",headers:headers({id:82,role:"employer"}),body:form(Buffer.from("%PDF-1.7"),"application/pdf","no.pdf",false)});
        assert.equal(denied.status,403); assert.equal(uploads,before);
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
    } finally {
        await new Promise(resolve => server.close(resolve));
        await fs.unlink(legacyDiskPath).catch(error => { if(error.code !== "ENOENT") throw error; });
        global.fetch = nativeFetch;
        for (const [object,key,value] of saved) object[key]=value;
    }
});
