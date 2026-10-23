import {build} from 'esbuild';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['client/editor-save.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/editor-capability.mjs'});
const {confirmEditorSaveCapability}=await import('../.sites-runtime/editor-capability.mjs');
test('capability requires supported authenticated endpoint, never issues a write',async()=>{
 const original=globalThis.fetch;
 try{
  for(const [status,body,ok] of [[200,{protocol:'compare-v1'},true],[404,{error:'old server'},false],[401,{protocol:'compare-v1'},false],[200,{protocol:'older'},false],[200,null,false],[200,[],false],[200,{error:'missing'},false]]){
   const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(body,{status})};
   if(ok)await confirmEditorSaveCapability();else await assert.rejects(confirmEditorSaveCapability(),/保存リクエストは送っていません/);
   assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/editor/articles');assert.equal(calls[0].options.method,undefined);
  }
 }finally{globalThis.fetch=original;}
});
for(const stage of ['headers','body'])test('capability bounds '+stage+' even when transport ignores abort',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const original=globalThis.fetch;let signal;
 try{
  globalThis.fetch=async(url,options)=>{signal=options.signal;return stage==='headers'?new Promise(()=>{}):new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})};
  const result=assert.rejects(confirmEditorSaveCapability(),/保存リクエストは送っていません/);await Promise.resolve();t.mock.timers.tick(15000);await result;assert.equal(signal.aborted,true);
 }finally{globalThis.fetch=original;t.mock.timers.reset();}
});
