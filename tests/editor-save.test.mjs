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
let root,posts=[],lists=[],conversions=[],deferInitial=false;
window.confirm=()=>true;
window.fetch=(url,options={})=>{
 if(url==='/api/articles'&&(!options.method||options.method==='GET')){
  if(!deferInitial&&!lists.length){lists.push({initial:true});return Promise.resolve(Response.json({articles:[saved]}));}
  return new Promise((resolve,reject)=>{lists.push({url,options,resolve,reject});});
 }
 if(url==='/api/articles'&&options.method==='POST')return new Promise((resolve,reject)=>{posts.push({url,options,resolve,reject});});
 if(url==='/api/convert'&&options.method==='POST')return new Promise((resolve,reject)=>{conversions.push({url,options,resolve,reject});});
 throw new Error('Unexpected request: '+url);
};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const element=selector=>{const found=document.querySelector(selector);check(found,'Missing element: '+selector);return found;};
const button=text=>{const found=[...document.querySelectorAll('button')].find(b=>b.textContent===text);check(found,'Missing button: '+text);return found;};
const title=()=>element('input[name="title"]');
const body=()=>element('#markdown-body');
const url=()=>element('#source-url');
const rights=()=>element('.rights-check input');
const values=()=>({title:title().value,body:body().value,url:url().value,rights:rights().checked});
const equal=(actual,expected,label)=>check(JSON.stringify(actual)===JSON.stringify(expected),label+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));
const unloadWarns=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
async function click(text){await act(async()=>{button(text).click();});}
async function edit(selector,value){await act(async()=>{const target=element(selector);const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));});}
async function setup(defer=false){posts=[];lists=[];conversions=[];deferInitial=defer;root=createRoot(element('#root'));await act(async()=>{root.render(<Editor signOutPath="/synthetic-signout"/>);});}
async function newDraft(){await click('＋ 新しい下書き');await edit('input[name="title"]','My edited title');await edit('#markdown-body','# My edited body');await edit('#source-url','https://source.example.test/new');}
const sent=index=>JSON.parse(posts[index].options.body);
async function acknowledge(index=0,data,status=200){const input=sent(index);await act(async()=>{posts[index].resolve(Response.json(data===undefined?{id:input.id,published:input.published,url:'/p/'+input.id}:data,{status}));});}
async function listReply(index,articles=[saved],status=200){await act(async()=>{lists[index].resolve(Response.json(status===200?{articles}:{error:'Synthetic list failure'},{status}));});}
async function rejectPost(index,message){await act(async()=>{posts[index].reject(new Error(message));});}
const tests=[
 ['rapid repeated saves dispatch one request and retain the same article ID',async()=>{
  await newDraft();await act(async()=>{const target=button('下書き保存');target.click();target.click();});check(posts.length===1,'Duplicate save request: '+posts.length);check(sent(0).markdown==='# My edited body','Wrong body snapshot');await acknowledge();await listReply(1);check(!url().disabled,'Save left editor locked');check(!unloadWarns(),'Confirmed save stayed dirty');
 }],
 ['rapid draft/publish clicks cannot race contradictory publication writes',async()=>{
  await newDraft();await act(async()=>{rights().click();});await act(async()=>{button('下書き保存').click();button('公開する').click();});check(posts.length===1,'Conflicting save and publish requests: '+posts.length);check(!sent(0).published,'First save was replaced by publish');await acknowledge();await listReply(1);
 }],
 ['a late save acknowledgement preserves a newer body and its unload warning',async()=>{
  await newDraft();await click('下書き保存');await edit('#markdown-body','# Newer queued body');const before=values();await acknowledge();await listReply(1);equal(values(),before,'Save changed newer draft');check(unloadWarns(),'Late save cleared newer dirty state');check(element('.notice').textContent.includes('まだ保存されていません'),'Missing newer-change notice');check(!url().disabled,'Settled save stayed locked');
 }],
 ['newer title and source changes remain unsaved after publication acknowledgement',async()=>{
  await newDraft();await act(async()=>{rights().click();});await click('公開する');await edit('input[name="title"]','Newer queued title');await edit('#source-url','https://source.example.test/newer');const before=values();await acknowledge();await listReply(1);equal(values(),before,'Publish changed newer fields');check(unloadWarns(),'Publish cleared newer dirty state');check(element('.document-status').textContent==='公開中','Acknowledged publication was hidden');check(element('#share-url').value.endsWith('/p/'+sent(0).id),'Wrong acknowledged share URL');
 }],
 ['an edit queued during article-list refresh stays dirty when refresh finishes',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();check(lists.length===2,'Save did not refresh list');await edit('#markdown-body','# Edit during refresh');await listReply(1);check(body().value==='# Edit during refresh','Refresh changed body');check(unloadWarns(),'Refresh cleared newer edit');check(!url().disabled,'Refresh left lock active');
 }],
 ['HTTP rejection preserves edits and a retry uses the original article ID',async()=>{
  await newDraft();const before=values();await click('下書き保存');await acknowledge(0,{error:'Synthetic save rejection'},400);equal(values(),before,'Rejected save changed inputs');check(unloadWarns(),'Rejected save cleared dirty state');check(element('.notice').textContent==='Synthetic save rejection','Missing rejection');check(!url().disabled,'Rejected save stayed locked');await click('下書き保存');check(sent(1).id===sent(0).id,'Retry generated a duplicate article ID');await acknowledge(1);await listReply(1);
 }],
 ['network failure preserves newer unsaved changes and allows retry',async()=>{
  await newDraft();await click('下書き保存');await edit('#markdown-body','# Newer after network request');const before=values();await rejectPost(0,'Synthetic network failure');equal(values(),before,'Network failure changed newer draft');check(unloadWarns(),'Network failure hid newer unsaved state');check(!url().disabled,'Network failure left lock active');await click('下書き保存');check(sent(1).markdown==='# Newer after network request','Retry used obsolete body');await acknowledge(1);await listReply(1);
 }],
 ['malformed success cannot falsely mark a draft as saved',async()=>{
  await newDraft();const before=values();await click('下書き保存');await acknowledge(0,null);equal(values(),before,'Malformed response changed inputs');check(unloadWarns(),'Malformed response cleared unsaved state');check(element('.notice').textContent.includes('本文は残っています'),'Malformed response not explained');check(lists.length===1,'Malformed acknowledgement refreshed list');check(!url().disabled,'Malformed response left lock active');
 }],
 ['mismatched article and publication acknowledgements are rejected',async()=>{
  await newDraft();await click('下書き保存');await acknowledge(0,{id:saved.id,published:false,url:'/p/'+saved.id});check(unloadWarns(),'Wrong article acknowledgement cleared dirty state');check(lists.length===1,'Wrong article acknowledgement accepted');await click('下書き保存');await acknowledge(1,{id:sent(1).id,published:true,url:'/p/'+sent(1).id});check(unloadWarns(),'Wrong publication acknowledgement cleared dirty state');check(lists.length===1,'Wrong publication acknowledgement accepted');
 }],
 ['successful save remains acknowledged if the later list refresh fails',async()=>{
  await newDraft();await act(async()=>{rights().click();});await click('公開する');await acknowledge();await listReply(1,[],503);check(!unloadWarns(),'Confirmed publication became dirty');check(element('.document-status').textContent==='公開中','Confirmed publication was hidden');check(element('#share-url').value.endsWith('/p/'+sent(0).id),'Confirmed URL was lost');check(element('.notice').textContent.includes('公開しました。')&&element('.notice').textContent.includes('一覧'),'Refresh failure disguised confirmed save');check(!url().disabled,'Refresh failure left editor locked');
 }],
 ['initial list response arriving after the save refresh cannot replace newer records',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();const input=sent(0);await listReply(1,[{...saved,id:input.id,title:'Fresh saved title',published:0}]);await listReply(0,[{...saved,title:'Stale initial title'}]);check(element('.draft-list').textContent.includes('Fresh saved title'),'Late initial list replaced saved records');check(!element('.draft-list').textContent.includes('Stale initial title'),'Stale initial list was rendered');
 },true],
 ['a failed save still allows the delayed initial article list to populate',async()=>{
  await newDraft();await click('下書き保存');await acknowledge(0,{error:'Synthetic save rejection'},400);await listReply(0,[saved]);check(element('.draft-list').textContent.includes('Saved fixture'),'Failed save discarded initial article list');check(unloadWarns(),'Initial list cleared rejected draft');check(element('.notice').textContent==='Synthetic save rejection','Initial list hid save rejection');
 },true],
 ['same-tick New/Open clicks cannot replace the document being saved',async()=>{
  await newDraft();const before=values();await act(async()=>{button('下書き保存').click();button('＋ 新しい下書き').click();button('Saved fixture公開中 · 2026-10-09').click();});equal(values(),before,'Navigation raced in-flight save');await acknowledge();await listReply(1);equal(values(),before,'Acknowledgement applied to another document');
 }],
 ['same-tick conversion and saving cannot start competing requests',async()=>{
  await newDraft();await act(async()=>{button('下書き保存').click();button('URLから変換').click();});check(posts.length===1&&conversions.length===0,'Save and conversion raced');await acknowledge();await listReply(1);
 }],
 ['conversion-first same-tick Save and Publish clicks cannot race the replacement',async()=>{
  await newDraft();await act(async()=>{rights().click();});await act(async()=>{button('URLから変換').click();button('下書き保存').click();button('公開する').click();});check(conversions.length===1&&posts.length===0,'Conversion-first save/publish race: '+conversions.length+' conversions, '+posts.length+' saves');check(url().disabled,'Conversion did not lock the editor');
  const converted={title:'Converted fixture',markdown:'# Converted fixture',sourceUrl:'https://source.example.test/converted'};await act(async()=>{conversions[0].resolve(Response.json(converted));});equal(values(),{title:converted.title,body:converted.markdown,url:converted.sourceUrl,rights:false},'Conversion-first result was changed');check(unloadWarns(),'Converted draft was falsely marked saved');check(!url().disabled,'Completed conversion left editor locked');await click('下書き保存');check(posts.length===1&&sent(0).markdown===converted.markdown&&sent(0).title===converted.title&&sent(0).sourceUrl===converted.sourceUrl,'Post-conversion save used obsolete fields');await acknowledge();await listReply(1);check(!unloadWarns(),'Post-conversion save stayed dirty');
 }],
 ['unmount during article-list refresh ignores stale records and cannot unlock a new save',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();check(lists.length===2&&url().disabled,'Save did not retain the lock through refresh');const oldList=lists[1];await act(async()=>{root.unmount();});root=null;await setup();await newDraft();await edit('#markdown-body','# New editor pending save');await click('下書き保存');const before=values();let staleReads=0;const staleData={get articles(){staleReads++;return [{...saved,title:'Unmounted stale article'}];}};
  await act(async()=>{oldList.resolve({ok:true,json:async()=>staleData});});check(staleReads===0,'Unmounted refresh consumed stale article records');equal(values(),before,'Unmounted refresh changed a new draft');check(lists.length===1,'Old refresh started a request in the new editor');check(url().disabled,'Old refresh unlocked the new save');check(!element('.draft-list').textContent.includes('Unmounted stale article'),'Stale records reached the new editor');await acknowledge();await listReply(1);check(!url().disabled&&!unloadWarns(),'New editor save did not settle independently');
 }],
 ['unmount during article-list refresh hides its late network failure from a new editor',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();const oldList=lists[1];await act(async()=>{root.unmount();});root=null;await setup();await newDraft();await click('下書き保存');const before=values();await act(async()=>{oldList.reject(new Error('Unmounted refresh failure'));});equal(values(),before,'Old list failure changed the new draft');check(!document.querySelector('.notice')?.textContent.includes('Unmounted refresh failure'),'Unmounted failure reached the new editor');check(url().disabled,'Unmounted failure unlocked a new save');await acknowledge();await listReply(1);check(!url().disabled,'New save stayed locked after old failure');
 }],
 ['invalid JSON save response preserves newer edits and retries the same article ID',async()=>{
  await newDraft();await click('下書き保存');await edit('#markdown-body','# Newer after invalid JSON request');const before=values();await act(async()=>{posts[0].resolve(new Response('{invalid JSON',{status:200,headers:{'Content-Type':'application/json'}}));});equal(values(),before,'Invalid JSON response changed the draft');check(unloadWarns(),'Invalid JSON response cleared unsaved state');check(lists.length===1,'Invalid JSON response refreshed the list');check(element('.notice').textContent.length>0&&!element('.notice').textContent.includes('保存しました'),'Invalid JSON response was presented as saved');check(!url().disabled,'Invalid JSON response left editor locked');await click('下書き保存');check(sent(1).id===sent(0).id&&sent(1).markdown==='# Newer after invalid JSON request','Invalid JSON retry lost the ID or newer body');await acknowledge(1);await listReply(1);check(!unloadWarns(),'Valid retry stayed dirty');
 }],
 ['invalid JSON article-list refresh keeps publication acknowledged and newer edits unsaved',async()=>{
  await newDraft();await act(async()=>{rights().click();});await click('公開する');await acknowledge();await edit('#markdown-body','# Newer during invalid JSON refresh');const before=values();await act(async()=>{lists[1].resolve(new Response('{invalid JSON',{status:200,headers:{'Content-Type':'application/json'}}));});equal(values(),before,'Invalid JSON refresh changed newer fields');check(unloadWarns(),'Invalid JSON refresh cleared newer unsaved state');check(element('.document-status').textContent==='公開中','Invalid JSON refresh lost acknowledged publication');check(element('#share-url').value.endsWith('/p/'+sent(0).id),'Invalid JSON refresh lost the acknowledged URL');const notice=element('.notice').textContent;check(notice.includes('公開しました。')&&notice.includes('まだ保存されていません')&&notice.includes('一覧'),'Invalid JSON refresh disguised the saved publication or newer edits');check(!url().disabled,'Invalid JSON refresh left editor locked');
 }],
 ['article-list network rejection keeps a confirmed save and allows a same-ID retry',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();await act(async()=>{lists[1].reject(new Error('Synthetic list network failure'));});check(!unloadWarns(),'List network failure made a confirmed save dirty');check(element('.document-status').textContent==='下書き','List failure changed publication state');check(!document.querySelector('#share-url'),'Draft save exposed a publication URL');const notice=element('.notice').textContent;check(notice.includes('下書きに保存しました。')&&notice.includes('一覧'),'List network failure disguised the confirmed save');check(element('.draft-list').textContent.includes('Saved fixture'),'List failure discarded existing records');check(!url().disabled,'List network failure left editor locked');await edit('#markdown-body','# Next save after list network failure');await click('下書き保存');check(sent(1).id===sent(0).id&&sent(1).markdown==='# Next save after list network failure','Retry after list rejection lost the ID or body');await acknowledge(1);await listReply(2);check(!url().disabled&&!unloadWarns(),'Retry after list rejection did not settle');
 }],
 ['unmount invalidates a save and its late success cannot reach a new editor',async()=>{
  await newDraft();await click('下書き保存');const old=posts[0],input=sent(0);await act(async()=>{root.unmount();});root=null;await setup();const before=values();await act(async()=>{old.resolve(Response.json({id:input.id,published:false,url:'/p/'+input.id}));});equal(values(),before,'Unmounted save changed new editor');check(lists.length===1,'Unmounted save refreshed new editor');check(!url().disabled,'Old save locked new editor');
 }]
];
const results=[];
async function run(){for(const [name,operation,defer] of tests){try{await setup(Boolean(defer));await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{if(root){await act(async()=>{root.unmount();});root=null;}}}document.querySelector('#result').textContent=JSON.stringify({results});}
window.editorSaveTestDone=run().catch(error=>{document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results});});
`;

test('actual Editor save handlers protect current revisions with synthetic API replies',{timeout:15000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-save-test.mjs');
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});
 window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  await import(pathToFileURL(output).href);
  await window.editorSaveTestDone;
  const report=JSON.parse(window.document.querySelector('#result').textContent);
  assert.ok(!report.fatal,report.fatal);
  assert.equal(report.results.length,21,'Incomplete save coverage');
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
