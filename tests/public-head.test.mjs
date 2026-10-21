import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import test from 'node:test';
import assert from 'node:assert/strict';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/public-head-test.mjs',jsx:'automatic'});
const {createWorker}=await import('../.sites-runtime/public-head-test.mjs');
const origin='https://reader.example';
const article={id:'synthetic-published',title:'Synthetic title',source_url:'https://example.org/source',markdown:'# Synthetic heading\n\n[Reference](https://example.org/reference)',published:1,created_at:'2026-10-19T00:00:00Z',updated_at:'2026-10-19T00:00:00Z',published_at:'2026-10-19T00:00:00Z'};
const request=(path,method='GET',authorized=false)=>new Request(origin+path,{method,headers:authorized?{'x-synthetic-owner':'yes'}:{}});
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_articles.sql','utf8'));
 for(const row of [article,{...article,id:'synthetic-draft',published:0,published_at:null}])db.prepare('INSERT INTO articles (id,title,source_url,markdown,published,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(row));
 let writes=0,reads=0,conversions=0,authChecks=0;
 function prepare(sql,args=[]){return {bind(...values){return prepare(sql,values)},async all(){reads++;return {success:true,results:db.prepare(sql).all(...args)}},async first(){reads++;return db.prepare(sql).get(...args)||null},async run(){writes++;throw new Error('No writes permitted');}};}
 const env={DB:{prepare}};
 const worker=createWorker({verifyOwner:async request=>{authChecks++;return request.headers.get('x-synthetic-owner')==='yes'?{ok:true,status:200}:{ok:false,status:401};},convert:async()=>{conversions++;throw new Error('No conversions permitted');}});
 return {db,env,worker,counters:()=>({writes,reads,conversions,authChecks})};
}
async function parity(f,path,status){
 const get=await f.worker.fetch(request(path),f.env),head=await f.worker.fetch(request(path,'HEAD'),f.env);
 assert.equal(get.status,status,path+' GET');assert.equal(head.status,status,path+' HEAD');
 assert.deepEqual([...head.headers],[...get.headers],path+' headers');
 assert.equal(head.body,null,path+' body stream');assert.equal(await head.text(),'',path+' body');
 assert.equal(head.headers.get('content-length'),null,'Do not synthesize Content-Length: 0 for a nonempty GET representation');
 assert.equal(head.headers.get('cache-control'),path.includes('format=html')&&status===200?'no-store, no-transform':'no-store');
 return get;
}
test('public home, sample, published articles and both exports have bodyless HEAD parity',async()=>{
 const f=fixture();try{
  for(const path of ['/','/p/sample-safe-reading','/p/'+article.id,'/export/'+article.id+'?format=md','/export/'+article.id+'?format=html']){
   const response=await parity(f,path,200);assert.ok((await response.text()).length>0);
  }
  assert.ok(f.counters().reads>0,'Public HEAD may still read storage');
  const {reads,...effects}=f.counters();assert.deepEqual(effects,{writes:0,conversions:0,authChecks:0});
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM articles').get().count,2);
 }finally{f.db.close();}
});
test('draft and missing article/export HEAD remain indistinguishable 404 without a body',async()=>{
 const f=fixture();try{
  for(const id of ['synthetic-draft','synthetic-missing'])for(const path of ['/p/'+id,'/export/'+id+'?format=md','/export/'+id+'?format=html'])await parity(f,path,404);
  assert.equal(f.counters().writes,0);assert.equal(f.counters().conversions,0);
 }finally{f.db.close();}
});
test('outbound HEAD preserves revision checks, CSP and no redirect without fetching the destination',async()=>{
 const f=fixture(),originalFetch=globalThis.fetch;let outboundCalls=0;
 globalThis.fetch=async()=>{outboundCalls++;throw new Error('No external fetch permitted');};
 try{
  const page=await (await f.worker.fetch(request('/p/'+article.id),f.env)).text();
  const links=[...page.matchAll(/href="(https:\/\/reader\.example\/out\/[^" ]+)"/g)].map(match=>new URL(match[1].replaceAll('&amp;','&')));
  assert.equal(links.length,2);
  for(const link of links){const response=await parity(f,link.pathname+link.search,200);assert.equal(response.headers.get('location'),null);assert.ok(response.headers.get('content-security-policy').includes('frame-src https://embed.pixiv.net/'));}
  for(const path of ['/out/'+article.id+'/source','/out/'+article.id+'/source?rev=wrong',links[0].pathname+links[0].search+'&rev=extra',links[0].pathname.replace(article.id,'synthetic-draft')+links[0].search])await parity(f,path,404);
  assert.equal(outboundCalls,0);assert.equal(f.counters().writes,0);assert.equal(f.counters().conversions,0);
 }finally{globalThis.fetch=originalFetch;f.db.close();}
});
test('public HEAD storage failure has GET error status and security headers without content',async()=>{
 const f=fixture();try{
  f.env.DB={prepare(){throw new Error('Synthetic unavailable storage');}};
  for(const path of ['/','/p/'+article.id,'/export/'+article.id+'?format=html','/out/'+article.id+'/source?rev=wrong'])await parity(f,path,503);
 }finally{f.db.close();}
});
test('protected HEAD keeps its original method, owner gate and unsupported-method behavior',async()=>{
 const f=fixture();try{
  for(const authorized of [false,true])for(const path of ['/admin','/api/articles','/api/convert','/api/mcp']){
   const response=await f.worker.fetch(request(path,'HEAD',authorized),f.env);
   assert.equal(response.status,authorized?405:401,path);
  }
  assert.deepEqual(f.counters(),{writes:0,reads:0,conversions:0,authChecks:8});
 }finally{f.db.close();}
});
test('HEAD public routing does not broaden methods, paths or asset dispatch',async()=>{
 const f=fixture(),assetRequests=[];try{
  for(const path of ['/','/p/'+article.id,'/export/'+article.id,'/out/'+article.id+'/source'])for(const method of ['POST','PUT','DELETE'])assert.equal((await f.worker.fetch(request(path,method),f.env)).status,405);
  for(const path of ['/p/'+article.id+'/extra','/export/'+article.id+'/extra','/out/'+article.id+'/source/extra','/unknown'])assert.equal((await f.worker.fetch(request(path,'HEAD'),f.env)).status,404);
  f.env.ASSETS={async fetch(request){assetRequests.push(request.method);return new Response(null,{status:200,headers:{'Content-Type':'text/css','Content-Length':'42',ETag:'"synthetic"','Cache-Control':'public, max-age=10'}});}};
  const response=await f.worker.fetch(request('/styles.css','HEAD'),f.env);
  assert.equal(response.status,200);assert.equal(response.body,null);assert.equal(response.headers.get('content-length'),'42');assert.equal(response.headers.get('etag'),'"synthetic"');assert.equal(response.headers.get('cache-control'),'public, max-age=10');assert.deepEqual(assetRequests,['HEAD']);
  assert.deepEqual(f.counters(),{writes:0,reads:0,conversions:0,authChecks:0});
 }finally{f.db.close();}
});
test('pinned native workerd serves real HTTP HEAD status and metadata, not just suppressed mock bodies',async()=>{
 await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'browser',format:'esm',outfile:'.sites-runtime/public-head-native.mjs',jsx:'automatic'});
 let externalCalls=0;const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 const mf=new Miniflare({cf:false,workers:[{config:{name:'synthetic-public-head',compatibilityDate:config.compatibility_date,manifest:{mainModule:'fixture.mjs',modules:{'fixture.mjs':{type:'esm',contents:readFileSync('.sites-runtime/public-head-native.mjs','utf8')}}}},dev:{outboundService:{type:'fetcher',handler:async()=>{externalCalls++;throw new Error('No external network permitted');}}}}]});
 try{
  const get=path=>mf.dispatchFetch(origin+path),head=path=>mf.dispatchFetch(origin+path,{method:'HEAD'});
  const page=await (await get('/p/sample-safe-reading')).text();
  const outbound=new URL(page.match(/href="(https:\/\/reader\.example\/out\/[^" ]+)"/)[1].replaceAll('&amp;','&'));
  for(const [path,status] of [['/p/sample-safe-reading',200],['/export/sample-safe-reading?format=md',200],['/export/sample-safe-reading?format=html',200],[outbound.pathname+outbound.search,200],[outbound.pathname+'?rev=wrong',404],['/',503],['/admin',503],['/api/articles',503]]){
   const a=await get(path),b=await head(path);
   assert.equal(a.status,status,path+' GET');assert.equal(b.status,status,path+' HEAD');assert.equal(await b.text(),'',path+' body');
   for(const header of ['content-type','content-disposition','cache-control','content-security-policy','x-content-type-options','referrer-policy','etag'])assert.equal(b.headers.get(header),a.headers.get(header),path+' '+header);
   assert.notEqual(b.headers.get('content-length'),'0','Do not claim a zero-length GET representation');
  }
  assert.equal(externalCalls,0);
 }finally{await mf.dispose();}
});
