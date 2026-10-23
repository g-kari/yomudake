import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

const fixture=String.raw`
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Editor from './client/editor';
import {editorRevision} from './src/editor-save.mjs';
window.IS_REACT_ACT_ENVIRONMENT=true;
const first={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'First public fixture',source_url:'https://example.org/first',markdown:'# First synthetic body',published:1,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z',published_at:'2026-10-09T00:00:00Z'};
const second={...first,id:'dcbe3c20-d502-44dd-b8c4-356585b3985d',title:'Second public fixture',source_url:'https://example.org/second',markdown:'# Second synthetic body'};
let root,copies=[],posts=[],lists=[],conversions=[],confirmations=[],accept=true,capabilities=[],refreshes=[];
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>new Promise((resolve,reject)=>copies.push({value,resolve,reject}))}});
window.confirm=message=>{confirmations.push(message);return accept;};
window.fetch=(url,options={})=>{
 if(url==='/api/editor/articles'&&(!options.method||options.method==='GET'))return new Promise((resolve,reject)=>capabilities.push({resolve,reject}));
 if(url==='/api/articles'&&(!options.method||options.method==='GET')){lists.push({url,options});if(lists.length===1)return Promise.resolve(Response.json({articles:[first,second]}));return new Promise((resolve,reject)=>refreshes.push({resolve,reject}));}
 if(url==='/api/editor/articles'&&options.method==='POST')return new Promise(resolve=>posts.push({url,options,resolve}));
 if(url==='/api/convert'&&options.method==='POST')return new Promise(resolve=>conversions.push({url,options,resolve}));
 throw new Error('Unexpected synthetic request: '+url);
};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const element=selector=>{const found=document.querySelector(selector);check(found,'Missing element: '+selector);return found;};
const button=text=>{const found=[...document.querySelectorAll('button')].find(b=>b.textContent===text);check(found,'Missing button: '+text);return found;};
const notice=()=>document.querySelector('.notice')?.textContent||'';
const unloadWarns=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
const snapshot=()=>({title:element('input[name="title"]').value,markdown:element('#markdown-body').value,source:element('#source-url').value,rights:element('.rights-check input').checked,dirty:unloadWarns(),status:element('.document-status').textContent,share:document.querySelector('#share-url')?.value||'',tab:element('.writing-surface').className});
const equal=(a,b,message)=>check(JSON.stringify(a)===JSON.stringify(b),message+': '+JSON.stringify(a)+' != '+JSON.stringify(b));
async function click(text){await act(async()=>button(text).click());}
async function edit(selector,value){await act(async()=>{const target=element(selector),prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));});}
async function unmount(){if(root){await act(async()=>root.unmount());root=null;}}
async function setup(){copies=[];posts=[];lists=[];conversions=[];confirmations=[];capabilities=[];refreshes=[];accept=true;root=createRoot(element('#root'));await act(async()=>root.render(<Editor signOutPath="/synthetic-signout"/>));await click('First public fixture公開中 · 2026-10-09');}
async function settle(copy,outcome){await act(async()=>outcome==='success'?copy.resolve():copy.reject(new Error('Synthetic private clipboard failure')));}
async function saveReply(outcome){const pending=posts[0],input=JSON.parse(pending.options.body);await act(async()=>pending.resolve(Response.json(outcome==='success'?{protocol:'compare-v1',revision:'a'.repeat(64),id:input.id,published:false,url:'/p/'+input.id}:{error:'Synthetic save rejection'},{status:outcome==='success'?200:503})));}
async function preserveNotice(copy,outcome){const expected=notice(),before=snapshot(),network={posts:posts.length,lists:lists.length,conversions:conversions.length},copyCount=copies.length;await settle(copy,outcome);equal(snapshot(),before,'Late copy changed current document');equal({posts:posts.length,lists:lists.length,conversions:conversions.length},network,'Late copy issued or replayed a request');check(copies.length===copyCount,'Late copy retried clipboard');check(saveNotice()===expected,'Late copy replaced current notice: '+JSON.stringify({expected,actual:notice()}));check(!document.body.textContent.includes('Synthetic private clipboard failure'),'Raw clipboard error leaked');}
const local='# Local conflicting draft 🦊\n\nThis stays in the editor, not the newer server row.\n';
const newer={...first,title:'Newer writer title',markdown:'# Newer server body',updated_at:'2026-10-22T23:00:00Z'};
const saveNotice=()=>document.querySelector('.editor-main > .notice')?.textContent||'';
const snapshots=[],downloadClicks=[];
const createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL,anchorClick=window.HTMLAnchorElement.prototype.click;
URL.createObjectURL=blob=>{const href='blob:compare-copy-'+snapshots.length;snapshots.push({blob,href});return href;};
URL.revokeObjectURL=()=>{};
window.HTMLAnchorElement.prototype.click=function(){downloadClicks.push({href:this.href,download:this.download});};
async function until(predicate,label){const deadline=Date.now()+1500;while(!predicate()){check(Date.now()<deadline,label);await act(async()=>{await new Promise(resolve=>setImmediate(resolve));});}}
async function capabilityReply(status=200,index=0){await act(async()=>capabilities[index].resolve(Response.json(status===200?{protocol:'compare-v1'}:{error:'Synthetic old server'},{status})));}
async function copyWhileBusy(){check(element('#markdown-body').disabled,'Save pipeline not locked');check(!button('コピー').disabled,'Pending-save clipboard action is not reachable in the actual UI');await click('コピー');check(copies.length===1,'DOM copy click did not start exactly once');}
async function beginSave(){await edit('#markdown-body',local);await click('非公開で保存');check(capabilities.length===1&&posts.length===0,'Save skipped capability or sent mutation early');}
async function exportLocal(){const before=snapshot(),count={posts:posts.length,lists:lists.length,capabilities:capabilities.length},notice=saveNotice();await click('Markdown本文を端末に書き出す');check(await snapshots.at(-1).blob.text()===local,'Export used server body or stale ref');check(downloadClicks.at(-1).download==='yomudake-draft.md','Unexpected download contract');equal(snapshot(),before,'Export changed current draft/rights/dirty/publication');equal({posts:posts.length,lists:lists.length,capabilities:capabilities.length},count,'Export sent a network request');check(saveNotice()===notice,'Export hid current save error');check(document.querySelector('#preview-panel').textContent.includes('Local conflicting draft'),'Preview replaced local body');}
async function lateCopyPreserves(copy,outcome,expected){const before=snapshot(),counts={posts:posts.length,lists:lists.length,capabilities:capabilities.length,copies:copies.length};await settle(copy,outcome);check(saveNotice()===expected,'Late clipboard replaced newer compare-v1 notice: '+JSON.stringify({expected,actual:saveNotice()}));equal(snapshot(),before,'Late clipboard changed local/dirty/publication');equal({posts:posts.length,lists:lists.length,capabilities:capabilities.length,copies:copies.length},counts,'Late clipboard replayed mutation/capability/copy');}
const tests=[];
for(const listStatus of [200,503])for(const outcome of ['success','failure'])tests.push(['409 list '+listStatus+' keeps conflict notice after late clipboard '+outcome,async()=>{
 await beginSave();await capabilityReply();await until(()=>posts.length===1,'compare-v1 POST not reached');const input=JSON.parse(posts[0].options.body);check(input.expectedRevision===await editorRevision(first),'Wrong original save baseline');check(input.protocol==='compare-v1'&&input.markdown===local&&posts[0].url==='/api/editor/articles','Unsafe endpoint or wrong draft');
 await copyWhileBusy();const old=copies[0];await act(async()=>posts[0].resolve(Response.json({code:'EDITOR_CONFLICT',error:'Synthetic conflict: newer server body retained'},{status:409})));check(refreshes.length===1,'409 did not refresh read-only list once');
 await act(async()=>refreshes[0].resolve(Response.json(listStatus===200?{articles:[newer,second]}:{error:'Synthetic list failure'},{status:listStatus})));
 const expected=saveNotice();check(expected==='Synthetic conflict: newer server body retained','Conflict notice missing');check(unloadWarns()&&element('#markdown-body').value===local,'Conflict lost local dirty body');check(posts.length===1&&capabilities.length===1,'409 repeated mutation/capability');await exportLocal();await lateCopyPreserves(old,outcome,expected);
 await click('非公開で保存');check(capabilities.length===2&&posts.length===1,'Retry did not wait for explicit capability');await capabilityReply(200,1);await until(()=>posts.length===2,'Explicit retry POST not reached');check(JSON.parse(posts[1].options.body).expectedRevision===input.expectedRevision,'Read-only conflict refresh advanced stale baseline');
}]);
for(const outcome of ['success','failure'])tests.push(['old-server capability 404 retains no-write notice after late clipboard '+outcome,async()=>{
 await beginSave();await copyWhileBusy();const old=copies[0];await capabilityReply(404);const expected=saveNotice();check(expected.includes('保存リクエストは送っていません'),'Capability rejection lost explicit no-write notice');check(posts.length===0&&lists.length===1,'Old server caused mutation or fallback');await exportLocal();await lateCopyPreserves(old,outcome,expected);check(unloadWarns()&&posts.length===0,'Late copy acknowledged or wrote unsupported save');
}]);
for(const outcome of ['success','failure'])tests.push(['unmount during capability ignores old save and late clipboard '+outcome,async()=>{
 await beginSave();await copyWhileBusy();const oldCopy=copies[0],oldCapability=capabilities[0];await unmount();await setup();await click('＋ 新しい下書き');const expected=saveNotice();check(expected==='新しい下書きです。','New editor fixture control failed');
 await act(async()=>oldCapability.resolve(Response.json({protocol:'compare-v1'})));await until(()=>true,'flush');check(posts.length===0,'Unmounted capability sent a mutation');await lateCopyPreserves(oldCopy,outcome,expected);check(posts.length===0&&capabilities.length===0,'Old capability/copy reached new editor');
}]);
const results=[];
async function run(){for(const [name,operation] of tests){try{await setup();await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{await unmount();}}URL.createObjectURL=createURL;URL.revokeObjectURL=revokeURL;window.HTMLAnchorElement.prototype.click=anchorClick;document.querySelector('#result').textContent=JSON.stringify({results});}
window.editorCopyUrlTestDone=run().catch(error=>{document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results});});
`;

test('actual Editor compare-v1 save outcomes own newer notices than deferred clipboard',{timeout:15000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-compare-copy-test.mjs');
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});
 window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  await import(pathToFileURL(output).href);
  await window.editorCopyUrlTestDone;
  const report=JSON.parse(window.document.querySelector('#result').textContent);
  assert.ok(!report.fatal,report.fatal);
  assert.equal(report.results.length,8,'Incomplete compare-v1 clipboard coverage');
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
