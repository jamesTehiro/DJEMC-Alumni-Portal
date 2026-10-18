import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const result = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/businessPermits.js",import.meta.url))], bundle:true,write:false,platform:"node",format:"cjs",define:{"import.meta.env":"{}"},logLevel:"silent" });
const module = {exports:{}};
new Function("require","module","exports",result.outputFiles[0].text)(require,module,module.exports);
const {validateBusinessPermits,getBusinessPermitDocuments,MAX_BUSINESS_PERMIT_MB}=module.exports;
const permit=(index=0)=>({name:`BIR permit ${index}.pdf`,type:"application/pdf",size:500});

test("one through five permits validate, while six, missing, empty, invalid and oversized files fail",()=>{
    for(let count=1;count<=5;count++) assert.equal(validateBusinessPermits(Array.from({length:count},(_,index)=>permit(index))),"");
    assert.match(validateBusinessPermits(Array.from({length:6},(_,index)=>permit(index))),/up to five/);
    assert.match(validateBusinessPermits([]),/at least one/);
    for(const file of [{name:"permit.gif",type:"image/gif",size:5},{name:"permit.pdf.exe",type:"application/pdf",size:5},{name:"permit.png",type:"application/pdf",size:5}]) assert.match(validateBusinessPermits([file]),/PNG, JPG, JPEG, or PDF/);
    for(const file of [permit(),{name:"permit.jpeg",type:"image/jpeg",size:10},{name:"permit.JPG",type:"image/jpeg",size:10},{name:"permit.png",type:"image/png",size:10}]) assert.equal(validateBusinessPermits([file]),"");
    assert.match(validateBusinessPermits([{...permit(),size:0}]),/non-empty/);
    assert.match(validateBusinessPermits([{...permit(),size:MAX_BUSINESS_PERMIT_MB*1024*1024+1}]),/no larger/);
});

test("document rendering supports multiple references, legacy single permits, and real empty states",()=>{
    const documents=Array.from({length:5},(_,index)=>({id:String(index+1),name:`Permit ${index}.pdf`,mime_type:"application/pdf",url:`/api/admin/employer/users/8/business-permits/${index+1}`}));
    assert.equal(getBusinessPermitDocuments({business_permit_documents:documents}),documents);
    assert.deepEqual(getBusinessPermitDocuments(null),[]);
    assert.equal(getBusinessPermitDocuments({business_permit_path:"/api/files/documents/old.pdf",business_permit_name:"Old.pdf"})[0].name,"Old.pdf");
    assert.deepEqual(getBusinessPermitDocuments({business_permit_documents:[],business_permit_path:null}),[]);
});

test("both registration entry points append every selected permit and the verification modal displays submitted documents",()=>{
    for(const page of ["EmployerRegisterPage","RegisterEmployerPage"]) {
        const source=readFileSync(new URL(`../src/pages/${page}.jsx`,import.meta.url),"utf8");
        assert.match(source,/BusinessPermitInput files=\{businessPermits\}/);
        assert.match(source,/businessPermits\.forEach\(file => payload\.append\("business_permit", file\)\)/);
        assert.match(source,/validateBusinessPermits\(businessPermits\)/);
    }
    const modal=readFileSync(new URL("../src/pages/admin/AdminVerificationPage.jsx",import.meta.url),"utf8");
    assert.match(modal,/BusinessPermitDocuments profile=\{selectedEmployer\?\.EmployerProfile\}/);
    assert.doesNotMatch(modal,/Upload replacement business permit|No business permit uploaded/);
    assert.match(modal,/BusinessPermitPreview name=\{previewFile\.name\} request=\{previewFile\.request\}/);
});
