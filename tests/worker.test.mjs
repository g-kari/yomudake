import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createAccessGuard} from '../src/access.mjs';
import {exportMarkdown} from '../src/navigation.mjs';
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
test('draft/public/export/unpublish state with durable SQLite and inert output',async()=>{const env={DB:database()};assert.equal((await worker.fetch(request('/api/articles','POST',data,true),env)).status,200);assert.equal((await worker.fetch(request('/p/'+data.id),env)).status,404);assert.equal((await worker.fetch(request('/export/'+data.id+'?format=md'),env)).status,404);assert.equal((await worker.fetch(request('/api/articles','POST',{...data,published:true},true),env)).status,200);const page=await worker.fetch(request('/p/'+data.id),env);assert.equal(page.status,200);const text=await page.text();assert.ok(!/<script|<img|<iframe|<form/.test(text));assert.ok(text.includes('&lt;script&gt;'));assert.ok(text.includes(data.sourceUrl));assert.equal(await (await worker.fetch(request('/export/'+data.id+'?format=md'),env)).text(),exportMarkdown({...data,source_url:data.sourceUrl}));assert.equal((await worker.fetch(request('/api/articles','POST',data,true),env)).status,200);assert.equal((await worker.fetch(request('/p/'+data.id),env)).status,404);});
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

test('HTML downloads prohibit intermediary transformations without changing content or other routes',async()=>{
 const env={DB:database()};
 assert.equal((await worker.fetch(request('/api/articles','POST',{...data,published:true},true),env)).status,200);
 const page=await worker.fetch(request('/p/'+data.id),env),download=await worker.fetch(request('/export/'+data.id+'?format=html'),env);
 assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store, no-transform');
 assert.equal(download.headers.get('content-type'),'text/html; charset=utf-8');
 assert.equal(download.headers.get('content-disposition'),`attachment; filename="article-${data.id}.html"`);
 for(const name of ['content-security-policy','x-content-type-options','referrer-policy'])assert.equal(download.headers.get(name),page.headers.get(name));
 assert.equal(await download.text(),await page.text());
 const markdown=await worker.fetch(request('/export/'+data.id+'?format=md'),env);
 assert.equal(markdown.headers.get('cache-control'),'no-store');assert.equal(markdown.headers.get('content-type'),'text/markdown; charset=utf-8');
 assert.equal(markdown.headers.get('content-disposition'),`attachment; filename="article-${data.id}.md"`);assert.equal(await markdown.text(),exportMarkdown({...data,source_url:data.sourceUrl}));
 for(const [path,authorized,status] of [['/',false,200],['/p/'+data.id,false,200],['/admin',true,200],['/api/articles',true,200],['/admin',false,401],['/api/articles',false,401]]){
  const result=await worker.fetch(request(path,'GET',undefined,authorized),env);assert.equal(result.status,status,path);
  assert.equal(result.headers.get('cache-control'),'no-store',path);
 }
});
test('only successful public HTML attachments receive no-transform, including the built-in sample',async()=>{
 const env={DB:database()};await worker.fetch(request('/api/articles','POST',data,true),env);
 for(const id of [data.id,'synthetic-missing']){
  const result=await worker.fetch(request('/export/'+id+'?format=html'),env);assert.equal(result.status,404);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('content-disposition'),null);
 }
 const sample=await worker.fetch(request('/export/sample-safe-reading?format=html'),env);
 assert.equal(sample.status,200);assert.equal(sample.headers.get('cache-control'),'no-store, no-transform');
 assert.equal(sample.headers.get('content-disposition'),'attachment; filename="article-sample-safe-reading.html"');
 const markdown=await worker.fetch(request('/export/sample-safe-reading'),env);
 assert.equal(markdown.status,200);assert.equal(markdown.headers.get('cache-control'),'no-store');
});

const confirmationHrefs=text=>[...text.matchAll(/href="([^"]*\/out\/[^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
const getHref=async(href,env)=>worker.fetch(new Request(href),env);
test('published source/body links require a revision-bound, script-free confirmation without destination query logging',async()=>{
 const env={DB:database()};
 const markdown='# Heading [first](https://example.org/first)\n\n`[inline code](https://example.org/not-a-link)`\n\n![image](https://example.org/not-an-image)\n\n```text\n[fenced](https://example.org/not-fenced)\n```\n\n- [second](http://example.org/second)\n\n> [third](https://example.org/third)\n\n[again](https://example.org/first)\n\n[local](/p/sample-safe-reading) [anchor](#section) [own](https://reader.example/) [unsafe](javascript:evil)';
 await worker.fetch(request('/api/articles','POST',{...data,markdown,published:true},true),env);
 const page=await worker.fetch(request('/p/'+data.id),env);const text=await page.text(),links=confirmationHrefs(text);
 assert.equal(links.length,5);assert.ok(text.includes('出典・元の記事'));assert.ok(text.includes('href="#section"'));assert.ok(text.includes('href="https://reader.example/p/sample-safe-reading"'));
 assert.ok(!/href="https?:\/\/example\.(org|com)/.test(text));
 const expected=[data.sourceUrl,'https://example.org/first','http://example.org/second','https://example.org/third','https://example.org/first'];
 const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected outbound fetch');};
 try{
  for(const [index,href] of links.entries()){
   assert.deepEqual([...new URL(href).searchParams.keys()],['rev']);assert.match(new URL(href).searchParams.get('rev'),/^[0-9a-f]{64}$/);
   const response=await getHref(href,env),body=await response.text();assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
   assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.ok(body.includes('noindex,nofollow'));
   assert.ok(body.includes('外部サイトです'));assert.ok(body.includes('内容や安全性'));assert.ok(body.includes(expected[index]));
   assert.ok(body.includes(`href="${expected[index]}" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer"`));
   assert.ok(body.includes(`href="/p/${data.id}">戻る`));assert.ok(!/<script|<img|<form|http-equiv/i.test(body));
   assert.equal((body.match(/<iframe/g)||[]).length,1);assert.ok(body.includes('sandbox="" referrerpolicy="no-referrer" loading="lazy"'));
   assert.ok(body.includes('https://embed.pixiv.net/oembed_iframe.php?type=illust&amp;id=150221597'));assert.ok(body.includes('ジセイノク'));assert.ok(body.includes('/artwork-150221597?rev='));assert.ok(body.includes('/author-150221597?rev='));assert.ok(body.includes('表示されない場合'));
   assert.equal(response.headers.get('content-security-policy'),page.headers.get('content-security-policy').replace("frame-src 'none'",'frame-src https://embed.pixiv.net/oembed_iframe.php'));
  }
 }finally{globalThis.fetch=originalFetch;}
 assert.equal(calls,0);
 const exported=await worker.fetch(request('/export/'+data.id+'?format=html'),env);assert.equal(exported.headers.get('cache-control'),'no-store, no-transform');assert.deepEqual(confirmationHrefs(await exported.text()),links);
});

test('confirmation denies drafts, stale revisions, missing and unsafe targets, and arbitrary URL redirects',async()=>{
 const env={DB:database()};await worker.fetch(request('/api/articles','POST',{...data,published:true,markdown:'[body](https://example.org/body)'},true),env);
 const old=confirmationHrefs(await (await worker.fetch(request('/p/'+data.id),env)).text());
 for(const path of ['/out?url=https://evil.example/','/out/'+data.id+'/source','/out/'+data.id+'/source?rev=wrong',new URL(old[0]).pathname+new URL(old[0]).search+'&rev=extra',new URL(old[1]).pathname.replace('link-0','link-999')+new URL(old[1]).search]){
  const r=await worker.fetch(request(path),env);assert.equal(r.status,404,path);assert.equal(r.headers.get('location'),null);assert.ok(!(await r.text()).includes('<iframe'));
 }
 await worker.fetch(request('/api/articles','POST',{...data,published:true,sourceUrl:'https://example.org/changed',markdown:'[changed](https://example.org/new)'},true),env);
 for(const href of old)assert.equal((await getHref(href,env)).status,404);
 const current=confirmationHrefs(await (await worker.fetch(request('/p/'+data.id),env)).text());assert.equal((await getHref(current[0],env)).status,200);
 const base=new URL(current[0]);
 for(const [selector,target] of [['artwork-150221597','https://www.pixiv.net/artworks/150221597'],['author-150221597','https://www.pixiv.net/en/users/83957688']]){const route=new URL(base);route.pathname=route.pathname.replace('source',selector);const r=await getHref(route.href,env);assert.equal(r.status,200);assert.ok((await r.text()).includes(`href="${target}" target="_blank"`));}
 const unknown=new URL(base);unknown.pathname=unknown.pathname.replace('source','artwork-999999');assert.equal((await getHref(unknown.href,env)).status,404);
 await worker.fetch(request('/api/articles','POST',data,true),env);for(const href of current)assert.equal((await getHref(href,env)).status,404);
 const sample=await worker.fetch(request('/p/sample-safe-reading'),env);const sampleLinks=confirmationHrefs(await sample.text());assert.equal(sampleLinks.length,1);assert.equal((await getHref(sampleLinks[0],env)).status,200);
 for(const path of ['/','/p/sample-safe-reading','/admin','/api/articles','/export/sample-safe-reading?format=html']){
  const r=await worker.fetch(request(path,'GET',undefined,true),env);assert.ok(r.headers.get('content-security-policy').includes("frame-src 'none'"),path);assert.ok(!(await r.text()).includes('<iframe'),path);
 }
});
