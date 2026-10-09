import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createAccessGuard} from '../src/access.mjs';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/worker-test.mjs',jsx:'automatic'});
const {createWorker}=await import('../.sites-runtime/worker-test.mjs');
function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_articles.sql','utf8'));function prepare(sql,args=[]){return {bind(...a){return prepare(sql,a)},async all(){return {success:true,results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){db.prepare(sql).run(...args);return {success:true}}};}return {prepare};}
const origin='https://reader.example';
const owner=request=>Promise.resolve(request.headers.get('x-synthetic-owner')==='yes'?{ok:true,status:200}:{ok:false,status:401});
const worker=createWorker({verifyOwner:owner,convert:async()=>({markdown:'# Converted fixture',sourceUrl:'https://article.example/',title:'Converted'})});
const data={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'Fixture',sourceUrl:'https://example.com/a',markdown:'# Fixture\n\n<script>evil()</script>\n\n![tracking](https://evil.example/x)',published:false,rightsConfirmed:true};
const request=(path,method='GET',body,authorized=false,extra={})=>new Request(origin+path,{method,headers:{...(authorized?{'x-synthetic-owner':'yes'}:{}),...(body?{'content-type':'application/json',origin}:{}),...extra},body:body?JSON.stringify(body):undefined});
test('server rejects anonymous and unsigned owner claims on protected routes',async()=>{const env={DB:database()};for(const path of ['/admin','/api/articles','/api/convert'])assert.equal((await worker.fetch(request(path),env)).status,401);assert.equal((await worker.fetch(request('/api/articles','POST',data,false,{'oai-authenticated-user-email':'owner@example.com'}),env)).status,401);assert.equal((await worker.fetch(request('/admin','GET',undefined,true),env)).status,200);});
test('draft/public/export/unpublish state with durable SQLite and inert output',async()=>{const env={DB:database()};assert.equal((await worker.fetch(request('/api/articles','POST',data,true),env)).status,200);assert.equal((await worker.fetch(request('/p/'+data.id),env)).status,404);assert.equal((await worker.fetch(request('/export/'+data.id+'?format=md'),env)).status,404);assert.equal((await worker.fetch(request('/api/articles','POST',{...data,published:true},true),env)).status,200);const page=await worker.fetch(request('/p/'+data.id),env);assert.equal(page.status,200);const text=await page.text();assert.ok(!/<script|<img|<iframe|<form/.test(text));assert.ok(text.includes('&lt;script&gt;'));assert.ok(text.includes(data.sourceUrl));assert.equal(await (await worker.fetch(request('/export/'+data.id+'?format=md'),env)).text(),data.markdown);assert.equal((await worker.fetch(request('/api/articles','POST',data,true),env)).status,200);assert.equal((await worker.fetch(request('/p/'+data.id),env)).status,404);});
test('same-Origin JSON mutations, permission denial, safe conversion and no public writes',async()=>{const env={DB:database()};assert.equal((await worker.fetch(request('/api/articles','POST',data,true,{origin:'https://evil.example'}),env)).status,403);assert.equal((await worker.fetch(request('/api/articles','POST',{...data,published:true,rightsConfirmed:false},true),env)).status,400);assert.equal((await worker.fetch(request('/api/convert','POST',{url:'https://article.example/'},true),env)).status,200);assert.equal((await worker.fetch(request('/p/sample-safe-reading','POST',{},true),env)).status,405);assert.equal((await worker.fetch(request('/'),env)).status,200);});
test('HTTP handler with the real signature guard rejects other users before ingestion or storage mutation',async()=>{
 const keys=await generateKeyPair('RS256',{extractable:true});const jwk={...await exportJWK(keys.publicKey),kid:'synthetic-http-key',alg:'RS256'};
 const env={DB:database(),ACCESS_TEAM_DOMAIN:'https://synthetic-http.cloudflareaccess.com',ACCESS_AUD:'synthetic-http-audience',OWNER_EMAIL:'owner@example.test'};
 const signed=email=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setSubject('synthetic-subject').setExpirationTime('5m').sign(keys.privateKey);
 let conversions=0;const server=createWorker({verifyOwner:createAccessGuard({jwks:{keys:[jwk]}}),convert:async()=>{conversions++;return {markdown:'# fixture'};}});
 for(const [token,status] of [[undefined,401],[await signed('other@example.test'),403],['forged.jwt.token',401]]){
  const headers={'cf-access-authenticated-user-email':env.OWNER_EMAIL,'oai-authenticated-user-email':env.OWNER_EMAIL,...(token?{'cf-access-jwt-assertion':token}:{})};
  assert.equal((await server.fetch(request('/admin','GET',undefined,false,headers),env)).status,status);
  assert.equal((await server.fetch(request('/api/articles','POST',data,false,headers),env)).status,status);
  assert.equal((await server.fetch(request('/api/convert','POST',{url:'https://article.example/'},false,headers),env)).status,status);
 }
 assert.equal(conversions,0);const ownerHeaders={'cf-access-jwt-assertion':await signed(env.OWNER_EMAIL)};
 assert.equal((await server.fetch(request('/api/articles','GET',undefined,false,ownerHeaders),env)).status,200);
 assert.deepEqual((await (await server.fetch(request('/api/articles','GET',undefined,false,ownerHeaders),env)).json()).articles,[]);
 assert.equal((await server.fetch(request('/api/convert','POST',{url:'https://article.example/'},false,ownerHeaders),env)).status,200);assert.equal(conversions,1);
});
