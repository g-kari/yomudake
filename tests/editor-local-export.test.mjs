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
 if(url==='/api/editor/articles'&&(!options.method||options.method==='GET'))return Promise.resolve(Response.json({protocol:'compare-v1'}));
 if(url==='/api/articles'&&(!options.method||options.method==='GET')){
  if(!deferInitial&&!lists.length){lists.push({initial:true});return Promise.resolve(Response.json({articles:[saved]}));}
  return new Promise((resolve,reject)=>{lists.push({url,options,resolve,reject});});
 }
 if(url==='/api/editor/articles'&&options.method==='POST')return new Promise((resolve,reject)=>{posts.push({url,options,resolve,reject});});
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
async function click(text){
 const target=button(text),previous=posts.length,wasEnabled=!target.disabled;
 await act(async()=>{button(text).click();});
 // WebCrypto is a real asynchronous dependency before the deferred POST.
 // Wait for that observable boundary, not an arbitrary sleep or mocked digest.
 if(wasEnabled&&['下書き保存','公開する','公開内容を更新','非公開で保存'].includes(text)){
  const deadline=Date.now()+1000;
  while(posts.length===previous&&target.disabled&&!document.querySelector('[aria-label="記事の保存と公開"] .notice')?.textContent){
   check(Date.now()<deadline,'Save did not reach POST or a visible error');
   await act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
  }
 }
}
async function edit(selector,value){await act(async()=>{const target=element(selector);const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));});}
async function setup(defer=false){posts=[];lists=[];conversions=[];deferInitial=defer;root=createRoot(element('#root'));await act(async()=>{root.render(<Editor signOutPath="/synthetic-signout"/>);});}
async function newDraft(){await click('＋ 新しい下書き');await edit('input[name="title"]','My edited title');await edit('#markdown-body','# My edited body');await edit('#source-url','https://source.example.test/new');}
const sent=index=>JSON.parse(posts[index].options.body);
async function acknowledge(index=0,data,status=200){const input=sent(index);await act(async()=>{posts[index].resolve(Response.json(data===undefined?{protocol:'compare-v1',revision:'a'.repeat(64),id:input.id,published:input.published,url:'/p/'+input.id}:data,{status}));});}
async function listReply(index,articles=[saved],status=200){await act(async()=>{lists[index].resolve(Response.json(status===200?{articles}:{error:'Synthetic list failure'},{status}));});}
async function rejectPost(index,message){await act(async()=>{posts[index].reject(new Error(message));});}

const exportButton=()=>button('Markdown本文を端末に書き出す');
const snapshots=[],revoked=[],clicks=[];let failAt='';
const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalClick=window.HTMLAnchorElement.prototype.click;
URL.createObjectURL=blob=>{if(failAt==='create')throw new Error('private local error');const href='blob:synthetic-'+snapshots.length;snapshots.push({blob,href});return href;};
URL.revokeObjectURL=href=>revoked.push(href);
window.HTMLAnchorElement.prototype.click=function(){if(failAt==='click')throw new Error('private local error');clicks.push({href:this.href,download:this.download,connected:this.isConnected});};
const exportSnapshot=async()=>{const before=values(),dirty=unloadWarns(),postCount=posts.length,listCount=lists.length;await click('Markdown本文を端末に書き出す');equal(values(),before,'Export changed draft values');check(unloadWarns()===dirty,'Export changed dirty warning');check(posts.length===postCount&&lists.length===listCount,'Export made network request');if(!failAt)check(document.querySelector('[aria-label="編集中の本文の書き出し"]').textContent.includes('保存中の処理の結果を示すものではありません'),'Export implied pending server outcome');return snapshots.at(-1);};
const raw='# 合成の本文 🦊\n\n**raw** <script>not executed</script>\n\n末尾の空白  \n';
check(raw.includes(String.fromCharCode(10)),'Fixture must include actual newlines');
const tests=[
 ['exact raw UTF8 body exports without title/source or writes',async()=>{await newDraft();await edit('#markdown-body',raw);const item=await exportSnapshot();check(await item.blob.text()===raw,'Export bytes differ');check(item.blob.type==='text/markdown;charset=utf-8','Wrong MIME');check(clicks.at(-1).download==='yomudake-draft.md'&&clicks.at(-1).connected,'Missing explicit local download');check(document.querySelector('#local-export-guidance').textContent.includes('タイトル・元URLは含みません'),'Missing scope copy');check(!document.querySelector('a[download]'),'Transient anchor retained');}],
 ['same-tick edit exports latest accepted body rather than stale render',async()=>{await newDraft();await act(async()=>{const target=body();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(target,raw);target.dispatchEvent(new Event('input',{bubbles:true}));exportButton().click();});check(await snapshots.at(-1).blob.text()===raw,'Queued edit exported stale render');check(unloadWarns(),'Queued export cleared dirty');}],
 ['empty draft disables export; whitespace is preserved',async()=>{await click('＋ 新しい下書き');check(exportButton().disabled,'Empty export enabled');await edit('#markdown-body',' \n\t');check(!exportButton().disabled,'Whitespace blocked');check(await (await exportSnapshot()).blob.text()===' \n\t','Whitespace changed');}],
 ['repeat export uses latest current body and revokes each URL',async()=>{await newDraft();let i=await exportSnapshot();await edit('#markdown-body',raw);let j=await exportSnapshot();check(i.href!==j.href,'URL reused');check(await j.blob.text()===raw,'Stale body exported');await new Promise(resolve=>setTimeout(resolve,10));check(revoked.includes(i.href)&&revoked.includes(j.href),'URL not released');}],
 ...['headers','success-body','error-body'].map(phase=>['export during pending save '+phase+' does not replay/cancel/acknowledge mutation',async()=>{await newDraft();await edit('#markdown-body',raw);await click('下書き保存');if(phase!=='headers')await act(async()=>{posts[0].resolve({ok:phase==='success-body',json:()=>new Promise(()=>{})});});check(body().disabled&&!exportButton().disabled,'Export inaccessible during save');await exportSnapshot();check(await snapshots.at(-1).blob.text()===raw,'Pending draft changed');check(posts.length===1&&body().disabled&&unloadWarns(),'Export released/acknowledged unknown save');check(!document.querySelector('[aria-label="記事の保存と公開"] .notice'),'False server notice');}]),
 ...['create','click'].map(failure=>['local '+failure+' failure preserves draft and reports no false save',async()=>{await newDraft();const before=values();failAt=failure;await exportSnapshot();failAt='';equal(values(),before,'Failure changed draft');check(document.querySelector('[aria-label="編集中の本文の書き出し"]').textContent.includes('本文を書き出せませんでした'),'No honest error');check(!document.body.textContent.includes('private local error'),'Raw local exception leaked');check(unloadWarns()&&posts.length===0,'Failure changed save state');check(!document.querySelector('a[download]'),'Failure left anchor');}]),
];
const results=[];
async function run(){for(const [name,operation,defer] of tests){try{snapshots.length=0;revoked.length=0;clicks.length=0;failAt="";await setup(Boolean(defer));await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{if(root){await act(async()=>{root.unmount();});root=null;}}}URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;window.HTMLAnchorElement.prototype.click=originalClick;document.querySelector('#result').textContent=JSON.stringify({results});}
window.editorLocalExportDone=run().catch(error=>{document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results});});
`;

test('actual Editor local body exports preserve drafts and pending save ownership',{timeout:15000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-local-export-test.mjs');
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});
 window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  await import(pathToFileURL(output).href);
  await window.editorLocalExportDone;
  const report=JSON.parse(window.document.querySelector('#result').textContent);
  assert.ok(!report.fatal,report.fatal);
  assert.equal(report.results.length,9,'Incomplete save coverage');
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
