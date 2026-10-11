import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createAccessGuard} from '../src/access.mjs';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/mcp-worker-test.mjs',jsx:'automatic'});
const {createWorker}=await import('../.sites-runtime/mcp-worker-test.mjs');
const origin='https://reader.example';
const fixture={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'Synthetic fixture',sourceUrl:'https://article.example/',markdown:'# Synthetic fixture'};
function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_articles.sql','utf8'));function prepare(sql,args=[]){return {bind(...a){return prepare(sql,a)},async all(){return {success:true,results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:r.changes}};}};}return {prepare};}
const limiter={async limit({key}){assert.equal(key,'yomudake-owner-tools');return {success:true};}};
const owner=request=>Promise.resolve(request.headers.get('x-synthetic-owner')==='yes'?{ok:true,status:200}:{ok:false,status:401});
let conversions=0;
const worker=createWorker({verifyOwner:owner,convert:async(url,env,options)=>{conversions++;assert.equal(options.ownHost,'reader.example');return {markdown:'# Synthetic conversion',sourceUrl:url,title:'Synthetic'};}});
function request(message,{method='POST',authorized=true,headers={},raw,path='/api/mcp'}={}){return new Request(origin+path,{method,headers:{...(authorized?{'x-synthetic-owner':'yes'}:{}),'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',...headers},...(method==='POST'?{body:raw??JSON.stringify(message)}:{})});}
const rpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
const call=(name,args)=>rpc('tools/call',{name,arguments:args});
async function run(message,env={DB:database(),MCP_RATE_LIMITER:limiter},options){return (await worker.fetch(request(message,options),env)).json();}
test('MCP initialization, tools, ping, notifications and supported versions',async()=>{
 const env={DB:database(),MCP_RATE_LIMITER:limiter};const initialized=await run(rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}}),env);assert.equal(initialized.result.protocolVersion,'2025-11-25');assert.deepEqual(initialized.result.capabilities,{tools:{}});assert.deepEqual((await run(rpc('ping'),env)).result,{});
 const tools=(await run(rpc('tools/list'),env)).result.tools;assert.deepEqual(tools.map(x=>x.name),['convert_url','get_article','save_draft','publish_article']);assert.equal(tools[3].annotations.destructiveHint,true);
 for(const method of ['GET','DELETE','PUT','OPTIONS']){const response=await worker.fetch(request(null,{method}),env);assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'POST');}
 const headerlessInitialize=request(rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}}));headerlessInitialize.headers.delete('mcp-protocol-version');assert.equal((await worker.fetch(headerlessInitialize,env)).status,200);
 const missingVersion=request(rpc('ping'));missingVersion.headers.delete('mcp-protocol-version');assert.equal((await worker.fetch(missingVersion,env)).status,400);
 const notice=await worker.fetch(request({jsonrpc:'2.0',method:'notifications/initialized'}),env);assert.equal(notice.status,202);assert.equal(await notice.text(),'');
 for(const version of ['2025-06-18','2025-11-25'])assert.equal((await worker.fetch(request(rpc('ping'),{headers:{'mcp-protocol-version':version}}),env)).status,200);
 for(const version of ['', '2025-03-26','2099-01-01'])assert.equal((await worker.fetch(request(rpc('ping'),{headers:{'mcp-protocol-version':version}}),env)).status,400);
 for(const [method,params,code] of [['unrecognized',{},-32601],['tools/list',{cursor:'forged'},-32602],['tools/call',{name:'unrecognized'},-32602],['initialize',{},-32602]])assert.equal((await run(rpc(method,params),env)).error.code,code);
});
test('real signed owner guard, isolated MCP audience, and no opaque bearer fallback',async()=>{
 const keys=await generateKeyPair('RS256',{extractable:true}),jwk={...await exportJWK(keys.publicKey),kid:'synthetic-mcp',alg:'RS256'};
 const env={DB:database(),MCP_RATE_LIMITER:limiter,ACCESS_TEAM_DOMAIN:'https://synthetic-mcp.cloudflareaccess.com',ACCESS_AUD:'admin-aud',MCP_ACCESS_AUD:'mcp-aud',OWNER_EMAIL:'owner@example.test'};
 const signed=(email,aud='mcp-aud',issuer=env.ACCESS_TEAM_DOMAIN,exp='5m')=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience(aud).setSubject('fixture').setExpirationTime(exp).sign(keys.privateKey);
 let writes=0;const server=createWorker({verifyOwner:createAccessGuard({jwks:{keys:[jwk]}}),convert:async()=>{writes++;return {markdown:'fixture'};}});
 for(const [token,status] of [[undefined,401],['forged.jwt.token',401],[await signed('other@example.test'),403],[await signed(env.OWNER_EMAIL,'admin-aud'),401],[await signed(env.OWNER_EMAIL,'mcp-aud','https://wrong.cloudflareaccess.com'),401],[await signed(env.OWNER_EMAIL,'mcp-aud',env.ACCESS_TEAM_DOMAIN,'-1s'),401]])for(const message of [rpc('tools/list'),call('convert_url',{url:fixture.sourceUrl}),call('publish_article',{...fixture,rightsConfirmed:true,publicSharingConfirmed:true})]){
  const response=await server.fetch(request(message,{authorized:false,headers:{authorization:'Bearer opaque','cf-access-authenticated-user-email':env.OWNER_EMAIL,...(token?{'cf-access-jwt-assertion':token}:{})}}),env);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes(env.OWNER_EMAIL));
 }
 assert.equal(writes,0);assert.deepEqual((await env.DB.prepare('SELECT * FROM articles').all()).results,[]);
 const headers={'cf-access-jwt-assertion':await signed(env.OWNER_EMAIL)};assert.equal((await server.fetch(request(rpc('tools/list'),{authorized:false,headers}),env)).status,200);assert.equal((await server.fetch(request(null,{method:'GET',path:'/api/articles',authorized:false,headers}),env)).status,401);
 assert.equal((await server.fetch(request(rpc('ping'),{headers}),{...env,MCP_ACCESS_AUD:''})).status,503);
 assert.equal((await createWorker().fetch(request(rpc('tools/list')),{DB:database()})).status,503);
});
test('Origin and browser metadata validated before side effects',async()=>{
 const env={DB:database(),MCP_RATE_LIMITER:limiter},before=conversions;for(const headers of [{origin:''},{origin:'https://evil.example'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-origin'},{'sec-fetch-site':'none'},{origin,'sec-fetch-site':'same-site'}]){
  assert.equal((await worker.fetch(request(call('convert_url',{url:fixture.sourceUrl}),{headers}),env)).status,403);assert.equal((await worker.fetch(request(null,{method:'GET',headers}),env)).status,403);
 }assert.equal(conversions,before);assert.equal((await worker.fetch(request(rpc('ping'),{headers:{origin,'sec-fetch-site':'same-origin'}}),env)).status,200);
});
test('separate conversion, draft, read and explicit public share with atomic draft protection',async()=>{
 const env={DB:database(),MCP_RATE_LIMITER:limiter};assert.equal((await run(call('convert_url',{url:fixture.sourceUrl}),env)).result.structuredContent.markdown,'# Synthetic conversion');assert.deepEqual((await env.DB.prepare('SELECT * FROM articles').all()).results,[]);
 const draft=(await run(call('save_draft',fixture),env)).result.structuredContent;assert.equal(draft.published,false);assert.ok(!('url' in draft));assert.equal((await worker.fetch(new Request(origin+'/p/'+fixture.id),env)).status,404);assert.equal((await run(call('get_article',{id:fixture.id}),env)).result.structuredContent.article.markdown,fixture.markdown);
 for(const consent of [{},{rightsConfirmed:true},{publicSharingConfirmed:true},{rightsConfirmed:true,publicSharingConfirmed:false}]){assert.equal((await run(call('publish_article',{...fixture,...consent}),env)).result.isError,true);assert.equal((await worker.fetch(new Request(origin+'/p/'+fixture.id),env)).status,404);}
 const published=(await run(call('publish_article',{...fixture,rightsConfirmed:true,publicSharingConfirmed:true}),env)).result.structuredContent;assert.equal(published.url,origin+'/p/'+fixture.id);assert.equal((await worker.fetch(new Request(published.url),env)).status,200);
 assert.equal((await run(call('save_draft',{...fixture,markdown:'Changed'}),env)).result.isError,true);assert.equal((await run(call('get_article',{id:fixture.id}),env)).result.structuredContent.article.markdown,fixture.markdown);
 await run(call('publish_article',{...fixture,rightsConfirmed:true,publicSharingConfirmed:true}),env);assert.equal((await env.DB.prepare('SELECT * FROM articles').all()).results.length,1);
});
test('bounded parser, schema checks, no notification mutations and private exception redaction',async()=>{
 const env={DB:database(),MCP_RATE_LIMITER:limiter},before=conversions;for(const message of [[],null,{jsonrpc:'1.0',id:1,method:'ping'},rpc('ping',null),{jsonrpc:'2.0',id:null,method:'ping'},{jsonrpc:'2.0',id:{},method:'ping'},{...rpc('ping'),result:{}},rpc('',{})])assert.equal((await worker.fetch(request(message),env)).status,400);
 const invalidUtf8=await worker.fetch(request(null,{raw:new Uint8Array([0xff])}),env);assert.equal(invalidUtf8.status,400);assert.equal((await invalidUtf8.json()).error.code,-32700);
 const parseError=await worker.fetch(request(null,{raw:'{'}),env);assert.equal(parseError.status,400);assert.ok(!Object.hasOwn(await parseError.json(),'id'));assert.equal((await worker.fetch(request(null,{raw:'x'.repeat(215001)}),env)).status,413);assert.equal((await worker.fetch(request(rpc('ping'),{headers:{'content-type':'application/json-malicious'}}),env)).status,415);assert.equal((await worker.fetch(request(rpc('ping'),{headers:{accept:'application/json'}}),env)).status,406);
 for(const method of ['tools/call','tools/list'])assert.equal((await worker.fetch(request({jsonrpc:'2.0',method,params:{name:'publish_article',arguments:{...fixture,rightsConfirmed:true,publicSharingConfirmed:true}}}),env)).status,400);
 assert.equal(conversions,before);assert.deepEqual((await env.DB.prepare('SELECT * FROM articles').all()).results,[]);
 for(const [name,args] of [['save_draft',{...fixture,published:true}],['save_draft',{...fixture,markdown:'界'.repeat(70000)}],['publish_article',{...fixture,rightsConfirmed:true,publicSharingConfirmed:true,sourceUrl:'http://127.0.0.1/'}],['get_article',{id:'sample-safe-reading'}],['convert_url',{url:fixture.sourceUrl,headers:{authorization:'sensitive'}}]])assert.equal((await run(call(name,args),env)).result.isError,true);
 for(const sourceUrl of [null,false,0])for(const name of ['save_draft','publish_article'])assert.equal((await run(call(name,{...fixture,sourceUrl,...(name==='publish_article'?{rightsConfirmed:true,publicSharingConfirmed:true}:{})}),env)).result.isError,true);
 const secret='synthetic-private-token cookie body',failing=createWorker({verifyOwner:owner,convert:async()=>{throw new Error(secret);}});const response=await failing.fetch(request(call('convert_url',{url:fixture.sourceUrl})),env),serialized=await response.text();assert.equal(response.status,200);assert.ok(!serialized.includes(secret));assert.equal(JSON.parse(serialized).result.isError,true);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 const failure=await run(call('save_draft',fixture),{MCP_RATE_LIMITER:limiter,DB:{prepare(){throw new Error(secret);}}});assert.equal(failure.result.isError,true);assert.ok(!JSON.stringify(failure).includes(secret));
});

test('MCP limiter is required and failure, denial and malformed success are fail-closed',async()=>{
 const before=conversions;for(const MCP_RATE_LIMITER of [undefined,{async limit(){return {success:false};}},{async limit(){return {}; }},{async limit(){throw new Error('private synthetic limiter credential');}}]){let dbCalls=0;const backing=database(),env={DB:{prepare(...args){dbCalls++;return backing.prepare(...args);}},MCP_RATE_LIMITER};for(const name of ['convert_url','get_article','save_draft','publish_article']){const result=await run(call(name,name==='convert_url'?{url:fixture.sourceUrl}:name==='get_article'?{id:fixture.id}:{...fixture,...(name==='publish_article'?{rightsConfirmed:true,publicSharingConfirmed:true}:{})}),env);assert.equal(result.result.isError,true);assert.ok(!JSON.stringify(result).includes('private synthetic'));}assert.equal(dbCalls,0);assert.deepEqual((await backing.prepare('SELECT * FROM articles').all()).results,[]);assert.equal((await run(rpc('tools/list'),env)).result.tools.length,4);}assert.equal(conversions,before);
});
