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
const first={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'First public fixture',source_url:'https://example.org/first',markdown:'# First synthetic body',published:1,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z',published_at:'2026-10-09T00:00:00Z'};
const second={...first,id:'dcbe3c20-d502-44dd-b8c4-356585b3985d',title:'Second public fixture',source_url:'https://example.org/second',markdown:'# Second synthetic body'};
let root,copies=[],posts=[],lists=[],conversions=[],confirmations=[],accept=true;
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>new Promise((resolve,reject)=>copies.push({value,resolve,reject}))}});
window.confirm=message=>{confirmations.push(message);return accept;};
window.fetch=(url,options={})=>{
 if(url==='/api/articles'&&(!options.method||options.method==='GET')){lists.push({url,options});return Promise.resolve(Response.json({articles:[first,second]}));}
 if(url==='/api/articles'&&options.method==='POST')return new Promise(resolve=>posts.push({url,options,resolve}));
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
async function setup(){copies=[];posts=[];lists=[];conversions=[];confirmations=[];accept=true;root=createRoot(element('#root'));await act(async()=>root.render(<Editor signOutPath="/synthetic-signout"/>));await click('First public fixture公開中 · 2026-10-09');}
async function settle(copy,outcome){await act(async()=>outcome==='success'?copy.resolve():copy.reject(new Error('Synthetic private clipboard failure')));}
async function saveReply(outcome){const pending=posts[0],input=JSON.parse(pending.options.body);await act(async()=>pending.resolve(Response.json(outcome==='success'?{id:input.id,published:false,url:'/p/'+input.id}:{error:'Synthetic save rejection'},{status:outcome==='success'?200:503})));}
async function preserveNotice(copy,outcome){const expected=notice(),before=snapshot(),network={posts:posts.length,lists:lists.length,conversions:conversions.length},copyCount=copies.length;await settle(copy,outcome);equal(snapshot(),before,'Late copy changed current document');equal({posts:posts.length,lists:lists.length,conversions:conversions.length},network,'Late copy issued or replayed a request');check(copies.length===copyCount,'Late copy retried clipboard');check(notice()===expected,'Late copy replaced current notice: '+JSON.stringify({expected,actual:notice()}));check(!document.body.textContent.includes('Synthetic private clipboard failure'),'Raw clipboard error leaked');}
const tests=[
 ...['success','failure'].map(outcome=>['same-view clipboard '+outcome+' keeps existing feedback and exact public URL',async()=>{await click('コピー');check(copies.length===1&&copies[0].value===window.location.origin+'/p/'+first.id,'Clipboard did not receive exact public URL');const before=snapshot();await settle(copies[0],outcome);equal(snapshot(),before,'Clipboard result changed document');check(notice()===(outcome==='success'?'共有URLをコピーしました。':'コピーできませんでした。表示されたURLを選択してコピーしてください。'),'Current clipboard feedback missing');check(posts.length===0&&lists.length===1&&conversions.length===0,'Copy made an API request');}]),
 ...['success','failure'].map(outcome=>['new draft ignores earlier clipboard '+outcome,async()=>{await click('コピー');const old=copies[0];await click('＋ 新しい下書き');check(notice()==='新しい下書きです。'&&!document.querySelector('#share-url'),'New draft control failed');await preserveNotice(old,outcome);}]),
 ['opening another article ignores an earlier clipboard failure',async()=>{await click('コピー');const old=copies[0];await click('Second public fixture公開中 · 2026-10-09');check(element('#share-url').value.endsWith('/p/'+second.id),'Second article not opened');await preserveNotice(old,'failure');}],
 ['view roundtrip invalidates old copy even when the same public URL is displayed again',async()=>{await click('コピー');const old=copies[0];await click('Second public fixture公開中 · 2026-10-09');await click('First public fixture公開中 · 2026-10-09');check(element('#share-url').value===old.value,'Roundtrip did not restore same URL');await preserveNotice(old,'success');}],
 ['a newer successful save cannot be hidden by an earlier clipboard success',async()=>{await click('コピー');const old=copies[0];await click('非公開で保存');check(posts.length===1,'Save did not start once');await saveReply('success');check(notice().includes('下書きに保存しました。'),'Save success not acknowledged');await preserveNotice(old,'success');}],
 ['a copy started during save cannot hide the later save rejection',async()=>{await click('非公開で保存');check(posts.length===1,'Save did not start once');await click('コピー');const old=copies[0];await saveReply('failure');check(notice()==='Synthetic save rejection','Save rejection missing');await preserveNotice(old,'failure');}],
 ['an accepted conversion keeps its newer notice and converted body',async()=>{await click('コピー');const old=copies[0];await click('URLから変換');check(conversions.length===1,'Conversion not started');await act(async()=>conversions[0].resolve(Response.json({title:'Converted synthetic fixture',markdown:'# Converted synthetic body',sourceUrl:'https://example.org/converted'})));check(element('#markdown-body').value==='# Converted synthetic body'&&notice().includes('Markdownに変換しました。'),'Conversion not accepted');await preserveNotice(old,'success');}],
 ['ordinary draft edit retains valid clipboard feedback for the unchanged public URL',async()=>{await click('コピー');await edit('#markdown-body','# Unsaved synthetic edit');const before=snapshot();await settle(copies[0],'success');check(notice()==='共有URLをコピーしました。','Same public URL edit unnecessarily suppressed feedback');equal(snapshot(),before,'Copy result changed dirty draft');check(unloadWarns(),'Copy result cleared unsaved warning');}],
 ...['success','failure'].map(olderOutcome=>['newest copy feedback wins when older '+olderOutcome+' completes last',async()=>{await click('コピー');await click('コピー');check(copies.length===2&&copies[0].value===copies[1].value,'Explicit repeated copies changed');await settle(copies[1],olderOutcome==='success'?'failure':'success');await preserveNotice(copies[0],olderOutcome);}]),
 ['canceling a dirty leave keeps valid same-view clipboard feedback',async()=>{await edit('input[name="title"]','Unsaved synthetic title');await click('コピー');accept=false;const before=snapshot();await click('＋ 新しい下書き');check(confirmations.length===1,'Leave did not request discard confirmation');equal(snapshot(),before,'Canceled leave changed document');await settle(copies[0],'success');check(notice()==='共有URLをコピーしました。','Canceled leave invalidated unchanged view');equal(snapshot(),before,'Clipboard result changed canceled draft');}],
 ...['success','failure'].map(outcome=>['unmounted editor consumes late clipboard '+outcome+' without changing a new editor',async()=>{await click('コピー');const old=copies[0];await unmount();await setup();await click('＋ 新しい下書き');await preserveNotice(old,outcome);}]),
];
const results=[];
async function run(){for(const [name,operation] of tests){try{await setup();await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{await unmount();}}document.querySelector('#result').textContent=JSON.stringify({results});}
window.editorCopyUrlTestDone=run().catch(error=>{document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results});});
`;

test('actual Editor copy feedback belongs to its current view, notice and newest attempt',{timeout:15000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-copy-url-test.mjs');
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
  assert.equal(report.results.length,15,'Incomplete clipboard lifecycle coverage');
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
