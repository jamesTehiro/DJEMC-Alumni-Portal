const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),jwt=require('jsonwebtoken');
const {fixture,real}=require('./helpers/accountDeletionFixture.cjs');
const controller=require('../controllers/accountDeletionController');
const {createAccountDeletion}=require('../services/accountDeletion');
const responseHandler=(service,role,method)=>async(req,res)=>{try{return res.json(await service[method]({actor:req.user,role,id:Number(req.params.userId),confirmation:req.body?.confirmation,confirmationToken:req.body?.confirmationToken}));}catch(error){return res.status(error.status||500).json({msg:error.status?error.message:'Synthetic transaction rolled back'});}};
test.after(()=>real.sequelize.close());
test('actual mounted deletion routes enforce auth/scope and return JSON for previews, deletes and route/account misses',async()=>{
 const f=fixture(),originalFind=real.User.findByPk,originals={...controller},oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET=f.env.JWT_SECRET;
 real.User.findByPk=async id=>f.db.User.findByPk(id);
 for(const role of ['alumni','employer'])for(const method of ['preview','remove'])controller[(method==='preview'?'preview':'delete')+(role==='alumni'?'Alumni':'Employer')]=responseHandler(f.service,role,method);
 const routePath=require.resolve('../routes/accountDeletionRoutes');delete require.cache[routePath];
 const app=express();app.use(express.json());app.use('/api/admin',require(routePath));app.use('/api',require('../middleware/apiNotFound'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const request=(role,id,method='GET',body,actorRole=role)=>fetch(`http://127.0.0.1:${server.address().port}/api/admin/${role}/users/${id}${method==='GET'?'/deletion-impact':''}`,{method,headers:{'Content-Type':'application/json',...(actorRole?{Authorization:'Bearer '+jwt.sign({id:actorRole==='employer'?1:2},f.env.JWT_SECRET)}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  for(const role of ['alumni','employer']){const id=role==='alumni'?20:10;let res=await request(role,id,'GET',undefined,null);assert.equal(res.status,401);assert.equal(res.headers.get('x-account-deletion-api'),'v1');assert.match(res.headers.get('content-type'),/json/);
   res=await request(role,id,'GET',undefined,role==='alumni'?'employer':'alumni');assert.equal(res.status,403);
   res=await request(role,id);assert.equal(res.status,200);const preview=await res.json();assert.equal(preview.account.role,role);
   res=await request(role,id,'DELETE',{confirmation:'delete',confirmationToken:preview.confirmationToken});assert.equal(res.status,400);
   res=await request(role,id,'DELETE',{confirmation:'DELETE',confirmationToken:preview.confirmationToken});assert.equal(res.status,200);assert.equal((await res.json()).deletedUserId,id);
   res=await request(role,id);assert.equal(res.status,404);assert.match(res.headers.get('content-type'),/json/);
  }
  const missing=await fetch(`http://127.0.0.1:${server.address().port}/api/nonexistent-deletion-route`);assert.equal(missing.status,404);assert.equal((await missing.json()).code,'API_ROUTE_NOT_FOUND');assert.equal(missing.headers.get('x-account-deletion-api'),null);
 }finally{real.User.findByPk=originalFind;Object.assign(controller,originals);if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));delete require.cache[routePath];}
});
test('server and admin parent mount the isolated deletion routes before API/static fallbacks',()=>{
 const fs=require('fs');const server=fs.readFileSync(require.resolve('../server'),'utf8'),admin=fs.readFileSync(require.resolve('../routes/adminRoutes'),'utf8');
 assert.ok(server.indexOf('app.use("/api/admin", require("./routes/adminRoutes"))')<server.indexOf("app.use('/api', require('./middleware/apiNotFound'))"));assert.ok(server.indexOf("app.use('/api', require('./middleware/apiNotFound'))")<server.indexOf('app.use(express.static(reactBuildPath))'));assert.ok(admin.indexOf("router.use(require('./accountDeletionRoutes'))")<admin.indexOf('router.use(authMiddleware)'));
});
