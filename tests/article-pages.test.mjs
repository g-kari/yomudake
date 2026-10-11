import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createAccessGuard} from '../src/access.mjs';
import {exportMarkdown} from '../src/navigation.mjs';
import {
  ARTICLE_PAGE_SIZE,ArticlePageError,encodeArticleCursor,
  decodeArticleCursor,articleCursorFromUrl,
} from '../src/article-pages.mjs';

// This suite never uses the existing worker-test.mjs output or an external DB.
mkdirSync('.sites-runtime',{recursive:true});
await build({
  stdin:{contents:"export {createWorker} from './src/worker.mjs'; export {listArticles,listOwnerArticlePage} from './src/storage.mjs';",resolveDir:process.cwd(),sourcefile:'article-pages-test-entry.mjs'},
  bundle:true,platform:'node',format:'esm',jsx:'automatic',
  outfile:'.sites-runtime/article-pages-test.mjs',
});
const {createWorker,listArticles,listOwnerArticlePage}=await import('../.sites-runtime/article-pages-test.mjs');

const origin='https://synthetic-reader.example';
const owner=async request=>request.headers.get('x-synthetic-owner')==='yes'
  ?{ok:true,status:200}:{ok:false,status:401};
const worker=createWorker({verifyOwner:owner});
const request=(path,authorized=true,headers={})=>new Request(origin+path,{
  headers:{...(authorized?{'x-synthetic-owner':'yes'}:{}),...headers},
});
const cursorPath=cursor=>'/api/articles?'+new URLSearchParams({cursor});
const cursorText=text=>Buffer.from(text,'utf8').toString('base64url');
const cursorValue=value=>cursorText(JSON.stringify(value));
const validValue={version:1,updatedAt:'2026-01-02T03:04:05.678Z',id:'fixture-100'};

function database(t){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync('migrations/'+file,'utf8'));
  t.after(()=>sqlite.close());
  const calls=[];
  function prepare(sql,args=[]){
    return {
      bind(...values){return prepare(sql,values);},
      async all(){calls.push({method:'all',sql,args});return {success:true,results:sqlite.prepare(sql).all(...args)};},
      async first(){calls.push({method:'first',sql,args});return sqlite.prepare(sql).get(...args)||null;},
      async run(){calls.push({method:'run',sql,args});sqlite.prepare(sql).run(...args);return {success:true};},
    };
  }
  let prepares=0;
  const DB={prepare(sql){prepares++;return prepare(sql);}};
  return {DB,sqlite,calls,get prepares(){return prepares;}};
}

function article(index,{sameTime=false,published=index%3===0}={}){
  const updatedAt=sameTime?'2026-01-01T00:00:00.000Z'
    :new Date(Date.UTC(2026,0,1)+Math.floor(index/55)*60_000).toISOString();
  return {
    id:'fixture-'+String(index).padStart(4,'0'),
    title:'Synthetic article '+index,source_url:'',
    markdown:'# Synthetic fixture '+index+'\n\nLocally generated test text.',
    published:published?1:0,created_at:'2025-12-01T00:00:00.000Z',
    updated_at:updatedAt,published_at:published?updatedAt:null,
  };
}

function insert(db,a){
  db.sqlite.prepare('INSERT INTO articles (id,title,source_url,markdown,published,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(a.id,a.title,a.source_url,a.markdown,a.published,a.created_at,a.updated_at,a.published_at);
  return a;
}

function seed(db,count,options={}){
  for(let index=0;index<count;index++)insert(db,article(index,options));
}

const expectedOwnerRows=db=>db.sqlite.prepare('SELECT * FROM articles ORDER BY updated_at DESC,id DESC').all();
const ids=rows=>rows.map(a=>a.id);

function assertHeaders(response){
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-type'),/^application\/json/);
}

async function page(db,cursor=null,server=worker){
  const response=await server.fetch(request(cursor===null?'/api/articles':cursorPath(cursor)),{DB:db.DB});
  assert.equal(response.status,200);
  assertHeaders(response);
  const body=await response.json();
  assert.deepEqual(Object.keys(body).sort(),['articles','nextCursor']);
  assert.ok(Array.isArray(body.articles));
  assert.ok(body.articles.length<=ARTICLE_PAGE_SIZE);
  assert.ok(body.nextCursor===null||typeof body.nextCursor==='string');
  if(body.nextCursor!==null){
    assert.equal(body.articles.length,ARTICLE_PAGE_SIZE);
    assert.ok(body.nextCursor.length<=512);
    assert.match(body.nextCursor,/^[A-Za-z0-9_-]+$/);
    assert.equal(body.nextCursor,encodeArticleCursor(body.articles.at(-1)));
    assert.deepEqual(decodeArticleCursor(body.nextCursor),{
      updatedAt:body.articles.at(-1).updated_at,id:body.articles.at(-1).id,
    });
  }
  return body;
}

test('owner pages cover 0/99/100/101/205 rows exactly once with timestamp ties and mixed visibility',async t=>{
  assert.equal(ARTICLE_PAGE_SIZE,100);
  for(const count of [0,99,100,101,205])await t.test(String(count)+' articles',async t=>{
    const db=database(t);seed(db,count);
    const expected=expectedOwnerRows(db),seen=[],cursors=[];
    let cursor=null;
    do{
      const result=await page(db,cursor);
      seen.push(...result.articles);
      cursor=result.nextCursor;
      if(cursor!==null){assert.ok(!cursors.includes(cursor));cursors.push(cursor);}
    }while(cursor!==null);
    assert.deepEqual(ids(seen),ids(expected));
    assert.equal(new Set(ids(seen)).size,count);
    assert.equal(db.calls.length,Math.max(1,Math.ceil(count/100)));
    assert.ok(seen.some(a=>!a.published)||count===0);
    assert.ok(seen.some(a=>a.published)||count===0);
    for(const [index,call] of db.calls.entries()){
      assert.equal(call.method,'all');
      assert.match(call.sql,/ORDER BY updated_at DESC,\s*id DESC LIMIT 101$/);
      if(index===0){assert.deepEqual(call.args,[]);assert.ok(!call.sql.includes('WHERE'));}
      else{
        const position=decodeArticleCursor(cursors[index-1]);
        assert.match(call.sql,/WHERE updated_at < \? OR \(updated_at = \? AND id < \?\)/);
        assert.deepEqual(call.args,[position.updatedAt,position.updatedAt,position.id]);
        assert.ok(!call.sql.includes(position.id),'the position must be bound, not interpolated');
      }
    }
  });
});

test('all-equal timestamps use descending SQLite id order across each page boundary',async t=>{
  const db=database(t);seed(db,205,{sameTime:true});
  for(const id of ['fixture-A','fixture-Z','fixture-a','fixture-z'])
    insert(db,{...article(0,{sameTime:true}),id});
  const expected=expectedOwnerRows(db),seen=[];
  let cursor=null;
  do{const result=await page(db,cursor);seen.push(...result.articles);cursor=result.nextCursor;}while(cursor!==null);
  assert.deepEqual(ids(seen),ids(expected));
  assert.equal(new Set(ids(seen)).size,209);
  assert.deepEqual(ids(seen.slice(0,4)),['fixture-z','fixture-a','fixture-Z','fixture-A']);
});

test('cursor round trips only valid canonical UTC timestamps and ASCII identifiers',()=>{
  for(const updatedAt of ['2000-02-29T00:00:00Z','2026-01-02T03:04:05.678Z','9999-12-31T23:59:59.999Z'])
    for(const id of ['A','a-Z-09','x'.repeat(80)]){
      const encoded=encodeArticleCursor({updated_at:updatedAt,id});
      assert.equal(encoded,cursorValue({version:1,updatedAt,id}));
      assert.deepEqual(decodeArticleCursor(encoded),{updatedAt,id});
      assert.deepEqual(articleCursorFromUrl(new URL(origin+cursorPath(encoded))),{updatedAt,id});
    }
  assert.equal(articleCursorFromUrl(new URL(origin+'/api/articles')),null);
  assert.equal(articleCursorFromUrl(new URL(origin+'/api/articles?unrelated=value')),null);
});

function nonCanonicalBase64Alias(){
  // Pick an emitted cursor with unused base64 padding bits, then alter only them.
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for(let length=1;length<=3;length++){
    const encoded=cursorValue({...validValue,id:'x'.repeat(length)});
    if(encoded.length%4===0)continue;
    return encoded.slice(0,-1)+alphabet[alphabet.indexOf(encoded.at(-1))|1];
  }
  throw new Error('Unable to construct a synthetic base64 alias');
}

function invalidCursors(){
  const valid=cursorValue(validValue);
  const candidates=[
    ['empty',''],['space',' '],['padding',valid+'='],['newline',valid+'\n'],
    ['illegal alphabet','***'],['one-character base64','A'],
    ['noncanonical padding bits',nonCanonicalBase64Alias()],['overlong','A'.repeat(513)],
    ['invalid JSON',cursorText('{')],['array',cursorValue([validValue])],
    ['null',cursorValue(null)],['number',cursorValue(1)],['string',cursorValue('value')],
    ['missing version',cursorValue({updatedAt:validValue.updatedAt,id:validValue.id})],
    ['missing timestamp',cursorValue({version:1,id:validValue.id})],
    ['missing id',cursorValue({version:1,updatedAt:validValue.updatedAt})],
    ['unknown key',cursorValue({...validValue,offset:100})],
    ['wrong order',cursorValue({id:validValue.id,updatedAt:validValue.updatedAt,version:1})],
    ['leading whitespace',cursorText(' '+JSON.stringify(validValue))],
    ['internal whitespace',cursorText(JSON.stringify(validValue).replace(':',': '))],
    ['duplicate version',cursorText('{"version":2,"version":1,"updatedAt":"'+validValue.updatedAt+'","id":"'+validValue.id+'"}')],
    ['duplicate id',cursorText('{"version":1,"updatedAt":"'+validValue.updatedAt+'","id":"other","id":"'+validValue.id+'"}')],
    ['escaped field spelling',cursorText('{"\\u0076ersion":1,"updatedAt":"'+validValue.updatedAt+'","id":"'+validValue.id+'"}')],
    ['escaped id spelling',cursorText('{"version":1,"updatedAt":"'+validValue.updatedAt+'","id":"\\u0066ixture-100"}')],
  ];
  for(const version of [0,2,-1,'1',null,true,1.5])
    candidates.push(['invalid version '+JSON.stringify(version),cursorValue({...validValue,version})]);
  for(const id of ['', 'x'.repeat(81),'fixture_100','fixture/100','fixture 100','記事','fixture\n100',"x' OR 1=1 --",null,100])
    candidates.push(['invalid id '+JSON.stringify(id),cursorValue({...validValue,id})]);
  for(const updatedAt of [
    '1900-02-29T00:00:00.000Z','2026-02-29T00:00:00.000Z','2026-04-31T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z','2026-01-00T00:00:00.000Z','2026-01-01T24:00:00.000Z',
    '2026-01-01T00:60:00.000Z','2026-01-01T00:00:60.000Z','2026-01-01T00:00:00+00:00',
    '2026-01-01T00:00:00.0Z','2026-01-01T00:00:00.000000Z','2026-01-01T00:00:00z',
    '2026-01-01','not a date',null,1767225600000,
  ])candidates.push(['invalid timestamp '+JSON.stringify(updatedAt),cursorValue({...validValue,updatedAt})]);
  return candidates;
}

test('cursor decoding rejects malformed, noncanonical, repeated and injection-shaped positions',()=>{
  for(const [label,cursor] of invalidCursors())
    assert.throws(()=>decodeArticleCursor(cursor),ArticlePageError,label);
  for(const cursor of [undefined,null,1,{},[]])
    assert.throws(()=>decodeArticleCursor(cursor),ArticlePageError);
  const good=cursorValue(validValue);
  for(const query of [new URLSearchParams([['cursor',good],['cursor',good]]),new URLSearchParams([['cursor',''],['cursor',good]])])
    assert.throws(()=>articleCursorFromUrl(new URL(origin+'/api/articles?'+query)),ArticlePageError);
  assert.throws(()=>encodeArticleCursor({updated_at:'2026-02-29T00:00:00Z',id:'fixture'}),/storage page position unavailable/);
  assert.throws(()=>encodeArticleCursor({updated_at:validValue.updatedAt,id:"x' OR 1=1 --"}),/storage page position unavailable/);
});

test('invalid owner API cursors fail with a static 400 before preparing or reading the DB',async t=>{
  const db=database(t);seed(db,205);
  const malformed=[...invalidCursors().map(([label,cursor])=>[label,cursorPath(cursor)]),
    ['duplicate query',cursorPath(cursorValue(validValue))+'&cursor='+cursorValue(validValue)],
    ['percent-encoded duplicate','/api/articles?cursor='+cursorValue(validValue)+'&%63ursor='+cursorValue(validValue)],
  ];
  for(const [label,path] of malformed){
    const response=await worker.fetch(request(path),{DB:db.DB});
    assert.equal(response.status,400,label);assertHeaders(response);
    assert.deepEqual(await response.json(),{error:new ArticlePageError().message},label);
  }
  assert.equal(db.prepares,0);assert.deepEqual(db.calls,[]);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM articles').get().count,205);
});

test('signed owner authentication precedes cursor parsing and all DB reads',async t=>{
  const db=database(t);seed(db,101);
  const keys=await generateKeyPair('RS256',{extractable:true});
  const jwk={...await exportJWK(keys.publicKey),kid:'synthetic-pagination-key',alg:'RS256'};
  const env={DB:db.DB,ACCESS_TEAM_DOMAIN:'https://synthetic-pagination.cloudflareaccess.com',ACCESS_AUD:'synthetic-pagination-audience',OWNER_EMAIL:'owner@example.test'};
  const server=createWorker({verifyOwner:createAccessGuard({jwks:{keys:[jwk]}})});
  const sign=email=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid})
    .setIssuer(env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD)
    .setSubject('synthetic-pagination-subject').setExpirationTime('5m').sign(keys.privateKey);
  const other=await sign('other@example.test');
  for(const [token,status] of [[undefined,401],['forged.jwt.token',401],[other,403]])
    for(const path of ['/api/articles',cursorPath('***'),'/api/articles?cursor=bad&cursor=bad']){
      const response=await server.fetch(request(path,false,{
        ...(token?{'cf-access-jwt-assertion':token}:{}),
        'cf-access-authenticated-user-email':env.OWNER_EMAIL,
        'oai-authenticated-user-email':env.OWNER_EMAIL,
      }),env);
      assert.equal(response.status,status);assertHeaders(response);
      assert.deepEqual(Object.keys(await response.json()),['error']);
    }
  assert.equal(db.prepares,0);assert.deepEqual(db.calls,[]);
  const ownerHeaders={'cf-access-jwt-assertion':await sign(env.OWNER_EMAIL)};
  const invalid=await server.fetch(request(cursorPath('***'),false,ownerHeaders),env);
  assert.equal(invalid.status,400);assert.equal(db.prepares,0);
  const valid=await server.fetch(request('/api/articles',false,ownerHeaders),env);
  assert.equal(valid.status,200);const body=await valid.json();
  assert.equal(body.articles.length,100);assert.equal(typeof body.nextCursor,'string');
  assert.equal(db.calls.length,1);
});

test('valid but arbitrary owner positions remain parameterized keyset hints',async t=>{
  const db=database(t);seed(db,205);
  const position={updatedAt:'2026-01-01T00:01:00.000Z',id:'fixture-0090'};
  const result=await page(db,cursorValue({version:1,...position}));
  const expected=db.sqlite.prepare('SELECT * FROM articles WHERE updated_at < ? OR (updated_at = ? AND id < ?) ORDER BY updated_at DESC,id DESC LIMIT 100')
    .all(position.updatedAt,position.updatedAt,position.id);
  assert.deepEqual(ids(result.articles),ids(expected));
  assert.deepEqual(db.calls[0].args,[position.updatedAt,position.updatedAt,position.id]);
  assert.ok(!db.calls[0].sql.includes(position.id));
  const empty=await page(db,cursorValue({version:1,updatedAt:'2000-01-01T00:00:00Z',id:'A'}));
  assert.deepEqual(empty,{articles:[],nextCursor:null});
});

test('missing, failed, throwing and malformed page storage fail closed with static 503 errors',async()=>{
  const detail='synthetic private database detail; fixture-0100; SELECT secret FROM articles';
  const environments=[
    {},{DB:{prepare(){throw new Error(detail);}}},
    {DB:{prepare(){return {async all(){throw new Error(detail);}};}}},
    {DB:{prepare(){return {async all(){return {success:false,error:detail,results:[article(0)]};}};}}},
    {DB:{prepare(){return {async all(){return {success:true,results:Array.from({length:101},(_,index)=>({...article(index),updated_at:'not a date'}))};}};}}},
  ];
  let expected=null;
  for(const env of environments){
    const response=await worker.fetch(request('/api/articles'),env);
    assert.equal(response.status,503);assertHeaders(response);
    const body=await response.json();assert.deepEqual(Object.keys(body),['error']);
    if(expected===null)expected=body;else assert.deepEqual(body,expected);
    assert.ok(!JSON.stringify(body).includes('synthetic'));
    assert.ok(!JSON.stringify(body).includes('fixture'));
    assert.ok(!JSON.stringify(body).includes('SELECT'));
    assert.equal((await worker.fetch(request(cursorPath('***')),env)).status,400);
  }
  await assert.rejects(()=>listOwnerArticlePage({}),/storage unavailable/);
});

test('public latest-100 behavior, old published direct views and exports remain independent of owner pagination',async t=>{
  const db=database(t);
  for(let index=0;index<305;index++)insert(db,article(index,{published:index%2===0}));
  const env={DB:db.DB};
  const expected=db.sqlite.prepare('SELECT * FROM articles WHERE published = 1 ORDER BY updated_at DESC LIMIT 100').all();
  const publicRows=await listArticles(env,true);
  assert.deepEqual(ids(publicRows),ids(expected));assert.equal(publicRows.length,100);
  assert.ok(publicRows.every(a=>a.published===1));
  const publicCall=db.calls.at(-1);
  assert.match(publicCall.sql,/WHERE published = 1 ORDER BY updated_at DESC LIMIT 100$/);
  assert.deepEqual(publicCall.args,[]);
  const home=await worker.fetch(request('/',false),env);assert.equal(home.status,200);
  const homeText=await home.text();
  const links=[...homeText.matchAll(/class="article-card" href="\/p\/([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(links,[...ids(expected),'sample-safe-reading']);
  const oldPublished=article(0,{published:true}),oldDraft=article(1,{published:false});
  assert.ok(!links.includes(oldPublished.id));assert.ok(!links.includes(oldDraft.id));
  const publishedView=await worker.fetch(request('/p/'+oldPublished.id,false),env);
  assert.equal(publishedView.status,200);assert.ok((await publishedView.text()).includes(oldPublished.title));
  const markdown=await worker.fetch(request('/export/'+oldPublished.id+'?format=md',false),env);
  assert.equal(markdown.status,200);assert.equal(await markdown.text(),exportMarkdown(oldPublished));
  const html=await worker.fetch(request('/export/'+oldPublished.id+'?format=html',false),env);
  assert.equal(html.status,200);assert.equal(html.headers.get('cache-control'),'no-store, no-transform');
  assert.ok((await html.text()).includes(oldPublished.title));
  for(const path of ['/p/'+oldDraft.id,'/export/'+oldDraft.id+'?format=md','/export/'+oldDraft.id+'?format=html'])
    assert.equal((await worker.fetch(request(path,false),env)).status,404,path);
  const ownerFirst=await page(db);assert.ok(ownerFirst.articles.some(a=>!a.published));
  const second=await page(db,ownerFirst.nextCursor);assert.ok(second.articles.some(a=>!a.published));
});

test('concurrent inserts and forward updates follow the live keyset without promising a transactional snapshot',async t=>{
  const db=database(t);seed(db,205,{sameTime:true});
  const first=await page(db);const position=decodeArticleCursor(first.nextCursor);
  assert.equal(position.id,'fixture-0105');
  const newer='2026-10-10T12:00:00.000Z';
  const ahead=insert(db,{...article(999,{sameTime:true}),id:'fixture-new-ahead',updated_at:newer});
  const behind=insert(db,{...article(50,{sameTime:true}),id:'fixture-0050-added'});
  // A not-yet-loaded row moves above the cursor; a loaded row moves forward too.
  db.sqlite.prepare('UPDATE articles SET updated_at = ? WHERE id IN (?,?)').run(newer,'fixture-0030','fixture-0204');
  const liveRemainder=db.sqlite.prepare('SELECT * FROM articles WHERE updated_at < ? OR (updated_at = ? AND id < ?) ORDER BY updated_at DESC,id DESC')
    .all(position.updatedAt,position.updatedAt,position.id);
  const remainder=[];let cursor=first.nextCursor;
  do{const result=await page(db,cursor);remainder.push(...result.articles);cursor=result.nextCursor;}while(cursor!==null);
  assert.deepEqual(ids(remainder),ids(liveRemainder));
  assert.ok(ids(remainder).includes(behind.id));assert.ok(!ids(remainder).includes(ahead.id));
  assert.ok(!ids(remainder).includes('fixture-0030'));
  const combined=[...ids(first.articles),...ids(remainder)];
  assert.equal(new Set(combined).size,combined.length);
  const refreshed=await page(db);
  assert.ok(ids(refreshed.articles).includes(ahead.id));
  assert.ok(ids(refreshed.articles).includes('fixture-0030'));
  assert.ok(ids(refreshed.articles).includes('fixture-0204'));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM articles').get().count,207);
});
