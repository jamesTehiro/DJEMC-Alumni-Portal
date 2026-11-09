const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
process.env.OBJECT_STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "permit-fixture";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
const db = require("../models");
const migration = require("../migrations/20261018-add-employer-permit-documents");
const { readPermitDocuments, permitDocumentPayload } = require("../services/employerPermitDocuments");
const { recoverPermitStoredFileReference, parseStoredFileReference, privateDownloadSourceUrl, sendStoredFile } = require("../services/objectStorage");
const { employerRegistrationUpload } = require("../middleware/uploadMiddleware");
const controller = require("../controllers/employerPermitController");
const admin = require("../controllers/adminController");
const auth = require("../controllers/authController");
const { employerOtp, otp: registrationOtp } = require("../controllers/registrationOtpController");
const express = require("express");
test.after(() => db.sequelize.close());

test("multi-permit migration widens legacy storage, adds metadata once, and never rewrites rows", async () => {
    const columns = { business_permit_path: { type: "VARCHAR(255)" } };
    const row = { table_name: "employerprofiles", column_name: "business_permit_path", data_type: "varchar", is_nullable: "YES", column_default: null, column_comment: "", character_set: "utf8mb4", collation: "utf8mb4_general_ci", extra: "", maximum_length: 255 };
    const statements = [], added = [];
    const qi = {
        describeTable: async () => columns,
        showIndex: async () => [], queryGenerator: { quoteIdentifier: name => `\`${name}\`` },
        addColumn: async (table, name, definition) => { assert.equal(table,"employerprofiles"); assert.equal(definition.allowNull,true); added.push(name); columns[name] = { type: "TEXT" }; },
        sequelize: { escape: () => "''", query: async sql => { if(sql.startsWith("SELECT")) return [row]; statements.push(sql); row.data_type="text"; columns.business_permit_path.type="TEXT"; } }
    };
    await migration.up(qi,db.Sequelize);
    await migration.up(qi,db.Sequelize);
    assert.deepEqual(added,["business_permit_documents"]);
    assert.equal(statements.length,1);
    assert.match(statements[0],/^ALTER TABLE/);
    columns.business_permit_documents.type="VARCHAR(255)";
    await assert.rejects(migration.up(qi,db.Sequelize),/manual review/);
    await assert.rejects(migration.down(),/Refusing/);
});

test("legacy and multiple references become document URLs without exposing storage metadata", () => {
    const profile = { business_permit_path: "C:\\old\\uploads\\documents\\BIR permit.pdf" };
    assert.equal(readPermitDocuments(profile)[0].name,"BIR permit.pdf");
    assert.deepEqual(permitDocumentPayload(null,82),[]);
    profile.business_permit_documents=JSON.stringify([{storage_ref:profile.business_permit_path,name:"BIR permit.pdf",mime_type:"application/pdf",size:42},{storage_ref:"cld:private-reference",name:"DTI.png",mime_type:"image/png",size:52}]);
    const result=permitDocumentPayload(profile,82);
    assert.equal(result.length,2);
    assert.deepEqual(result.map(doc=>doc.url),["/api/admin/employer/users/82/business-permits/1","/api/admin/employer/users/82/business-permits/2"]);
    assert.equal(JSON.stringify(result).includes("storage_ref"),false);
    assert.equal(JSON.stringify(result).includes("cld:"),false);
    assert.ok(db.EmployerProfile.options.defaultScope.attributes.exclude.includes("business_permit_documents"));
    assert.throws(()=>readPermitDocuments({business_permit_documents:"broken JSON"}),/could not be read/);
});

test("permit uploads save exact Cloudinary references and admin preview retrieves supported private formats", async () => {
    const app = express();
    const profile = { user_id: 82, business_permit_path: null, business_permit_documents: null };
    const overrides = [];
    const stub = (object, key, value) => { overrides.push([object, key, object[key]]); object[key] = value; };
    const user = { id: 82, name: "Permit fixture", email: "permit.fixture@gmail.com", role: "employer", account_status: "pending" };
    Object.assign(profile, {
        update(values) { Object.assign(this, values); return Promise.resolve(this); },
        async reload() { return this; }
    });
    stub(db.User, "create", async () => user);
    stub(db.User, "findByPk", async id => Number(id) === 82 ? { id: 82, role: "employer" } : null);
    stub(db.EmployerProfile, "findOne", async ({ where }) => Number(where.user_id) === 82 ? profile : null);
    stub(db.EmployerProfile, "findOrCreate", async () => [profile, false]);
    stub(db.sequelize, "transaction", async callback => callback({}));
    stub(employerOtp, "consume", async () => ({ verified_at: new Date(), update: async () => {} }));
    stub(registrationOtp, "findAccount", async () => null);
    app.post("/register", employerRegistrationUpload, auth.register);
    app.get("/api/admin/employer/users/:userId/business-permits/:documentId", (req, _res, next) => {
        req.user = { id: 1, role: "admin", admin_scope: "employer" };
        next();
    }, controller.getDocument);
    const server = await new Promise(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const originalFetch = global.fetch;
    const uploaded = [];
    const bytesByPublicId = new Map();
    global.fetch = async (url, options) => {
        if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, options);
        const requestUrl = new URL(String(url));
        if (requestUrl.hostname === "api.cloudinary.com" && requestUrl.pathname.endsWith("/upload")) {
            const resourceType = requestUrl.pathname.includes("/raw/") ? "raw" : "image";
            const form = options.body;
            const publicId = form.get("public_id");
            const file = form.get("file");
            const format = path.extname(file.name).slice(1).replace(/^jpeg$/, "jpg");
            assert.equal(form.get("type"), "authenticated");
            if (resourceType === "image") assert.doesNotMatch(publicId, /\.(?:png|jpe?g)$/i);
            else assert.match(publicId, /\.pdf$/i);
            const bytes = Buffer.from(await file.arrayBuffer());
            bytesByPublicId.set(publicId, { bytes, contentType: file.type, resourceType, format });
            uploaded.push({ resourceType, publicId, format });
            const deliveryPath = resourceType === "image" ? `${publicId}.${format}` : publicId;
            return Response.json({
                secure_url: `https://res.cloudinary.com/permit-fixture/${resourceType}/authenticated/v1/${deliveryPath}`,
                public_id: publicId,
                resource_type: resourceType,
                type: "authenticated",
                format
            });
        }
        if (requestUrl.hostname === "api.cloudinary.com" && requestUrl.pathname.endsWith("/download")) {
            const publicId = requestUrl.searchParams.get("public_id");
            const asset = bytesByPublicId.get(publicId);
            assert.ok(asset, "Preview must request the exact public ID saved in the permit reference.");
            assert.equal(requestUrl.searchParams.get("type"), "authenticated");
            assert.equal(requestUrl.searchParams.get("format"), asset.format);
            assert.equal(requestUrl.pathname, `/v1_1/permit-fixture/${asset.resourceType}/download`);
            return new Response(asset.bytes, { headers: { "Content-Type": asset.contentType, "Content-Length": String(asset.bytes.length) } });
        }
        assert.match(String(url), /^https:\/\/api\.cloudinary\.com\/v1_1\/permit-fixture\/(?:raw|image)\/upload$/);
        throw new Error("Unexpected Cloudinary request.");
    };
    try {
        const form = new FormData();
        form.append("name", user.name);
        form.append("email", user.email);
        form.append("password", "fixture-password");
        form.append("role", "employer");
        form.append("business_permit", new Blob([Buffer.from("%PDF-1.7 fixture")], { type: "application/pdf" }), "BIR permit.pdf");
        form.append("business_permit", new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "DTI.png");
        form.append("business_permit", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), "DTI.jpg");
        form.append("business_permit", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), "SEC.jpeg");
        const base = `http://127.0.0.1:${server.address().port}`;
        const response = await fetch(`${base}/register`, { method: "POST", body: form });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).user.id, 82);
        const documents = permitDocumentPayload(profile, profile.user_id);
        assert.equal(documents.length, 4);
        assert.equal(uploaded.length, 4);
        assert.deepEqual(documents.map(document => document.name), ["BIR permit.pdf", "DTI.png", "DTI.jpg", "SEC.jpeg"]);
        const stored = JSON.parse(profile.business_permit_documents);
        assert.deepEqual(documents.map(document => document.url), stored.map((_document, index) => `/api/admin/employer/users/82/business-permits/${index + 1}`));
        assert.equal(profile.business_permit_path, stored[0].storage_ref);
        for (const [index, document] of documents.entries()) {
            const savedReference = stored[index].storage_ref;
            const reference = parseStoredFileReference(savedReference);
            assert.equal(savedReference, `cld:${Buffer.from(JSON.stringify(reference), "utf8").toString("base64url")}`);
            assert.equal(reference.provider, "cloudinary");
            assert.equal(reference.type, "authenticated");
            assert.equal(reference.resourceType, index === 0 ? "raw" : "image");
            assert.equal(reference.publicId, uploaded[index].publicId);
            assert.ok(reference.publicId.startsWith("private_uploads/business_permits/business-permit-"));
            for (const download of [false, true]) {
                const preview = await fetch(`${base}${document.url}${download ? "?download=1" : ""}`);
                assert.equal(preview.status, 200);
                assert.equal(preview.headers.get("content-type").split(";")[0], stored[index].mime_type);
                assert.equal(preview.headers.get("cache-control"), "private, no-store");
                assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
                assert.match(preview.headers.get("content-disposition"), download ? /^attachment;/ : /^inline;/);
                assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytesByPublicId.get(reference.publicId).bytes);
            }
            assert.equal(stored[index].size, index === 0 ? 16 : index === 1 ? 8 : 4);
        }
    } finally {
        global.fetch = originalFetch;
        await new Promise(resolve => server.close(resolve));
        for (const [object, key, value] of overrides) object[key] = value;
    }
});

test("employer verification endpoint selects permit metadata and returns all status groups", async () => {
    const overrides=[];
    const stub=(object,key,value)=>{overrides.push([object,key,object[key]]);object[key]=value;};
    const statuses=["pending","verified","rejected"];
    const users=statuses.map((account_status,index)=>({
        id:82+index, account_status,
        toJSON:()=>({id:82+index,account_status,EmployerProfile:{business_permit_path:`/uploads/documents/permit-${index}.pdf`}})
    }));
    let query;
    stub(db.User,"findAll",async options=>{query=options;return users;});
    stub(db.AuditLog,"findAll",async()=>[]);
    try {
        const response={json(body){this.body=body;return this;},status(code){this.code=code;return this;}};
        await admin.getEmployerUsers({},response);
        assert.equal(response.code,undefined);
        assert.deepEqual(response.body.map(user=>user.account_status),statuses);
        assert.deepEqual(response.body.map(user=>user.EmployerProfile.business_permit_documents[0].url),[
            "/api/admin/employer/users/82/business-permits/original",
            "/api/admin/employer/users/83/business-permits/original",
            "/api/admin/employer/users/84/business-permits/original"
        ]);
        assert.equal(query.include[0].attributes.include.includes("business_permit_documents"),true);
    } finally {for(const [object,key,value] of overrides)object[key]=value;}
});

test("truncated permit recovery verifies an existing provider asset and fails safely for lost identifiers", async () => {
    const payload={provider:"cloudinary",resourceType:"raw",type:"authenticated",publicId:"private_uploads/business_permits/business-permit-123.pdf",url:"https://res.cloudinary.com/permit-fixture/raw/authenticated/v1/private_uploads/business_permits/business-permit-123.pdf"};
    const reference=`cld:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`.slice(0,255);
    const originalFetch=global.fetch;
    let calls=0;
    global.fetch=async (url,options)=>{
        calls++;
        assert.ok(String(url).includes("/resources/raw/authenticated/"));
        assert.match(options.headers.Authorization,/^Basic /);
        return Response.json({public_id:payload.publicId,secure_url:payload.url,resource_type:"raw",type:"authenticated"});
    };
    try {
        const recovered=await recoverPermitStoredFileReference(reference);
        assert.equal(parseStoredFileReference(recovered).url,payload.url);
        assert.equal(readPermitDocuments({business_permit_path:reference})[0].mime_type,"application/pdf");
        assert.equal(await recoverPermitStoredFileReference(reference.slice(0,115)),null);
        assert.equal(calls,1);
        global.fetch=async()=>new Response("missing",{status:404});
        assert.equal(await recoverPermitStoredFileReference(reference),null);
    } finally {global.fetch=originalFetch;}
});

test("private permit download uses Cloudinary image IDs without extensions and permits supported formats", () => {
    const makeReference = (resourceType, type, publicId, format) => `cld:${Buffer.from(JSON.stringify({
        provider:"cloudinary",resourceType,type,publicId,format,
        url:`https://res.cloudinary.com/permit-fixture/${resourceType}/${type}/v1/${resourceType === "image" ? `${publicId}.${format}` : publicId}`
    })).toString("base64url")}`;
    for (const [resourceType, publicId, format] of [
        ["raw","private_uploads/business_permits/permit.pdf","pdf"],
        ["image","private_uploads/business_permits/permit-png","png"],
        ["image","private_uploads/business_permits/permit-jpg","jpg"],
        ["image","private_uploads/business_permits/permit-jpeg","jpg"]
    ]) {
        const url = new URL(privateDownloadSourceUrl(makeReference(resourceType,"authenticated",publicId,format)));
        assert.equal(url.hostname,"api.cloudinary.com");
        assert.match(url.pathname,new RegExp(`/${resourceType}/download$`));
        assert.equal(url.searchParams.get("type"),"authenticated");
        assert.equal(url.searchParams.get("format"),format);
        assert.equal(url.searchParams.get("public_id"),publicId);
        assert.ok(url.searchParams.get("signature"));
        assert.ok(url.searchParams.get("api_key"));
        assert.ok(Number(url.searchParams.get("expires_at")) > Math.floor(Date.now()/1000));
    }
    assert.equal(privateDownloadSourceUrl(makeReference("image","authenticated","private_uploads/business_permits/permit.pdf","pdf")),null);
    assert.equal(privateDownloadSourceUrl(makeReference("raw","authenticated","private_uploads/business_permits/permit.exe","exe")),null);
    const mismatched = makeReference("image","authenticated","private_uploads/business_permits/permit.png","png");
    const decoded = parseStoredFileReference(mismatched);
    decoded.url = decoded.url.replace("permit.png","different.png");
    assert.equal(privateDownloadSourceUrl(`cld:${Buffer.from(JSON.stringify(decoded)).toString("base64url")}`),null);
    assert.equal(privateDownloadSourceUrl("cld:not-a-reference"),null);
});

test("private permit download reports a provider 404 as a missing asset", async () => {
    const reference=`cld:${Buffer.from(JSON.stringify({provider:"cloudinary",resourceType:"raw",type:"authenticated",publicId:"private_uploads/business_permits/missing.pdf",url:"https://res.cloudinary.com/permit-fixture/raw/authenticated/v1/private_uploads/business_permits/missing.pdf"})).toString("base64url")}`;
    const originalFetch=global.fetch;
    global.fetch=async()=>new Response("missing",{status:404});
    try {
        await assert.rejects(sendStoredFile(reference,{setHeader(){},send(){}},null,"application/pdf",true),error=>error.status===404);
    } finally {global.fetch=originalFetch;}
});

test("private permit delivery logs only the provider status and keeps secrets and references out of the client error", async () => {
    const overrides=[];
    const stub=(object,key,value)=>{overrides.push([object,key,object[key]]);object[key]=value;};
    const secretReference=`cld:${Buffer.from(JSON.stringify({provider:"cloudinary",resourceType:"raw",type:"authenticated",publicId:"private_uploads/business_permits/private-fixture.pdf",url:"https://res.cloudinary.com/permit-fixture/raw/authenticated/v1/private_uploads/business_permits/private-fixture.pdf"})).toString("base64url")}`;
    const originalFetch=global.fetch;
    const originalError=console.error;
    const logs=[];
    let forwardedError;
    stub(db.User,"findByPk",async()=>({id:82,role:"employer"}));
    stub(db.EmployerProfile,"findOne",async()=>({user_id:82,business_permit_path:secretReference,business_permit_documents:JSON.stringify([{storage_ref:secretReference,name:"private-fixture.pdf",mime_type:"application/pdf"}])}));
    global.fetch=async()=>new Response("denied",{status:400});
    console.error=(...values)=>logs.push(values);
    try {
        const headers={};
        const response={setHeader(name,value){headers[name]=value;},removeHeader(name){delete headers[name];}};
        await controller.getDocument({params:{userId:"82",documentId:"1"},query:{},user:{id:1,role:"admin",admin_scope:"employer"}},response,error=>{forwardedError=error;});
        assert.equal(forwardedError.status,502);
        assert.equal(forwardedError.publicMessage,"Business permit storage is temporarily unavailable. Please try again later.");
        assert.deepEqual(logs,[["[employer-permit-storage] Cloudinary delivery failed",{upstreamStatus:400,failure:"provider_response"}]]);
        assert.equal(JSON.stringify(logs).includes(secretReference),false);
        assert.equal(JSON.stringify(logs).includes("private-fixture"),false);
        assert.equal(JSON.stringify(logs).includes(process.env.CLOUDINARY_API_SECRET),false);
        assert.deepEqual(headers,{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
    } finally {
        global.fetch=originalFetch;
        console.error=originalError;
        for(const [object,key,value] of overrides)object[key]=value;
    }
});

test("document viewing never changes verification state and approval/rejection preserve all references", async () => {
    const overrides=[];
    const stub=(object,key,value)=>{overrides.push([object,key,object[key]]);object[key]=value;};
    let user,profile;
    const refs=JSON.stringify(Array.from({length:5},(_,index)=>({storage_ref:`/uploads/documents/permit-${index}.pdf`,name:`Permit ${index}.pdf`,mime_type:"application/pdf"})));
    stub(db.User,"findByPk",async()=>user);
    stub(db.User,"findOne",async options=>!options.where.account_status||options.where.account_status===user.account_status?user:null);
    stub(db.EmployerProfile,"findOne",async()=>profile);
    stub(db.EmployerProfile,"findOrCreate",async()=>[profile,false]);
    stub(db.sequelize,"transaction",async callback=>callback({LOCK:{UPDATE:"UPDATE"}}));
    stub(db.AuditLog,"create",async()=>({}));
    stub(db.Notification,"create",async()=>({}));
    try {
        for(const status of ["verified","rejected"]) {
            user={id:82,role:"employer",name:"Fixture",email:null,account_status:"pending",save:async()=>{}};
            profile={business_permit_path:"/uploads/documents/permit-0.pdf",business_permit_documents:refs,verified:false,save:async()=>{}};
            const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
            await admin.updateEmployerUserStatus({params:{userId:82},body:{status,reason:"Additional proof is required"},user:{id:1,role:"admin",admin_scope:"employer"}},res);
            assert.equal(res.code,undefined);
            assert.equal(user.account_status,status);
            assert.equal(profile.verified,status==="verified");
            assert.equal(profile.business_permit_documents,refs);
            assert.equal(profile.business_permit_path,"/uploads/documents/permit-0.pdf");
            const forbidden={...res,code:undefined};
            await controller.getDocument({params:{userId:"82",documentId:"1"},user:{id:99,role:"employer"}},forbidden,error=>{throw error;});
            assert.equal(forbidden.code,403);
            assert.equal(profile.business_permit_documents,refs);
        }
    } finally {for(const [object,key,value] of overrides)object[key]=value;}
});

test("MySQL stores five long permit references and retains metadata", {skip:process.env.EMPLOYER_PERMIT_DB_TEST!=="1"}, async()=>{
    const table=`permit_probe_${process.pid}`;
    await db.sequelize.transaction(async transaction=>{
        await db.sequelize.query(`CREATE TEMPORARY TABLE \`${table}\` (id INTEGER PRIMARY KEY, business_permit_path TEXT, business_permit_documents TEXT)`,{transaction});
        try {
            const documents=Array.from({length:5},(_,index)=>({storage_ref:`cld:${"a".repeat(600)}${index}`,name:`BIR + # résumé ${index}.pdf`,mime_type:"application/pdf",size:200}));
            const Probe=db.sequelize.define("PermitProbe",{id:{type:db.Sequelize.INTEGER,primaryKey:true},business_permit_path:db.Sequelize.TEXT,business_permit_documents:db.Sequelize.TEXT},{tableName:table,timestamps:false,defaultScope:{attributes:{exclude:["business_permit_documents"]}}});
            await Probe.create({id:1,business_permit_path:documents[0].storage_ref,business_permit_documents:JSON.stringify(documents)},{transaction});
            const general=await Probe.findByPk(1,{transaction});
            assert.equal(general.business_permit_documents,undefined);
            const loaded=await Probe.findByPk(1,{transaction,attributes:{include:["business_permit_documents"]}});
            assert.deepEqual(JSON.parse(loaded.business_permit_documents),documents);
            assert.equal(loaded.business_permit_path,documents[0].storage_ref);
        } finally {await db.sequelize.query(`DROP TEMPORARY TABLE IF EXISTS \`${table}\``,{transaction});}
    });
});
