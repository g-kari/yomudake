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
const saved={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'Notebook fixture',source_url:'https://example.org/note',markdown:'# Notebook fixture\n\nSynthetic text. [External reference](https://example.org/reference)',published:0,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-10T00:00:00Z',published_at:null};
window.confirm=()=>false;
window.fetch=()=>Promise.resolve(Response.json({articles:[saved,{...saved,id:'unsafe-source',title:'Unsafe source fixture',source_url:'javascript:alert(1)'}]}));
const root=createRoot(document.querySelector('#root'));
const element=selector=>document.querySelector(selector);
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
const check=(condition,message)=>{if(!condition)throw new Error(message);};
async function click(text){await act(async()=>button(text).click());}
async function input(selector,value){await act(async()=>{const target=element(selector);const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));});}
async function run(){
 const results=[];
 try{
  await act(async()=>root.render(<Editor signOutPath="/synthetic-signout"/>));
  const tests=[
   ['initial view is one focused preview and hidden Markdown is retained',async()=>{
    check(element('#markdown-panel').hidden,'Source pane was visible');check(!element('#preview-panel').hidden,'Preview was hidden');
    check(button('プレビュー').getAttribute('aria-pressed')==='true','Preview selection missing');check(button('Markdown').getAttribute('aria-controls')==='markdown-panel','Missing source relationship');
    check(element('#markdown-body').value.length>0,'Hidden initial source was lost');check(button('公開する').disabled,'Publication guard missing');
   }],
   ['opening an article selects its notebook index and preserves real source and timestamp',async()=>{
    await click('Notebook fixture下書き · 2026-10-10');check(element('.draft-row.selected').getAttribute('aria-current')==='true','Index selection missing');check(!element('#preview-panel').hidden,'Open did not focus preview');
    check(element('.document-source button').textContent===saved.source_url,'Source changed');check(element('.document-meta').textContent.includes('作成 2026-10-09 UTC'),'Timestamp not from saved article');check(element('input[name="title"]').value===saved.title,'Title lost');
   }],
   ['source and body warning activators have no direct external href and close before restoring focus',async()=>{
    const source=element('.document-source button');check(!source.hasAttribute('href'),'Source can bypass warning');await act(async()=>source.click());
    const dialog=element('.external-dialog');check(dialog.open,'Source warning not open');check(element('.external-dialog .button').href===saved.source_url,'Confirmed source changed');check(!element('.external-dialog iframe'),'Admin acquired an iframe');
    await click('戻る');check(!dialog.open,'Cancel did not close');check(document.activeElement===source,'Cancel did not restore unfocused trigger');
    const external=button('External reference');await act(async()=>external.click());check(dialog.open,'Body warning not open');check(element('.external-dialog .button').href==='https://example.org/reference','Body destination changed');
    await act(async()=>dialog.dispatchEvent(new Event('cancel',{cancelable:true})));check(!dialog.open,'Escape cancellation did not close');check(document.activeElement===external,'Escape did not restore trigger');
   }],
   ['tab switches retain edited text and the unsaved navigation guard',async()=>{
    await click('Markdown');check(element('#preview-panel').hidden&&!element('#markdown-panel').hidden,'Both panes visible');await input('#markdown-body','# Edited notebook\n\nNew text.');await click('プレビュー');
    check(element('#preview-panel').textContent.includes('Edited notebook'),'Preview did not follow edits');await click('＋ 新しい下書き');check(element('#markdown-body').value.includes('Edited notebook'),'Cancelled navigation lost edits');check(!element('#preview-panel').hidden,'Cancelled navigation changed view');
    await click('Markdown');check(element('#markdown-body').value.includes('Edited notebook'),'Tab switch lost source');
   }],
   ['warning cancellation keeps unsaved title/body/source/rights and the unload guard intact',async()=>{
    const before={title:element('input[name="title"]').value,body:element('#markdown-body').value,source:element('#source-url').value,rights:element('.rights-check input').checked};
    await act(async()=>element('.document-source button').click());await click('戻る');
    check(JSON.stringify(before)===JSON.stringify({title:element('input[name="title"]').value,body:element('#markdown-body').value,source:element('#source-url').value,rights:element('.rights-check input').checked}),'Warning changed unsaved fields');
    const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);check(event.defaultPrevented,'Warning cleared dirty unload protection');
   }],
   ['new draft starts in editing view with safe empty state and no stale source',async()=>{
    window.confirm=()=>true;await click('＋ 新しい下書き');check(!element('#markdown-panel').hidden&&element('#preview-panel').hidden,'New draft not editable');check(element('#markdown-body').value==='','New draft retained body');check(!element('.document-source a')&&!element('.document-source button'),'New draft retained source link');
    check(!element('.draft-row.selected'),'New draft retained index selection');await click('プレビュー');check(element('.preview-empty').textContent.includes('URLから変換'),'Empty view lacks a next action');
   }],
   ['untrusted saved source never becomes a clickable script URL',async()=>{
    await click('Unsafe source fixture下書き · 2026-10-10');check(!element('.document-source a')&&!element('.document-source button'),'Unsafe source was linked');check(element('.document-source').textContent==='元URLを確認してください','Unsafe source not explained');
   }],
   ['owner navigation and all publishing actions remain available',async()=>{
    check(element('.sidebar-footer a[href="/synthetic-signout"]').target==='_top','Sign out changed');check(element('.sidebar-footer a[href="/"]').rel.includes('noopener'),'Public navigation missing protection');
    check(button('下書き保存')&&button('公開する'),'Save/publish distinction lost');check(element('.rights-check').textContent==='出典・ライセンス・個人情報を確認した','Rights guard unclear');
   }]
  ];
  for(const [name,operation] of tests){try{await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}}
 }finally{await act(async()=>root.unmount());}
 document.querySelector('#result').textContent=JSON.stringify({results});
}
window.notebookTestDone=run();
`;

test('actual Editor notebook keeps one active view and the original article actions',{timeout:15000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-notebook-test.mjs');
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});
 window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  await import(pathToFileURL(output).href);await window.notebookTestDone;
  const report=JSON.parse(window.document.querySelector('#result').textContent);assert.equal(report.results.length,8);
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
