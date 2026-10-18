import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

const fixture=String.raw`
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Editor from './client/editor';
import {encodeArticleCursor,decodeArticleCursor} from './src/article-pages.mjs';
window.IS_REACT_ACT_ENVIRONMENT=true;
const stamp='2026-10-18T00:00:00.000Z';
const record=index=>({id:'fixture-'+String(index).padStart(5,'0'),title:'Article fixture '+index,source_url:'https://source.example.test/'+index,markdown:'# Synthetic body '+index,published:index%2,created_at:stamp,updated_at:stamp,published_at:index%2?stamp:null});
const library=Array.from({length:205},(_,i)=>record(205-i));
let root,gets=[],posts=[],conversions=[],confirms=[];
window.confirm=message=>{confirms.push(message);return false;};
window.fetch=(url,options={})=>{
 if(String(url).startsWith('/api/articles')&&(!options.method||options.method==='GET'))return new Promise((resolve,reject)=>gets.push({url:String(url),options,resolve,reject}));
 if(url==='/api/articles'&&options.method==='POST')return new Promise((resolve,reject)=>posts.push({url,options,resolve,reject}));
 if(url==='/api/convert')return new Promise((resolve,reject)=>conversions.push({url,options,resolve,reject}));
 throw new Error('Unexpected fixture request');
};
const check=(ok,label)=>{if(!ok)throw new Error(label);};
const equal=(a,b,label)=>check(JSON.stringify(a)===JSON.stringify(b),label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));
const element=selector=>{const e=document.querySelector(selector);check(e,'Missing element '+selector);return e;};
const button=text=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===text);check(b,'Missing button '+text);return b;};
const rows=()=>[...document.querySelectorAll('.draft-row')].map(e=>e.textContent);
const state=()=>({title:element('input[name="title"]').value,markdown:element('#markdown-body').value,source:element('#source-url').value,rights:element('.rights-check input').checked,tab:element('.writing-surface').className,published:element('.document-status').textContent,share:document.querySelector('#share-url')?.value||'',message:document.querySelector('.notice')?.textContent||'',dirty:unloadWarns()});
function unloadWarns(){const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}
async function click(text){await act(async()=>button(text).click());}
async function edit(selector,value){await act(async()=>{const e=element(selector),proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>element('.article-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
async function search(value){await edit('#article-search',value);await submit();}
function payload(records,query='',cursor=null){
 const q=query.toLowerCase();
 let found=records.filter(a=>!q||(a.title.toLowerCase().includes(q)||a.source_url.toLowerCase().includes(q)));
 if(cursor){const p=decodeArticleCursor(cursor,query);found=found.filter(a=>a.updated_at<p.updatedAt||(a.updated_at===p.updatedAt&&a.id<p.id));}
 const articles=found.slice(0,100);return {articles,nextCursor:found.length>100?encodeArticleCursor(articles.at(-1),query):null,...(query?{query}:{})};
}
function request(index,query='',cursor=null){
 check(gets[index],'Missing GET '+index);const u=new URL(gets[index].url,'https://reader.example.test');
 check(u.pathname==='/api/articles','Wrong search route');check((u.searchParams.get('q')||'')===query,'Wrong search query: '+gets[index].url);check(u.searchParams.get('cursor')===cursor,'Wrong cursor context');check(gets[index].options.cache==='no-store','Search used cached list');
}
async function reply(index,body,status=200){await act(async()=>gets[index].resolve(Response.json(body,{status})));}
async function answer(index,records=library){
 const u=new URL(gets[index].url,'https://reader.example.test'),q=u.searchParams.get('q')||'',cursor=u.searchParams.get('cursor');const body=payload(records,q,cursor);await reply(index,body);return body;
}
async function acknowledge(index=0){const data=JSON.parse(posts[index].options.body);await act(async()=>posts[index].resolve(Response.json({id:data.id,published:data.published,url:'/p/'+data.id})));}
async function setup(){gets=[];posts=[];conversions=[];confirms=[];root=createRoot(element('#root'));await act(async()=>root.render(<Editor signOutPath="/synthetic-signout"/>));check(gets.length===1,'Wrong initial GET count');}
async function newDraft(){await click('＋ 新しい下書き');await edit('input[name="title"]','Unsaved title');await edit('#markdown-body','# Unsaved body');await edit('#source-url','https://source.example.test/unsaved');await act(async()=>element('.rights-check input').click());await click('プレビュー');}
const tests=[
 ['typing does not query, while explicit submit trims the query and finds an older saved title',async()=>{
  await answer(0);const records=library.map(a=>a.id===record(1).id?{...a,title:'古い針の記事'}:a);await edit('#article-search','  針  ');check(gets.length===1,'Typing triggered DB queries');await submit();request(1,'針');await answer(1,records);check(rows().length===1&&rows()[0].includes('古い針の記事'),'Search only filtered the current first page');check(element('.search-status').textContent.includes('針'),'Applied query was not identified');check(!posts.length&&!conversions.length,'Searching wrote or converted articles');
 }],
 ['search pages and back navigation carry the exact query and query-specific cursor',async()=>{
  await answer(0);await search('Article fixture');const first=await answer(1);await click('以前の記事のページ');request(2,'Article fixture',first.nextCursor);const second=await answer(2);check(rows().length===100,'Missing second filtered page');await click('以前の記事のページ');request(3,'Article fixture',second.nextCursor);await answer(3);check(rows().length===5,'Missing final filtered page');await click('新しい記事のページ');request(4,'Article fixture',first.nextCursor);await answer(4);check(element('.page-summary').textContent==='2ページ目 · 100件','Filtered Back lost page position');
 }],
 ['searching, paging, and clearing preserve the whole unsaved public draft and its confirmation',async()=>{
  await answer(0);await newDraft();const before=state();await search('Article fixture');const first=await answer(1);equal(state(),before,'Search changed the editing document');await click('以前の記事のページ');await answer(2);equal(state(),before,'Search paging changed the editing document');await click('検索を解除');request(3);await answer(3);equal(state(),before,'Clear changed the editing document');check(element('#article-search').value==='','Clear did not reset search input');check(!confirms.length,'Search unnecessarily prompted to discard the draft');check(!posts.length&&!conversions.length,'Read-only search caused writes');
 }],
 ['a failed search retains the last page and labels the shown query separately from the failed query',async()=>{
  await answer(0);await search('fixture 205');await answer(1);const previous=rows();await search('missing');await reply(2,{error:'Synthetic failure'},503);equal(rows(),previous,'Failed search erased the previous page');check(element('.search-status').textContent.includes('fixture 205'),'Failed search mislabeled old results');check(element('.list-error').textContent.includes('missing'),'Failure did not identify the attempted query');await edit('#article-search','unsubmitted newer input');await click('記事一覧を再読み込み');request(3,'missing');await answer(3);check(rows().length===0,'Exact failed search was not retried');check(element('#article-search').value==='unsubmitted newer input','Retry overwrote unsubmitted search text');check(element('.empty-list').textContent.includes('一致'),'No matches was presented as an empty library');
 }],
 ['a newer submitted search aborts and supersedes an earlier response without changing the draft',async()=>{
  await answer(0);await newDraft();const before=state();await search('fixture 2');await search('fixture 1');request(2,'fixture 1');check(gets[1].options.signal.aborted,'Superseded search was not aborted');await answer(2);const current=rows();await reply(1,payload(library,'fixture 2'));equal(rows(),current,'Stale search replaced newer results');equal(state(),before,'Search race changed the draft');
 }],
 ['a delayed old response body cannot replace the new search generation',async()=>{
  await answer(0);await search('fixture 2');let finish;await act(async()=>gets[1].resolve({ok:true,json:()=>new Promise(resolve=>finish=resolve)}));await search('fixture 1');await answer(2);const current=rows();await act(async()=>finish(payload(library,'fixture 2')));equal(rows(),current,'Stale body replaced current query');check(element('.draft-list').getAttribute('aria-busy')==='false','Old body relocked list');
 }],
 ['search replies require an exact echoed query instead of silently accepting an older unfiltered API',async()=>{
  await answer(0);const previous=rows();await search('fixture 1');await reply(1,payload(library));equal(rows(),previous,'Old unfiltered API was accepted as search results');check(element('.list-error'),'Missing query echo did not expose retry');await click('記事一覧を再読み込み');await reply(2,{...payload(library,'fixture 1'),query:'fixture 2'});equal(rows(),previous,'Cross-query payload was accepted');
 }],
 ['query-bound cursor metadata rejects another query atomically',async()=>{
  await answer(0);const previous=rows();await search('Article fixture');const body=payload(library,'Article fixture');await reply(1,{...body,nextCursor:encodeArticleCursor(body.articles.at(-1),'fixture')});equal(rows(),previous,'Cross-query cursor partially replaced rows');check(element('.list-error'),'Cross-query cursor did not fail');
 }],
 ['clear aborts pending search, restores the default first page, and ignores late results',async()=>{
  await answer(0);await search('fixture 1');await click('検索を解除');request(2);check(gets[1].options.signal.aborted,'Clear did not abort search');await answer(2);const current=rows();await answer(1);equal(rows(),current,'Cleared search returned late');check(element('#article-search').value==='','Late search restored cleared query');
 }],
 ['the same submitted pending query remains single-flight, but changed input can supersede it',async()=>{
  await answer(0);await edit('#article-search','fixture');await act(async()=>{const form=element('.article-search');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});check(gets.length===2,'Repeated submit duplicated a GET');await search('fixture 1');check(gets.length===3,'Changed search could not supersede pending query');await answer(2);
 }],
 ['private save refreshes the active search from its first page without losing the save acknowledgement',async()=>{
  await answer(0);await search('Article fixture');await answer(1);await click('以前の記事のページ');await answer(2);await newDraft();await click('下書き保存');check(posts.length===1,'Private save did not dispatch');await acknowledge();request(3,'Article fixture');await answer(3);check(element('.page-summary').textContent==='1ページ目 · 100件','Save did not reset filtered paging');check(document.querySelector('.notice').textContent.includes('下書きに保存しました'),'Search refresh hid confirmed save');check(!unloadWarns(),'Search refresh made confirmed save dirty');check(element('.page-selection'),'Saved document outside search lacks retained-selection guidance');
 }],
 ['save acknowledgement refreshes the latest requested query rather than a stale rendered query',async()=>{
  await answer(0);await newDraft();await search('fixture 1');await click('下書き保存');await acknowledge();request(2,'fixture 1');check(gets[1].options.signal.aborted,'Save refresh did not supersede old search read');await answer(2);const current=rows();await answer(1);equal(rows(),current,'Old search replaced save refresh');check(posts.length===1,'Search refresh repeated the write');
 }],
 ['overlong programmatic queries fail locally without sending a DB request',async()=>{
  await answer(0);const previous=rows();await search('x'.repeat(101));check(gets.length===1,'Overlong query reached the API');equal(rows(),previous,'Overlong query erased results');check(element('.search-feedback').textContent.includes('100'),'Missing query length guidance');check(element('#article-search').maxLength===100,'Input lacks the bounded maxlength');
 }],
 ['keyboard submission retains search input focus and announces the applied query',async()=>{
  await answer(0);await edit('#article-search','fixture 205');await act(async()=>element('#article-search').focus());await submit();await answer(1);check(document.activeElement===element('#article-search'),'Keyboard search stole focus');check(element('.search-status').getAttribute('role')==='status','Applied search is not an accessible status');check(element('.search-status').textContent.includes('fixture 205'),'Applied query was not announced');
 }],
 ['submitting whitespace clears a prior query without changing the editing document',async()=>{
  await answer(0);await search('fixture 1');await answer(1);await newDraft();const before=state();await search('   ');request(2);await answer(2);equal(state(),before,'Whitespace clear changed document');check(!element('.search-status').textContent.includes('fixture 1'),'Clear retained the prior applied query');
 }],
 ['a search submitted before initial load completes ignores the late default page',async()=>{
  await search('fixture 205');request(1,'fixture 205');check(gets[0].options.signal.aborted,'Initial request was not superseded');await answer(1);await answer(0);check(rows().length===1&&rows()[0].includes('205'),'Late initial response replaced query results');
 }],
 ['unmount isolates a late search result from a new editor instance',async()=>{
  await answer(0);await search('fixture 205');const old=gets[1];await act(async()=>root.unmount());root=null;await setup();await answer(0);const current=rows();await act(async()=>old.resolve(Response.json(payload(library,'fixture 205'))));equal(rows(),current,'Unmounted search reached a new editor');check(element('#article-search').value==='','Unmounted query reached a new editor');
 }]
];
const results=[];
async function run(){for(const [name,operation] of tests){try{await setup();await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{if(root){await act(async()=>root.unmount());root=null;}}}document.querySelector('#result').textContent=JSON.stringify({results});}
window.editorSearchTestDone=run().catch(error=>document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results}));
`;

test('actual Editor searches the complete saved library without mutating its document',{timeout:20000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});const output='.sites-runtime/editor-search-test.mjs';
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{await import(pathToFileURL(new URL(output+'?search',pathToFileURL(process.cwd()+'/')).pathname).href);await window.editorSearchTestDone;const report=JSON.parse(window.document.querySelector('#result').textContent);assert.ok(!report.fatal,report.fatal);assert.equal(report.results.length,17);for(const r of report.results)await t.test(r.name,()=>assert.equal(r.ok,true,r.error));}
 finally{await window.happyDOM.close();for(const [key,d]of originals){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}}
});

