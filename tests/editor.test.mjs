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
window.IS_REACT_ACT_ENVIRONMENT=true;
const saved={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'Saved fixture',source_url:'https://source.example.test/saved',markdown:'# Saved body',published:1,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z',published_at:'2026-10-09T00:00:00Z'};
let root,requests=[],confirmations=[],accept=true;
const deadlines=new Map();let nextDeadline=900000,clock=0;
const nativeTimeout=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window);
window.setTimeout=(callback,delay,...args)=>{if(delay===60000){const id=nextDeadline++;deadlines.set(id,{due:clock+delay,run:()=>callback(...args)});return id;}return nativeTimeout(callback,delay,...args);};
window.clearTimeout=id=>{if(deadlines.has(id))deadlines.delete(id);else nativeClear(id);};
window.confirm=message=>{confirmations.push(message);return accept;};
window.fetch=(url,options={})=>{
 if(url==='/api/articles'&&(!options.method||options.method==='GET'))return Promise.resolve(Response.json({articles:[saved]}));
 if(url==='/api/convert'&&options.method==='POST')return new Promise((resolve,reject)=>{requests.push({url,options,resolve,reject});});
 throw new Error('Unexpected request: '+url);
};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const element=selector=>{const found=document.querySelector(selector);check(found,'Missing element: '+selector);return found;};
const button=text=>{const found=[...document.querySelectorAll('button')].find(b=>b.textContent===text);check(found,'Missing button: '+text);return found;};
const title=()=>element('input[name="title"]');
const body=()=>element('#markdown-body');
const url=()=>element('#source-url');
const rights=()=>element('.rights-check input');
const snapshot=()=>({title:title().value,body:body().value,url:url().value,rights:rights().checked,status:element('.document-status').textContent,share:document.querySelector('#share-url')?.value||'',preview:element('.writing-surface').className});
const equal=(actual,expected,label)=>check(JSON.stringify(actual)===JSON.stringify(expected),label+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));
async function click(text){await act(async()=>{button(text).click();});}
async function edit(selector,value){await act(async()=>{const target=element(selector);const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));});}
async function setup(){requests=[];confirmations=[];accept=true;root=createRoot(element('#root'));await act(async()=>{root.render(<Editor signOutPath="/synthetic-signout"/>);});}
async function newDraft(){await click('＋ 新しい下書き');await edit('input[name="title"]','My edited title');await edit('#markdown-body','# My edited body');await edit('#source-url','https://source.example.test/new');}
async function finish(index,data,status=200){await act(async()=>{requests[index].resolve(Response.json(data,{status}));});}
async function fail(index,message){await act(async()=>{requests[index].reject(new Error(message));});}
async function advance(milliseconds){clock+=milliseconds;await act(async()=>{for(const [id,timer] of [...deadlines])if(timer.due<=clock){deadlines.delete(id);timer.run();}});}
async function expire(){await advance(60000);}
function unloadWarns(){const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}
function recovered(){check(!url().disabled&&!title().disabled&&!body().disabled,'Deadline left editor locked');check(element('.notice').textContent.includes('60秒'),'Deadline guidance missing');check(deadlines.size===0,'Settled deadline leaked');}
const converted={markdown:'# Converted fixture',title:'Converted fixture',sourceUrl:'https://source.example.test/converted'};
const tests=[
 ['stalled headers time out without changing the complete public draft or retrying',async()=>{
  await click('Saved fixture公開中 · 2026-10-09');await edit('#markdown-body','# Unsaved private fixture');await act(async()=>rights().click());const before=snapshot();await click('URLから変換');check(url().disabled,'Conversion did not lock');await advance(59999);check(url().disabled,'Conversion timed out before 60 seconds');await advance(1);recovered();equal(snapshot(),before,'Timeout changed the public draft');check(unloadWarns(),'Timeout cleared dirty warning');check(requests[0].options.signal.aborted,'Deadline did not abort transport');check(requests.length===1,'Deadline automatically retried');await edit('#markdown-body','# Editable after timeout');check(body().value==='# Editable after timeout','Editing did not recover');
 }],
 ['stalled JSON times out and its late body cannot overwrite a successful explicit retry',async()=>{
  await newDraft();await act(async()=>rights().click());const before=snapshot();await click('URLから変換');let finishBody;await act(async()=>requests[0].resolve({ok:true,json:()=>new Promise(resolve=>{finishBody=resolve;})}));await expire();recovered();equal(snapshot(),before,'Body timeout changed draft');check(unloadWarns(),'Body timeout cleared dirty warning');check(requests.length===1,'Body timeout retried automatically');await click('URLから変換');check(requests.length===2,'Explicit retry did not start once');await finish(1,{...converted,title:'Explicit retry'});check(title().value==='Explicit retry','Explicit retry failed');const after=snapshot();await act(async()=>finishBody({...converted,title:'Late body'}));equal(snapshot(),after,'Late body overwrote retry');check(deadlines.size===0,'Retry success retained timer');
 }],
 ['timed-out success cannot overwrite or unlock a newer conversion',async()=>{
  await newDraft();await click('URLから変換');await expire();await click('URLから変換');const before=snapshot();await finish(0,{...converted,title:'Late headers'});equal(snapshot(),before,'Old headers changed retry draft');check(url().disabled,'Old success unlocked retry');check(deadlines.size===1,'Old success cleared new timer');await finish(1,converted);check(title().value===converted.title&&!url().disabled,'Retry did not complete');check(deadlines.size===0,'Retry timer leaked');
 }],
 ['timed-out fetch and JSON failures cannot replace a newer conversion status',async()=>{
  for(const bodyStall of [false,true]){
   const index=requests.length;await newDraft();await click('URLから変換');let rejectBody;
   if(bodyStall)await act(async()=>requests[index].resolve({ok:true,json:()=>new Promise((resolve,reject)=>{rejectBody=reject;})}));
   await expire();await click('URLから変換');const before=snapshot();
   if(bodyStall)await act(async()=>rejectBody(new Error('Obsolete body failure')));else await fail(index,'Obsolete fetch failure');
   equal(snapshot(),before,'Late failure changed draft');check(!document.querySelector('.notice')?.textContent.includes('Obsolete'),'Late failure surfaced');check(url().disabled&&deadlines.size===1,'Late failure unlocked or cleared retry');await finish(index+1,converted);
  }
 }],
 ['success and HTTP or malformed failures clear the conversion deadline',async()=>{
  await newDraft();await click('URLから変換');check(deadlines.size===1,'Missing active deadline');await finish(0,converted);check(deadlines.size===0,'Success leaked deadline');await click('URLから変換');await finish(1,{error:'Existing HTTP message'},504);check(element('.notice').textContent==='Existing HTTP message','HTTP message changed');check(deadlines.size===0,'HTTP failure leaked deadline');await click('URLから変換');await finish(2,null);check(deadlines.size===0,'Malformed response leaked deadline');
 }],
 ['draft invalidation cancels its deadline without clearing a newer request timer',async()=>{
  await newDraft();await click('URLから変換');await edit('#markdown-body','# New queued body');check(requests[0].options.signal.aborted,'Draft edit did not abort');check(deadlines.size===0,'Draft edit leaked deadline');await click('URLから変換');check(deadlines.size===1,'New conversion deadline missing');await finish(0,converted);check(deadlines.size===1&&url().disabled,'Obsolete completion affected new request');await finish(1,converted);check(deadlines.size===0,'New success leaked deadline');
 }],
 ['unmount cancels the conversion deadline and old completion cannot reach a new editor',async()=>{
  await newDraft();await click('URLから変換');const old=requests[0];await act(async()=>root.unmount());root=null;check(old.options.signal.aborted,'Unmount did not abort conversion');check(deadlines.size===0,'Unmount leaked deadline');await setup();const before=snapshot();await act(async()=>old.resolve(Response.json(converted)));equal(snapshot(),before,'Old completion changed new editor');check(deadlines.size===0,'Old completion restored a deadline');
 }],
 ['cancel protects the complete existing draft and makes no conversion request',async()=>{
  await click('Saved fixture公開中 · 2026-10-09');await edit('#markdown-body','# Unsaved private fixture');await act(async()=>{rights().click();});
  const before=snapshot();accept=false;await click('URLから変換');equal(snapshot(),before,'Draft changed after cancel');check(requests.length===0,'Cancel sent conversion request');check(confirmations.length===1&&confirmations[0].includes('タイトルと本文を置き換え'),'Missing replacement confirmation');check(!url().disabled,'Cancel left editor busy');
 }],
 ['empty new draft converts without an unnecessary replacement prompt',async()=>{
  await click('＋ 新しい下書き');await edit('#source-url','https://source.example.test/new');await click('URLから変換');check(confirmations.length===0,'URL-only blank draft prompted');await finish(0,converted);equal(body().value,converted.markdown,'Conversion not applied');check(element('.writing-surface').classList.contains('preview'),'Preview not selected');
 }],
 ['accepted replacement applies the result and clears publication confirmation',async()=>{
  await newDraft();await act(async()=>{rights().click();});await click('URLから変換');check(confirmations.length===1,'Missing unsaved draft confirmation');check(JSON.parse(requests[0].options.body).url==='https://source.example.test/new','Wrong requested URL');await finish(0,converted);equal({title:title().value,body:body().value,url:url().value}, {title:converted.title,body:converted.markdown,url:converted.sourceUrl},'Wrong converted draft');check(!rights().checked,'Old rights confirmation survived replacement');check(!url().disabled,'Success left editor busy');
 }],
 ['HTTP failure preserves all current draft values',async()=>{
  await newDraft();await act(async()=>{rights().click();});const before=snapshot();await click('URLから変換');await finish(0,{error:'Synthetic timeout'},504);equal(snapshot(),before,'Failure altered draft');check(element('.notice').textContent==='Synthetic timeout','Failure was not explained');check(!url().disabled,'Failure left editor busy');
 }],
 ['network failure preserves the current draft',async()=>{
  await newDraft();const before=snapshot();await click('URLから変換');await fail(0,'Synthetic network failure');equal(snapshot(),before,'Network failure altered draft');check(element('.notice').textContent==='Synthetic network failure','Network failure message missing');
 }],
 ['classified source and AI failures preserve the complete draft without automatic retries',async()=>{
  await newDraft();await act(async()=>{rights().click();});const before=snapshot();
  for(const [index,code] of ['SOURCE_CONNECTION_ERROR','CONVERSION_SERVICE_ERROR'].entries()){
   await click('URLから変換');await finish(index,{error:'合成の取得・変換障害。本文を直接編集できます。',code},502);
   equal(snapshot(),before,'Classified failure altered draft');check(element('.notice').textContent==='合成の取得・変換障害。本文を直接編集できます。','Classified failure missing');check(requests.length===index+1,'Failure automatically retried');check(!url().disabled,'Classified failure left editor locked');
  }
 }],
 ['malformed successful response cannot erase a draft',async()=>{
  await newDraft();const before=snapshot();await click('URLから変換');await finish(0,{title:'Missing Markdown'});equal(snapshot(),before,'Malformed response erased draft');check(element('.notice').textContent.includes('本文は残っています'),'Malformed result not explained');
 }],
 ['an object title in a successful response preserves the full draft',async()=>{
  await newDraft();const before=snapshot();await click('URLから変換');await finish(0,{...converted,title:{unexpected:'object'}});equal(snapshot(),before,'Object title changed draft');check(element('.notice').textContent.includes('本文は残っています'),'Object title not explained');check(!url().disabled,'Object title left editor busy');
 }],
 ['an array source URL in a successful response preserves the full draft',async()=>{
  await newDraft();const before=snapshot();await click('URLから変換');await finish(0,{...converted,sourceUrl:['https://source.example.test/unexpected']});equal(snapshot(),before,'Array URL changed draft');check(element('.notice').textContent.includes('本文は残っています'),'Array URL not explained');check(!url().disabled,'Array URL left editor busy');
 }],
 ['null or array responses preserve the draft and allow a safe retry',async()=>{
  await newDraft();const before=snapshot();await click('URLから変換');await finish(0,null);equal(snapshot(),before,'Null response changed draft');await click('URLから変換');await finish(1,[]);equal(snapshot(),before,'Array response changed draft');await click('URLから変換');await finish(2,converted);equal(body().value,converted.markdown,'Retry did not apply valid result');
 }],
 ['whitespace-only edited Markdown still requires replacement confirmation',async()=>{
  await click('＋ 新しい下書き');await edit('#markdown-body',' \n\t ');await edit('#source-url','https://source.example.test/new');const before=snapshot();accept=false;await click('URLから変換');equal(snapshot(),before,'Whitespace draft changed after cancel');check(confirmations.length===1,'Whitespace draft was not protected');check(requests.length===0,'Whitespace cancel sent a request');
 }],
 ['rapid repeated conversion clicks start only one request',async()=>{
  await newDraft();await act(async()=>{const target=button('URLから変換');target.click();target.click();});check(requests.length===1,'Duplicate conversion request');check(confirmations.length===1,'Duplicate confirmation');await finish(0,converted);
 }],
 ['a queued newer body edit aborts conversion and ignores its late success',async()=>{
  await newDraft();await click('URLから変換');const signal=requests[0].options.signal;await edit('#markdown-body','# Newer queued edit');check(signal.aborted,'New edit did not abort request');const before=snapshot();await finish(0,converted);equal(snapshot(),before,'Late result overwrote newer edit');check(!url().disabled,'Obsolete finally left editor busy');
 }],
 ['a queued newer title edit invalidates the old response',async()=>{
  await newDraft();await click('URLから変換');await edit('input[name="title"]','Newer title');const before=snapshot();await finish(0,converted);equal(snapshot(),before,'Late result overwrote newer title');
 }],
 ['an old success cannot overwrite or unlock a newer conversion',async()=>{
  await newDraft();await click('URLから変換');await edit('#source-url','https://source.example.test/newer');await click('URLから変換');check(requests.length===2,'New conversion unavailable after invalidation');const before=snapshot();await finish(0,{...converted,title:'Obsolete result'});equal(snapshot(),before,'Old success changed newer draft');check(url().disabled,'Old finally unlocked newer conversion');await finish(1,{...converted,title:'Newest result'});equal(title().value,'Newest result','Newest conversion not applied');check(!url().disabled,'Newest result left editor busy');
 }],
 ['an old failure cannot replace the newer conversion message or busy state',async()=>{
  await newDraft();await click('URLから変換');await edit('#source-url','https://source.example.test/newer');await click('URLから変換');await fail(0,'Obsolete failure');check(!document.querySelector('.notice')?.textContent.includes('Obsolete failure'),'Old error surfaced');check(url().disabled,'Old failure unlocked newer request');await finish(1,converted);
 }],
 ['existing New and Open cancellation guards still preserve unsaved changes',async()=>{
  await newDraft();const before=snapshot();accept=false;await click('＋ 新しい下書き');equal(snapshot(),before,'New bypassed dirty guard');await click('Saved fixture公開中 · 2026-10-09');equal(snapshot(),before,'Open bypassed dirty guard');check(requests.length===0,'Navigation unexpectedly converted');
 }],
 ['unmount aborts the pending request and its late result cannot reach a new editor',async()=>{
  await newDraft();await click('URLから変換');const old=requests[0];await act(async()=>{root.unmount();});root=null;check(old.options.signal.aborted,'Unmount did not abort request');await setup();const before=snapshot();await act(async()=>{old.resolve(Response.json(converted));});equal(snapshot(),before,'Unmounted request affected new editor');
 }]
];
const results=[];
async function run(){for(const [name,operation] of tests){try{await setup();await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{if(root){await act(async()=>{root.unmount();});root=null;}}}document.querySelector('#result').textContent=JSON.stringify({results});}
window.editorTestDone=run().catch(error=>{document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results});});
`;

test('actual owner Editor interaction handlers protect drafts with synthetic API replies',{timeout:15000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-test.mjs');
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});
 window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  await import(pathToFileURL(output).href);
  await window.editorTestDone;
  const report=JSON.parse(window.document.querySelector('#result').textContent);
  assert.ok(!report.fatal,report.fatal);
  assert.equal(report.results.length,25,'Incomplete editor coverage');
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
