const test = require("node:test");
const assert = require("node:assert/strict");
process.env.OBJECT_STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "permit-fixture";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
const db = require("../models");
const migration = require("../migrations/20261018-add-employer-permit-documents");
const { readPermitDocuments, permitDocumentPayload } = require("../services/employerPermitDocuments");
const { recoverPermitStoredFileReference, parseStoredFileReference } = require("../services/objectStorage");
const controller = require("../controllers/employerPermitController");
const admin = require("../controllers/adminController");
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
