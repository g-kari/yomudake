import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createAccessGuard} from '../src/access.mjs';
import * as pages from '../src/article-pages.mjs';

// Only synthetic articles, local SQLite and synthetic Access keys are used.
mkdirSync('.sites-runtime',{recursive:true});
await build({
  stdin:{contents:"export {createWorker} from './src/worker.mjs'; export {listOwnerArticlePage} from './src/storage.mjs';",resolveDir:process.cwd(),sourcefile:'article-search-test-entry.mjs'},
  bundle:true,platform:'node',format:'esm',jsx:'automatic',
  outfile:'.sites-runtime/article-search-test.mjs',
});
const {createWorker,listOwnerArticlePage}=await import('../.sites-runtime/article-search-test.mjs');
const origin='https://synthetic-search.example';
const worker=createWorker({verifyOwner:async request=>request.headers.get('x-synthetic-owner')==='yes'?{ok:true}:{ok:false,status:401}});
const request=(path,authorized=true,headers={})=>new Request(origin+path,{headers:{...(authorized?{'x-synthetic-owner':'yes'}:{}),...headers}});
const searchPath=(query,cursor=null)=>'/api/articles?'+new URLSearchParams({q:query,...(cursor===null?{}:{cursor})});
const cursorValue=value=>Buffer.from(JSON.stringify(value),'utf8').toString('base64url');
const position={updatedAt:'2026-01-01T00:00:00.000Z',id:'search-0100'};
const ids=articles=>articles.map(article=>article.id);

function database(t){
  const sqlite=new DatabaseSync(':memory:');
  for(const name of readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync('migrations/'+name,'utf8'));
  t.after(()=>sqlite.close());
  const calls=[];
  let prepares=0;
  function statement(sql,args=[]){return {
    bind(...values){return statement(sql,values);},
    async all(){calls.push({sql,args});return {success:true,results:sqlite.prepare(sql).all(...args)};},
    async first(){calls.push({sql,args});return sqlite.prepare(sql).get(...args)||null;},
  };}
  return {sqlite,calls,DB:{prepare(sql){prepares++;return statement(sql);}},get prepares(){return prepares;}};
}
function article(index,overrides={}){
  return {
    id:'search-'+String(index).padStart(4,'0'),title:'Synthetic article '+index,source_url:'',
    markdown:'# Synthetic body '+index+'\n\nbody-only-needle',published:index%2,
    created_at:'2025-12-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z',
    published_at:index%2?'2026-01-01T00:00:00.000Z':null,...overrides,
  };
}
function insert(db,row){
  db.sqlite.prepare('INSERT INTO articles (id,title,source_url,markdown,published,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(row.id,row.title,row.source_url,row.markdown,row.published,row.created_at,row.updated_at,row.published_at);
  return row;
}
function assertHeaders(response){
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-type'),/^application\/json/);
}
async function page(db,query,cursor=null){
  const response=await worker.fetch(request(searchPath(query,cursor)),{DB:db.DB});
  assert.equal(response.status,200);assertHeaders(response);
  const result=await response.json(),normalized=query.trim();
  assert.deepEqual(Object.keys(result).sort(),normalized?['articles','nextCursor','query']:['articles','nextCursor']);
  if(normalized)assert.equal(result.query,normalized);
  assert.ok(result.articles.length<=100);
  if(result.nextCursor!==null){
    assert.equal(result.articles.length,100);
    assert.ok(result.nextCursor.length<=(normalized?1024:512));
    assert.equal(result.nextCursor,pages.encodeArticleCursor(result.articles.at(-1),normalized));
    assert.deepEqual(pages.decodeArticleCursor(result.nextCursor,normalized),{
      updatedAt:result.articles.at(-1).updated_at,id:result.articles.at(-1).id,
    });
  }
  return result;
}

test('query normalization trims only outer whitespace and counts raw JavaScript code units',()=>{
  assert.equal(typeof pages.normalizeArticleQuery,'function');
  assert.equal(typeof pages.articleQueryFromUrl,'function');
  for(const [input,expected] of [[undefined,''],['',''],[' \t\r\n　',''],['  Title  ','Title'],['a  b','a  b'],['　日本語😀　','日本語😀'],['x'.repeat(100),'x'.repeat(100)],['😀'.repeat(50),'😀'.repeat(50)]])
    assert.equal(pages.normalizeArticleQuery(input),expected);
  for(const value of [null,1,true,[],{},'x'.repeat(101),' '.repeat(101),'😀'.repeat(51),' '+'x'.repeat(100)])
    assert.throws(()=>pages.normalizeArticleQuery(value),pages.ArticlePageError);
  assert.equal(pages.articleQueryFromUrl(new URL(origin+'/api/articles')),'');
  assert.equal(pages.articleQueryFromUrl(new URL(origin+searchPath('  日本語 + %  '))),'日本語 + %');
  for(const params of ['q=a&q=b','q=&q=','q=a&%71=b','q='+('x'.repeat(101))])
    assert.throws(()=>pages.articleQueryFromUrl(new URL(origin+'/api/articles?'+params)),pages.ArticlePageError);
});

test('owner search reaches the 101st and older stored articles instead of filtering only the first page',async t=>{
  const db=database(t);
  for(let index=0;index<305;index++)insert(db,article(index,{title:index===0?'Oldest special needle':'Unrelated '+index}));
  const result=await page(db,'  SPECIAL Needle  ');
  assert.deepEqual(ids(result.articles),['search-0000']);assert.equal(result.nextCursor,null);
  assert.equal(result.articles[0].published,0);
  assert.equal(db.calls.length,1);
  assert.match(db.calls[0].sql,/ORDER BY updated_at DESC,\s*id DESC LIMIT 101$/);
  assert.ok(!db.calls[0].sql.includes('SPECIAL Needle'));
});

test('filtered keyset pages cover over 205 mixed draft/public matches exactly once with ties and grouped predicates',async t=>{
  const db=database(t);
  for(let index=0;index<360;index++)insert(db,article(index,{
    title:index%3===0?'Not a result':'Shared NEEDLE '+index,
    source_url:index%3===0?'':'https://source.example/needle',
    updated_at:new Date(Date.UTC(2026,0,1)+Math.floor(index/60)*60_000).toISOString(),
  }));
  const expected=db.sqlite.prepare("SELECT * FROM articles WHERE title LIKE '%needle%' ORDER BY updated_at DESC,id DESC").all();
  const seen=[],cursors=[];let cursor=null;
  do{
    const result=await page(db,'needle',cursor);seen.push(...result.articles);cursor=result.nextCursor;
    if(cursor!==null){assert.ok(!cursors.includes(cursor));cursors.push(cursor);}
  }while(cursor!==null);
  assert.equal(expected.length,240);assert.deepEqual(ids(seen),ids(expected));
  assert.equal(new Set(ids(seen)).size,240);
  assert.ok(seen.some(row=>row.published===0));assert.ok(seen.some(row=>row.published===1));
  assert.equal(db.calls.length,3);
  for(const [index,call] of db.calls.entries()){
    assert.match(call.sql,/ORDER BY updated_at DESC,\s*id DESC LIMIT 101$/);
    assert.ok(!call.sql.includes('needle'),'query text must only appear in bound arguments');
    if(index===0)assert.deepEqual(call.args,['needle','needle']);
    else{
      const point=pages.decodeArticleCursor(cursors[index-1],'needle');
      assert.deepEqual(call.args,['needle','needle',point.updatedAt,point.updatedAt,point.id]);
      assert.ok(!call.sql.includes(point.id));
    }
  }
});

test('Unicode query pages round trip through owner URL parsing, SQLite and version 2 cursor boundaries',async t=>{
  const db=database(t),query='保存記事 😀';
  for(let index=0;index<215;index++)insert(db,article(index,{
    title:index%2===0?'One '+query+' title':'Unrelated title',
    source_url:index%2===0?'':'https://source.example/'+query,
  }));
  const seen=[];let cursor=null;
  do{const result=await page(db,query,cursor);seen.push(...result.articles);cursor=result.nextCursor;}while(cursor!==null);
  assert.deepEqual(ids(seen),Array.from({length:215},(_,index)=>'search-'+String(214-index).padStart(4,'0')));
  assert.equal(db.calls.length,3);
  const limitQuery='界'.repeat(100);
  insert(db,article(999,{title:limitQuery}));
  assert.deepEqual(ids((await page(db,limitQuery)).articles),['search-0999']);
});

test('title OR source URL uses literal ASCII-insensitive substring matching without searching Markdown',async t=>{
  const db=database(t);
  const fixtures=[
    article(1,{title:'A MiXeD Needle Title'}),
    article(2,{source_url:'https://SOURCE.example/MiXeD-needle'}),
    article(3,{title:'日本語の保存記事 😀 星'}),
    article(4,{source_url:'https://source.example/日本語/😀'}),
    article(5,{title:'Only % literal'}),article(6,{title:'Only _ literal'}),
    article(7,{title:"Only ' literal"}),article(8,{title:'Only \\ literal'}),
    article(9,{title:'Only wildcard-looking literal'}),
    article(10,{title:'Unicode Ä and composed é'}),
    article(11,{title:'<script>untrusted-search</script>'}),
    article(12,{source_url:'https://source.example/100%_quoted\'\\path'}),
  ];
  for(const fixture of fixtures)insert(db,fixture);
  let searchSql=null;
  for(const [query,expected] of [
    ['mixed',[2,1]],['mixed NEEDLE',[1]],['SOURCE.EXAMPLE',[12,4,2]],['日本語',[4,3]],['😀',[4,3]],
    ['%',[12,5]],['_',[12,6]],["'",[12,7]],['\\',[12,8]],['100%_quoted\'\\',[12]],
    ['body-only-needle',[]],["' OR 1=1 --",[]],['unmatched',[]],['ä',[]],['Ä',[10]],['e\u0301',[]],['é',[10]],
    ['<script>',[11]],
  ]){
    const result=await page(db,query);
    assert.deepEqual(ids(result.articles),expected.map(index=>'search-'+String(index).padStart(4,'0')),query);
    assert.equal(result.nextCursor,null);
    assert.deepEqual(db.calls.at(-1).args,[query,query]);
    if(searchSql===null)searchSql=db.calls.at(-1).sql;
    else assert.equal(db.calls.at(-1).sql,searchSql,'query text never changes the prepared SQL');
  }
  for(const empty of ['', ' \t　']){
    const result=await page(db,empty);assert.equal(result.articles.length,fixtures.length);
    assert.equal('query' in result,false);assert.deepEqual(db.calls.at(-1).args,[]);
  }
});

test('nonempty search cursors are canonical Unicode-safe version 2 values bound to the exact normalized query',()=>{
  for(const query of ['Needle','日本語 😀 星','%_\'\\','a  b','😀'.repeat(50),'\0'.repeat(100),'\ud800']){
    const source={updated_at:position.updatedAt,id:position.id};
    const encoded=pages.encodeArticleCursor(source,query);
    assert.equal(encoded,cursorValue({version:2,...position,query}));
    assert.ok(encoded.length<=1024);assert.deepEqual(pages.decodeArticleCursor(encoded,query),position);
    if(query.length<=98)assert.deepEqual(pages.decodeArticleCursor(encoded,' '+query+' '),position);
    assert.deepEqual(pages.articleCursorFromUrl(new URL(origin+searchPath(query,encoded)),query),position);
    for(const other of ['',query+'x',query==='Needle'?'needle':'Needle'])
      assert.throws(()=>pages.decodeArticleCursor(encoded,other),pages.ArticlePageError);
    assert.throws(()=>pages.decodeArticleCursor(pages.encodeArticleCursor(source),query),pages.ArticlePageError);
  }
  const maximal=pages.encodeArticleCursor({updated_at:position.updatedAt,id:'x'.repeat(80)},'\0'.repeat(100));
  assert.ok(maximal.length<=1024);assert.ok(maximal.length>512);
  assert.deepEqual(pages.decodeArticleCursor(maximal,'\0'.repeat(100)),{updatedAt:position.updatedAt,id:'x'.repeat(80)});
  assert.throws(()=>pages.decodeArticleCursor(maximal),pages.ArticlePageError);
  const unfiltered=pages.encodeArticleCursor({updated_at:position.updatedAt,id:position.id});
  assert.equal(unfiltered,cursorValue({version:1,...position}));
  assert.deepEqual(pages.decodeArticleCursor(unfiltered),position);
});

test('searched cursor validation rejects malformed UTF-8, JSON, fields, encoding, versions and query contexts',()=>{
  const valid={version:2,...position,query:'日本語'};
  const encoded=cursorValue(valid),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const alias=encoded.length%4?encoded.slice(0,-1)+alphabet[alphabet.indexOf(encoded.at(-1))|1]:null;
  const invalid=[
    '',encoded+'=',encoded+'\n','A','*','A'.repeat(1025),
    Buffer.from([0xc3,0x28]).toString('base64url'),Buffer.from([0xef,0xbb,0xbf,...Buffer.from(JSON.stringify(valid))]).toString('base64url'),
    Buffer.from('{','utf8').toString('base64url'),cursorValue(null),cursorValue([valid]),
    cursorValue({...valid,version:1}),cursorValue({...valid,version:3}),cursorValue({...valid,query:''}),
    cursorValue({...valid,query:'日本語 '}),cursorValue({...valid,query:'日本語x'}),cursorValue({...valid,query:1}),
    cursorValue({...valid,query:'x'.repeat(101)}),cursorValue({...valid,extra:true}),
    cursorValue({query:valid.query,...valid}),
    cursorValue({...valid,id:"x' OR 1=1 --"}),cursorValue({...valid,updatedAt:'2026-02-29T00:00:00Z'}),
    Buffer.from(JSON.stringify(valid).replace(':',': '),'utf8').toString('base64url'),
    Buffer.from(JSON.stringify(valid).replace('"version":2','"version":1,"version":2'),'utf8').toString('base64url'),
    Buffer.from(JSON.stringify(valid).replace('"query":"日本語"','"query":"wrong","query":"日本語"'),'utf8').toString('base64url'),
    Buffer.from(JSON.stringify(valid).replace('日本語','\\u65e5本語'),'utf8').toString('base64url'),
    ...(alias?[alias]:[]),
  ];
  for(const cursor of invalid)assert.throws(()=>pages.decodeArticleCursor(cursor,'日本語'),pages.ArticlePageError,String(cursor));
  for(const query of [null,1,'x'.repeat(101)])
    assert.throws(()=>pages.decodeArticleCursor(encoded,query),pages.ArticlePageError);
  for(const path of [searchPath('日本語',encoded)+'&cursor='+encoded,searchPath('日本語',encoded)+'&%63ursor='+encoded])
    assert.throws(()=>pages.articleCursorFromUrl(new URL(origin+path),'日本語'),pages.ArticlePageError);
});

test('invalid or repeated query and mismatched cursor fail with safe 400 before any DB preparation',async t=>{
  const db=database(t);insert(db,article(1));
  const legacy=pages.encodeArticleCursor({updated_at:position.updatedAt,id:position.id});
  const search=cursorValue({version:2,...position,query:'original'});
  for(const path of [
    '/api/articles?q=a&q=b','/api/articles?q=&q=','/api/articles?q=a&%71=b',
    searchPath('x'.repeat(101)),searchPath(' '.repeat(101)),searchPath('😀'.repeat(51)),
    searchPath('query',legacy),searchPath('another',search),'/api/articles?cursor='+search,
    searchPath('query','***'),searchPath('query','A'.repeat(1025)),
  ]){
    const response=await worker.fetch(request(path),{DB:db.DB});
    assert.equal(response.status,400,path);assertHeaders(response);
    assert.deepEqual(await response.json(),{error:new pages.ArticlePageError().message});
  }
  assert.equal(db.prepares,0);assert.deepEqual(db.calls,[]);
});

test('real signed owner validation runs before query/cursor parsing and all article storage reads',async t=>{
  const db=database(t);insert(db,article(1,{title:'Private owner needle',published:0}));
  const keys=await generateKeyPair('RS256',{extractable:true});
  const jwk={...await exportJWK(keys.publicKey),kid:'synthetic-search-key',alg:'RS256'};
  const env={DB:db.DB,ACCESS_TEAM_DOMAIN:'https://synthetic-search.cloudflareaccess.com',ACCESS_AUD:'synthetic-search-audience',OWNER_EMAIL:'owner@example.test'};
  const server=createWorker({verifyOwner:createAccessGuard({jwks:{keys:[jwk]},fetch:async()=>{throw new Error('Unexpected external request');}})});
  const sign=email=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid})
    .setIssuer(env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setSubject('synthetic-search-subject').setExpirationTime('5m').sign(keys.privateKey);
  for(const [token,status] of [[undefined,401],['forged.jwt.token',401],[await sign('other@example.test'),403]])
    for(const path of [searchPath('needle'),'/api/articles?q=a&q=b',searchPath('x'.repeat(101)),searchPath('needle','***')]){
      const response=await server.fetch(request(path,false,{
        ...(token?{'cf-access-jwt-assertion':token}:{}),
        'cf-access-authenticated-user-email':env.OWNER_EMAIL,'oai-authenticated-user-email':env.OWNER_EMAIL,
      }),env);
      assert.equal(response.status,status);assertHeaders(response);
      assert.deepEqual(Object.keys(await response.json()),['error']);
    }
  assert.equal(db.prepares,0);assert.deepEqual(db.calls,[]);
  const headers={'cf-access-jwt-assertion':await sign(env.OWNER_EMAIL)};
  assert.equal((await server.fetch(request('/api/articles?q=a&q=b',false,headers),env)).status,400);
  assert.equal(db.prepares,0);
  const response=await server.fetch(request(searchPath('needle'),false,headers),env);
  assert.equal(response.status,200);assertHeaders(response);
  const result=await response.json();assert.equal(result.query,'needle');assert.deepEqual(ids(result.articles),['search-0001']);
});

test('missing, failed and throwing searched storage fail closed without leaking query or storage diagnostics',async()=>{
  const query='synthetic-sensitive-search',detail='synthetic private SQL detail';
  for(const env of [
    {},{DB:{prepare(){throw new Error(detail);}}},
    {DB:{prepare(){return {bind(){return this;},async all(){throw new Error(detail);}};}}},
    {DB:{prepare(){return {bind(){return this;},async all(){return {success:false,error:detail,results:[article(1)]};}};}}},
    {DB:{prepare(){return {bind(){return this;},async all(){return {success:true,results:Array.from({length:101},(_,index)=>article(index,{updated_at:'bad time'}))};}};}}},
  ]){
    const response=await worker.fetch(request(searchPath(query)),env);assert.equal(response.status,503);assertHeaders(response);
    const body=await response.json();assert.deepEqual(Object.keys(body),['error']);
    assert.ok(!JSON.stringify(body).includes('synthetic'));assert.ok(!JSON.stringify(body).includes('SQL'));
    assert.equal((await worker.fetch(request(searchPath('x'.repeat(101))),env)).status,400);
  }
  await assert.rejects(()=>listOwnerArticlePage({},null,'needle'),/storage unavailable/);
});

test('public latest articles ignore q entirely and cannot reveal matching drafts or accept owner search cursors',async t=>{
  const db=database(t);
  for(let index=0;index<205;index++)insert(db,article(index,{title:index===0?'Hidden draft needle':'Public fixture '+index}));
  const env={DB:db.DB};
  const plain=await worker.fetch(request('/',false),env),searched=await worker.fetch(request('/?q=needle&cursor=***',false),env);
  assert.equal(plain.status,200);assert.equal(searched.status,200);assert.equal(await plain.text(),await searched.text());
  const call=db.calls.at(-1);assert.deepEqual(call.args,[]);
  assert.match(call.sql,/WHERE published = 1 ORDER BY updated_at DESC LIMIT 100$/);
  const response=await worker.fetch(request('/p/search-0000?q=needle',false),env);assert.equal(response.status,404);
  const result=await page(db,'needle');assert.deepEqual(ids(result.articles),['search-0000']);
});
