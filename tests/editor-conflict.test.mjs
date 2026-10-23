import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {editorRevision,EDITOR_FIELDS,saveEditorArticle} from '../src/editor-save.mjs';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/editor-conflict-worker.mjs',jsx:'automatic'});
const {createWorker}=await import('../.sites-runtime/editor-conflict-worker.mjs');
const initial={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'Synthetic title',sourceUrl:'https://example.org/source',markdown:'# Original body',published:false,rightsConfirmed:true};
const request=(path,method='GET',body,owner=true)=>new Request('https://reader.example'+path,{method,headers:{...(owner?{'x-fixture-owner':'yes'}:{}),...(body?{origin:'https://reader.example','content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
const worker=createWorker({verifyOwner:async request=>({ok:request.headers.get('x-fixture-owner')==='yes',status:401})});
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_articles.sql','utf8'));let beforeWrite,afterWrite;
 function prepare(sql,args=[]){return {
  bind(...values){return prepare(sql,values)},
  async first(){return db.prepare(sql).get(...args)||null},
  async all(){return {success:true,results:db.prepare(sql).all(...args)}},
  async run(){const before=beforeWrite;beforeWrite=null;before?.(sql);const result=db.prepare(sql).run(...args);const after=afterWrite;afterWrite=null;after?.(sql);return {success:true,meta:{changes:Number(result.changes)}}}
 };}
 const env={DB:{prepare}};
 return {db,env,interpose(fn){beforeWrite=fn},after(fn){afterWrite=fn},row(){return db.prepare('SELECT '+EDITOR_FIELDS.join(',')+' FROM articles').get()}};
}
const post=(f,data,path='/api/editor/articles')=>worker.fetch(request(path,'POST',data),f.env);
const payload=(expectedRevision,changes={})=>({...initial,...changes,protocol:'compare-v1',expectedRevision});
async function seed(f){assert.equal((await post(f,initial,'/api/articles')).status,200);return {...f.row()};}
test('editor capability and mutations retain owner and origin gates',async()=>{
 const f=fixture();assert.equal((await worker.fetch(request('/api/editor/articles','GET',undefined,false),f.env)).status,401);
 assert.deepEqual(await (await worker.fetch(request('/api/editor/articles'),f.env)).json(),{protocol:'compare-v1'});
 assert.equal((await worker.fetch(request('/api/editor/articles','POST',payload(null),false),f.env)).status,401);
 const cross=request('/api/editor/articles','POST',payload(null));cross.headers.set('origin','https://other.example');assert.equal((await worker.fetch(cross,f.env)).status,403);assert.equal(f.row(),undefined);f.db.close();
});
test('actual HTTP handler rejects stale editor body without changing legacy replacement',async()=>{
 const f=fixture(),baseline=await seed(f),rev=await editorRevision(baseline);
 const a=await post(f,payload(rev,{markdown:'# New A body'}));assert.equal(a.status,200);const ack=await a.json();assert.equal(ack.revision,await editorRevision(f.row()));
 const committed={...f.row()},b=await post(f,payload(rev,{title:'B title-only edit'}));assert.equal(b.status,409);assert.equal((await b.json()).code,'EDITOR_CONFLICT');assert.deepEqual({...f.row()},committed);
 assert.equal((await post(f,{...initial,title:'Explicit legacy replace'},'/api/articles')).status,200);assert.equal(f.row().markdown,initial.markdown);f.db.close();
});
for(const [field,value] of [['title','Other title'],['markdown','# Concurrent body'],['source_url','https://example.org/other'],['published',1],['created_at','other-created'],['updated_at','other-updated'],['published_at','other-published']])test('full revision detects '+field+' difference even without a newer timestamp',async()=>{
 const f=fixture(),baseline=await seed(f),revision=await editorRevision(baseline);f.db.prepare('UPDATE articles SET '+field+'=?').run(value);const changed={...f.row()};assert.notEqual(await editorRevision(changed),revision);
 assert.equal((await post(f,payload(revision,{title:'Local edit'}))).status,409);assert.deepEqual({...f.row()},changed);f.db.close();
});
for(const [field,value] of [['title','Racing title'],['markdown','# Racing body'],['source_url','https://example.org/race'],['published',1],['updated_at','same-time-other'],['published_at','race-publication']])test('atomic SQL prevents interposed '+field+' overwrite',async()=>{
 const f=fixture(),before=await seed(f),revision=await editorRevision(before);f.interpose(()=>f.db.prepare('UPDATE articles SET '+field+'=?').run(value));
 assert.equal((await post(f,payload(revision,{title:'Local edit'}))).status,409);assert.equal(f.row()[field],value);assert.equal(f.row().markdown,field==='markdown'?value:before.markdown);f.db.close();
});
test('deleted or newly colliding ID cannot be recreated/overwritten by stale editor',async()=>{
 const f=fixture(),before=await seed(f),revision=await editorRevision(before);f.interpose(()=>f.db.exec('DELETE FROM articles'));assert.equal((await post(f,payload(revision))).status,409);assert.equal(f.row(),undefined);
 f.interpose(()=>f.db.prepare('INSERT INTO articles VALUES (?,?,?,?,?,?,?,?)').run(...EDITOR_FIELDS.map(key=>before[key])));assert.equal((await post(f,payload(null,{markdown:'# Collision'}))).status,409);assert.deepEqual({...f.row()},before);f.db.close();
});
test('success acknowledges only exact committed row, never a subsequent writer revision',async()=>{
 const f=fixture(),before=await seed(f),revision=await editorRevision(before);let ours;
 f.after(()=>{ours={...f.row()};f.db.prepare('UPDATE articles SET markdown=?').run('# Later writer');});
 const response=await post(f,payload(revision,{markdown:'# Our body',published:true}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.revision,await editorRevision(ours));assert.notEqual(result.revision,await editorRevision(f.row()));
 assert.equal((await post(f,payload(result.revision,{markdown:'# Later local edit'}))).status,409);assert.equal(f.row().markdown,'# Later writer');f.db.close();
});
test('malformed conditional protocol never degrades to legacy replacement',async()=>{
 const f=fixture();for(const data of [{...initial},{...payload(null),protocol:'other'},{...payload('x')},{...payload(null),expectedRevision:undefined},{...payload(null),published:true,rightsConfirmed:false}])assert.equal((await post(f,data)).status,400);assert.equal(f.row(),undefined);f.db.close();
});
test('unverifiable write metadata fails closed instead of claiming success',async()=>{
 const f=fixture();const original=f.env.DB.prepare;f.env.DB.prepare=sql=>{const statement=original(sql);const bind=statement.bind;statement.bind=(...args)=>{const bound=bind(...args);bound.run=async()=>({success:true});return bound};return statement};await assert.rejects(saveEditorArticle(f.env,initial,null),/unverified/);f.db.close();
});
