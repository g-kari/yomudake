import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

// The actual React editor is exercised with deferred, synthetic-only fetches.
// No owner session, live article, production storage, credential, or external
// network request is involved. Keep this fixture distinct from editor-list.
const fixture=String.raw`
import React,{act,Component,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Editor from './client/editor';
import {ARTICLE_PAGE_SIZE,decodeArticleCursor,encodeArticleCursor} from './src/article-pages.mjs';
window.IS_REACT_ACT_ENVIRONMENT=true;
const nativeTimeout=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window);
let deadlines=new Map(),nextDeadline=900000;
window.setTimeout=(callback,delay,...args)=>{if(delay===15000){const id=nextDeadline++;deadlines.set(id,()=>callback(...args));return id;}return nativeTimeout(callback,delay,...args);};
window.clearTimeout=id=>{if(deadlines.has(id))deadlines.delete(id);else nativeClear(id);};
async function expire(){check(deadlines.size===1,'Expected one page deadline');const [id,callback]=[...deadlines][0];deadlines.delete(id);await act(async()=>callback());}

const OLDER='以前の記事のページ',NEWER='新しい記事のページ',RETRY='記事一覧を再読み込み';
const stamp='2026-10-09T12:00:00.000Z';
function article(index,equalTime=false){return {id:'00000000-0000-4000-8000-'+String(index).padStart(12,'0'),title:'Synthetic article '+String(index).padStart(4,'0'),source_url:'https://source.example.test/article/'+index,markdown:'# Synthetic body '+index,published:index%2,created_at:'2023-02-03T04:05:06Z',updated_at:equalTime?stamp:new Date(Date.parse(stamp)+index*1000).toISOString(),published_at:index%2?'2026-10-08T00:00:00Z':null};}
const compare=(a,b)=>a.updated_at===b.updated_at?(a.id===b.id?0:a.id>b.id?-1:1):a.updated_at>b.updated_at?-1:1;
const library=(count,equalTime=false)=>Array.from({length:count},(_,i)=>article(i+1,equalTime)).sort(compare);
const page=(records,cursor=null)=>{const ordered=[...records].sort(compare),position=cursor?decodeArticleCursor(cursor):null;const after=position?ordered.filter(a=>a.updated_at<position.updatedAt||(a.updated_at===position.updatedAt&&a.id<position.id)):ordered;const articles=after.slice(0,ARTICLE_PAGE_SIZE);return {articles,nextCursor:after.length>ARTICLE_PAGE_SIZE?encodeArticleCursor(articles[articles.length-1]):null};};
const path=cursor=>cursor?'/api/articles?'+new URLSearchParams({cursor}):'/api/articles';
let root,gets=[],posts=[],conversions=[],confirmations=[],renderErrors=[],confirmationAnswer=false;
class TestBoundary extends Component{
 constructor(props){super(props);this.state={failed:false};}
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<p className="test-render-error">Malformed pagination crashed the editor</p>:this.props.children;}
}
window.confirm=message=>{confirmations.push(message);return confirmationAnswer;};
window.fetch=(url,options={})=>{
 if(url==='/api/editor/articles'&&(!options.method||options.method==='GET'))return Promise.resolve(Response.json({protocol:'compare-v1'}));
 if((url==='/api/articles'||String(url).startsWith('/api/articles?'))&&(!options.method||options.method==='GET'))return new Promise((resolve,reject)=>gets.push({url:String(url),options,resolve,reject}));
 if(url==='/api/editor/articles'&&options.method==='POST')return new Promise((resolve,reject)=>posts.push({url,options,resolve,reject}));
 if(url==='/api/convert'&&options.method==='POST')return new Promise((resolve,reject)=>conversions.push({url,options,resolve,reject}));
 throw new Error('Unexpected synthetic request: '+url);
};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const equal=(actual,expected,label)=>check(JSON.stringify(actual)===JSON.stringify(expected),label+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));
const element=selector=>{const target=document.querySelector(selector);check(target,'Missing element: '+selector);return target;};
const button=text=>{const target=[...document.querySelectorAll('button')].find(b=>b.textContent===text);check(target,'Missing button: '+text);return target;};
const list=()=>element('.draft-list'),sidebar=()=>element('.sidebar'),summary=()=>element('.page-summary').textContent,notice=()=>document.querySelector('.notice')?.textContent||'';
const rows=()=>[...list().querySelectorAll('.draft-row')];
const rowTitles=()=>rows().map(row=>row.querySelector('span:last-child').firstChild.textContent);
const articleButton=record=>{const found=rows().find(row=>row.querySelector('span:last-child').firstChild.textContent===record.title);check(found,'Missing article: '+record.title);return found;};
const unloadWarns=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
const snapshot=()=>({title:element('input[name="title"]').value,body:element('#markdown-body').value,source:element('#source-url').value,rights:element('.rights-check input').checked,tab:element('.writing-surface').className,status:element('.document-status').textContent,share:document.querySelector('#share-url')?.value||'',meta:element('.document-meta').textContent,notice:notice(),dirty:unloadWarns()});
const pageSnapshot=()=>({rows:rowTitles(),summary:summary(),newer:button(NEWER).disabled,older:button(OLDER).disabled});
const healthy=()=>check(!renderErrors.length&&!document.querySelector('.test-render-error'),'Pagination crashed editor: '+renderErrors.join('; '));
const busy=()=>{check(list().getAttribute('aria-busy')==='true','Pending page lacks aria-busy');check([...sidebar().querySelectorAll('[role="status"]')].some(e=>/読み込/.test(e.textContent)),'Pending page lacks a live loading status');check(button(OLDER).disabled&&button(NEWER).disabled,'Pending pagination controls remain enabled');};
const settled=()=>{healthy();check(list().getAttribute('aria-busy')==='false','Settled page remains busy');check(rows().length<=100,'Editor rendered more than 100 rows');};
const failed=()=>{settled();check(sidebar().querySelector('[role="alert"]'),'Persistent sidebar failure missing');check(!button(RETRY).disabled,'Failed page cannot be retried');check(!document.querySelector('.empty-list'),'Failed page was shown as an empty library');};
const request=(index,cursor=null)=>{check(gets[index],'Missing GET '+index);check(gets[index].url===path(cursor),'Unexpected page target: '+gets[index].url+' != '+path(cursor));check(!gets[index].options.method||gets[index].options.method==='GET','Pagination used a write request');check(!gets[index].options.body,'Pagination sent a mutation body');check(gets[index].options.cache==='no-store','Pagination reused a cached list');};
const readOnly=()=>check(!posts.length&&!conversions.length,'Pagination issued a mutation request');
const expectPage=(payload,number)=>{settled();equal(rowTitles(),payload.articles.map(a=>a.title),'Page contents differ from synthetic API');check(summary()===number+'ページ目 · '+payload.articles.length+'件','Wrong page summary: '+summary());check(button(NEWER).disabled===(number===1),'Wrong newer-page availability');check(button(OLDER).disabled===(payload.nextCursor===null),'Wrong older-page availability');check(element('.list-pagination').getAttribute('role')==='group'&&element('.list-pagination').getAttribute('aria-label')==='記事一覧のページ切替','Pagination group is not accessible');check(element('.page-summary').getAttribute('role')==='status'&&element('.page-summary').getAttribute('aria-live')==='polite','Page summary is not a live status');};
async function click(text){await act(async()=>button(text).click());}
async function open(record){await act(async()=>articleButton(record).click());}
async function edit(selector,value){await act(async()=>{const target=element(selector);const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));});}
async function setup(strict=false){gets=[];posts=[];conversions=[];confirmations=[];renderErrors=[];confirmationAnswer=false;root=createRoot(element('#root'),{onCaughtError:error=>renderErrors.push(String(error))});const editor=<TestBoundary><Editor signOutPath="/synthetic-signout"/></TestBoundary>;await act(async()=>root.render(strict?<StrictMode>{editor}</StrictMode>:editor));check(gets.length===(strict?2:1),'Wrong initial request count: '+gets.length);}
async function unmount(){if(root){await act(async()=>root.unmount());root=null;}}
async function rawReply(index,response){check(gets[index],'Missing deferred GET '+index);await act(async()=>gets[index].resolve(response));}
async function reply(index,payload,status=200){await rawReply(index,Response.json(status===200?payload:{error:'Synthetic page HTTP failure'},{status}));}
async function reject(index){check(gets[index],'Missing deferred GET '+index);await act(async()=>gets[index].reject(new Error('Synthetic page network failure')));}
async function answer(index,records){const url=new URL(gets[index].url,'https://reader.example.test');const cursor=url.searchParams.get('cursor');const payload=page(records,cursor);request(index,cursor);await reply(index,payload);return payload;}
async function newDraft(){await click('＋ 新しい下書き');await edit('input[name="title"]','Unsaved synthetic title');await edit('#markdown-body','# Unsaved synthetic body');await edit('#source-url','https://source.example.test/unsaved');await act(async()=>element('.rights-check input').click());await click('プレビュー');}
const sent=index=>JSON.parse(posts[index].options.body);
async function acknowledge(index=0){check(posts[index],'Missing deferred POST '+index);const input=sent(index);await act(async()=>posts[index].resolve(Response.json({protocol:'compare-v1',revision:'a'.repeat(64),id:input.id,published:input.published,url:'/p/'+input.id})));}
const tests=[
 ['stalled next page retains prior rows and dirty draft, retries exact cursor and ignores late response',async()=>{
  const records=library(205),first=await answer(0,records),prior=pageSnapshot();await newDraft();const before=snapshot();await click(OLDER);await expire();failed();equal(pageSnapshot(),prior,'Timeout changed prior page');equal(snapshot(),before,'Timeout changed draft');check(gets[1].options.signal.aborted,'Page timeout did not abort GET');await click(RETRY);request(2,first.nextCursor);expectPage(await answer(2,records),2);await reply(1,page(records,first.nextCursor));expectPage(page(records,first.nextCursor),2);equal(snapshot(),before,'Late page changed draft');check(deadlines.size===0,'Page success retained timeout');readOnly();
 }],

 ['initial list remains editable and pagination appears only after successful metadata',async()=>{
  request(0);check(list().getAttribute('aria-busy')==='true','Initial list lacks loading state');check(!document.querySelector('.list-pagination'),'Pagination appeared before successful initial list');check(!document.querySelector('.empty-list'),'Initial request appeared empty');check(!element('input[name="title"]').disabled&&!element('#markdown-body').disabled,'Initial listing locked editing');const payload=await answer(0,library(101));expectPage(payload,1);readOnly();
 }],
 ['all 101 static articles are reachable without duplicate rows and back returns to first page',async()=>{
  const records=library(101),first=await answer(0,records),seen=[...rowTitles()];expectPage(first,1);await click(OLDER);request(1,first.nextCursor);busy();const last=await answer(1,records);expectPage(last,2);seen.push(...rowTitles());equal(seen,records.map(a=>a.title),'101-article traversal omitted or duplicated rows');check(new Set(seen).size===101,'101-article traversal duplicated a row');await click(NEWER);request(2);const back=await answer(2,records);expectPage(back,1);readOnly();
 }],
 ['all 205 static articles are reachable across three pages and recorded cursors drive back navigation',async()=>{
  const records=library(205),first=await answer(0,records),seen=[...rowTitles()];await click(OLDER);request(1,first.nextCursor);const second=await answer(1,records);expectPage(second,2);seen.push(...rowTitles());await click(OLDER);request(2,second.nextCursor);const third=await answer(2,records);expectPage(third,3);seen.push(...rowTitles());equal(seen,records.map(a=>a.title),'205-article traversal omitted or duplicated rows');check(new Set(seen).size===205,'205-article traversal duplicated a row');await click(NEWER);request(3,first.nextCursor);expectPage(await answer(3,records),2);await click(NEWER);request(4);expectPage(await answer(4,records),1);readOnly();
 }],
 ['equal updated timestamps retain opaque ID boundaries and every synthetic article is reachable',async()=>{
  const records=library(205,true),first=await answer(0,records),seen=[...rowTitles()];equal(decodeArticleCursor(first.nextCursor),{updatedAt:stamp,id:records[99].id},'Equal-time first boundary');await click(OLDER);request(1,first.nextCursor);const second=await answer(1,records);expectPage(second,2);seen.push(...rowTitles());equal(decodeArticleCursor(second.nextCursor),{updatedAt:stamp,id:records[199].id},'Equal-time second boundary');await click(OLDER);request(2,second.nextCursor);expectPage(await answer(2,records),3);seen.push(...rowTitles());equal(seen,records.map(a=>a.title),'Equal timestamps lost or repeated articles');readOnly();
 }],
 ['a successful empty first page alone presents empty-library guidance and disabled navigation',async()=>{
  const empty=await answer(0,[]);expectPage(empty,1);check(document.querySelector('.empty-list'),'Valid empty first page lacks guidance');await act(async()=>{button(OLDER).click();button(NEWER).click();});check(gets.length===1,'Disabled empty navigation started a request');readOnly();
 }],
 ['legacy bare lists are terminal even at 100 rows',async()=>{
  const records=library(100);await reply(0,{articles:records});expectPage({articles:records,nextCursor:null},1);await click(OLDER);check(gets.length===1,'Legacy response invented a continuation');readOnly();
 }],
 ['explicit null continuation at 100 rows is terminal',async()=>{
  const records=library(100);await reply(0,{articles:records,nextCursor:null});expectPage({articles:records,nextCursor:null},1);readOnly();
 }],
 ['an empty older page after concurrent deletion advises returning without declaring the library empty',async()=>{
  const records=library(205);await answer(0,records);await open(records[0]);const before=snapshot();await click(OLDER);const empty={articles:[],nextCursor:null};await reply(1,empty);expectPage(empty,2);const guidance=element('.empty-list').textContent;check(guidance.includes('このページの記事はありません')&&guidance.includes(NEWER),'Empty older page lacks return guidance');check(!guidance.includes('新しい下書きから始め'),'Empty older page falsely claims an empty library');equal(snapshot(),before,'Empty older page discarded selected document');check(element('.page-selection').textContent.includes('このページにありません'),'Empty older page lacks selected-document notice');await click(NEWER);request(2);expectPage(await answer(2,records),1);readOnly();
 }],
 ['legacy first-page order remains deployment-compatible without inventing a continuation',async()=>{
  const records=library(3).reverse();await reply(0,{articles:records});expectPage({articles:records,nextCursor:null},1);readOnly();
 }],
 ['initial explicit metadata rejects unsorted terminal rows and retries the original first-page target',async()=>{
  await newDraft();const before=snapshot();await reply(0,{articles:library(3).reverse(),nextCursor:null});failed();check(rows().length===0&&!document.querySelector('.list-pagination'),'Invalid initial order partially committed page state');equal(snapshot(),before,'Invalid initial order changed draft');await click(RETRY);request(1);expectPage(await answer(1,library(101)),1);equal(snapshot(),before,'Initial-order recovery changed draft');readOnly();
 }],
 ['a legacy later page terminates continuation while preserving its recorded back target',async()=>{
  const records=library(205),first=await answer(0,records);await click(OLDER);const second=page(records,first.nextCursor);await reply(1,{articles:second.articles});expectPage({...second,nextCursor:null},2);await click(NEWER);request(2);expectPage(await answer(2,records),1);readOnly();
 }],
 ['paging a dirty draft preserves every editable field, rights, preview, notice and unload guard',async()=>{
  const records=library(205);await answer(0,records);await newDraft();const before=snapshot();check(before.dirty,'Synthetic draft is not dirty');await click(OLDER);busy();equal(snapshot(),before,'Pending pagination changed dirty draft');check(!element('input[name="title"]').disabled&&!element('#source-url').disabled&&!element('.rights-check input').disabled,'Page-only load disabled draft controls');await answer(1,records);equal(snapshot(),before,'Older page changed dirty draft');check(!document.querySelector('.page-selection'),'Never-saved draft was described as an off-page saved article');await click(NEWER);await answer(2,records);equal(snapshot(),before,'Back page changed dirty draft');check(confirmations.length===0,'Page navigation asked to discard edits');readOnly();
 }],
 ['queued typing and a tab change during paging remain dirty and do not invalidate the page response',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await click(OLDER);await edit('input[name="title"]','Newer queued synthetic title');await edit('#markdown-body','# Newer queued synthetic body');await edit('#source-url','https://source.example.test/queued');await click('Markdown');const before=snapshot();const focused=element('input[name="title"]');focused.focus();const payload=await answer(1,records);expectPage(payload,2);equal(snapshot(),before,'Page commit discarded queued edits');check(document.activeElement===focused,'Page commit stole ongoing editing focus');readOnly();
 }],
 ['off-page published selection preserves creation metadata, publication and share URL',async()=>{
  const records=library(205);await answer(0,records);const selected=records.find(a=>a.published===1);await open(selected);await act(async()=>element('.rights-check input').click());await edit('#markdown-body','# Edited selected publication');await edit('input[name="title"]','Edited selected title');await click('Markdown');const before=snapshot();check(before.meta.includes('作成 2023-02-03 UTC'),'Selected creation metadata missing');check(before.share.endsWith('/p/'+selected.id)&&before.status==='公開中','Published selection missing share metadata');await click(OLDER);await answer(1,records);equal(snapshot(),before,'Off-page navigation changed selected publication');check(!rows().some(row=>row.getAttribute('aria-current')==='true'),'Off-page list falsely marks another selected article');check(document.querySelector('.page-selection'),'Off-page selected article lacks notice');await click(NEWER);await answer(2,records);equal(snapshot(),before,'Back navigation changed selected publication');check(articleButton(selected).getAttribute('aria-current')==='true','Returned selected row lacks aria-current');check(!document.querySelector('.page-selection'),'Returned selected row retains off-page notice');readOnly();
 }],
 ['paging never bypasses the existing New/Open dirty-discard confirmation',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await click(OLDER);const second=await answer(1,records),before=snapshot();await open(second.articles[0]);equal(snapshot(),before,'Open bypassed dirty guard after page-away');await click('＋ 新しい下書き');equal(snapshot(),before,'New bypassed dirty guard after page-away');check(confirmations.length===2&&confirmations.every(text=>text.includes('保存していない変更')),'Existing dirty guards were removed');check(gets.length===2,'Dirty guards started unrelated list requests');readOnly();
 }],
 ['explicitly accepted Open confirmation still selects a page-away article and clears dirty state',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await click(OLDER);const second=await answer(1,records);confirmationAnswer=true;await open(second.articles[0]);check(confirmations.length===1,'Accepted Open skipped or repeated confirmation');check(element('input[name="title"]').value===second.articles[0].title&&!unloadWarns(),'Accepted Open did not replace dirty draft');check(articleButton(second.articles[0]).getAttribute('aria-current')==='true','Accepted Open did not mark selected row');readOnly();
 }],
 ['same-tick repeated forward and reverse clicks are single-flight and retain prior page while pending',async()=>{
  const records=library(205),first=await answer(0,records),prior=rowTitles();await act(async()=>{const target=button(OLDER);target.click();target.click();button(NEWER).click();target.click();});check(gets.length===2,'Repeated same-tick page controls started duplicate GETs');request(1,first.nextCursor);busy();equal(rowTitles(),prior,'Pending page discarded last successful rows');check(summary()==='1ページ目 · 100件 · 読み込み中','Pending page committed history early');expectPage(await answer(1,records),2);await act(async()=>{button(NEWER).click();button(NEWER).click();button(OLDER).click();});check(gets.length===3,'Repeated back controls started duplicate GETs');request(2);expectPage(await answer(2,records),1);readOnly();
 }],
 ['keyboard-triggered forward and back pagination return focus to the article navigation',async()=>{
  const records=library(205);await answer(0,records);button(OLDER).focus();await click(OLDER);await answer(1,records);check(document.activeElement===list(),'Forward pagination did not restore navigation focus');button(NEWER).focus();await click(NEWER);await answer(2,records);check(document.activeElement===list(),'Back pagination did not restore navigation focus');readOnly();
 }],
 ['a focus change during a keyboard page load is respected',async()=>{
  const records=library(205);await answer(0,records);button(OLDER).focus();await click(OLDER);const target=element('#markdown-body');target.focus();await answer(1,records);check(document.activeElement===target,'Pagination stole focus after user moved into the editor');readOnly();
 }],
 ['successful pagination resets only the list scroll position and preserves editor and document scroll',async()=>{
  const records=library(205);await answer(0,records);list().scrollTop=720;list().scrollLeft=80;element('#markdown-body').scrollTop=250;element('#editor-page').scrollTop=340;document.documentElement.scrollTop=460;await click(OLDER);check(list().scrollTop===720,'Pending page reset prior-list scroll too early');await answer(1,records);check(list().scrollTop===0&&list().scrollLeft===0,'Successful page did not reset list scroll');check(element('#markdown-body').scrollTop===250&&element('#editor-page').scrollTop===340&&document.documentElement.scrollTop===460,'List pagination changed editing/document scroll');readOnly();
 }],
 ['failed pagination retains list scroll and a successful retry resets it',async()=>{
  const records=library(205);await answer(0,records);list().scrollTop=620;list().scrollLeft=60;await click(OLDER);await reject(1);failed();check(list().scrollTop===620&&list().scrollLeft===60,'Failed page discarded prior scroll position');await click(RETRY);await answer(2,records);check(list().scrollTop===0&&list().scrollLeft===0,'Recovered page did not reset list scroll');readOnly();
 }],
 ['network failure retains rows and history, and repeated retry targets the exact failed older cursor',async()=>{
  const records=library(205),first=await answer(0,records),before=pageSnapshot();await newDraft();const draft=snapshot();await click(OLDER);await reject(1);failed();equal(pageSnapshot(),before,'Network failure committed rows or history');equal(snapshot(),draft,'Network failure discarded draft');button(RETRY).focus();await act(async()=>{const target=button(RETRY);target.click();target.click();target.click();});check(gets.length===3,'Retry duplicated a GET');request(2,first.nextCursor);busy();expectPage(await answer(2,records),2);check(document.activeElement===list(),'Keyboard retry did not restore navigation focus');equal(snapshot(),draft,'Successful retry changed dirty draft');check(!sidebar().querySelector('[role="alert"]'),'Successful retry retained obsolete failure');readOnly();
 }],
 ['HTTP failure on back navigation leaves page history intact and retries the recorded first-page target',async()=>{
  const records=library(205);await answer(0,records);await click(OLDER);await answer(1,records);const before=pageSnapshot();await click(NEWER);request(2);await reply(2,null,503);failed();equal(pageSnapshot(),before,'Failed back committed history');await click(RETRY);request(3);expectPage(await answer(3,records),1);readOnly();
 }],
 ['invalid JSON on an older page leaves prior rows and retry retains the exact opaque cursor',async()=>{
  const records=library(101),first=await answer(0,records),before=pageSnapshot();await click(OLDER);await rawReply(1,new Response('{invalid JSON',{status:200}));failed();equal(pageSnapshot(),before,'Invalid JSON changed prior page');await click(RETRY);request(2,first.nextCursor);expectPage(await answer(2,records),2);readOnly();
 }],
 ['retry focus does not replace focus moved into the editor while recovery is pending',async()=>{
  const records=library(205);await answer(0,records);await click(OLDER);await reject(1);button(RETRY).focus();await click(RETRY);const target=element('input[name="title"]');target.focus();await answer(2,records);check(document.activeElement===target,'Retry stole focus from ongoing editing');readOnly();
 }],
 ['current-page cursor cycles fail atomically and recovery targets the same older page',async()=>{
  const records=library(205),first=await answer(0,records),before=pageSnapshot();await click(OLDER);await reply(1,first);failed();equal(pageSnapshot(),before,'Repeated continuation cursor committed a cycle');await click(RETRY);request(2,first.nextCursor);expectPage(await answer(2,records),2);readOnly();
 }],
 ['earlier-history cursor cycles cannot partially replace a later successful page',async()=>{
  const records=library(305),first=await answer(0,records);await click(OLDER);const second=await answer(1,records),before=pageSnapshot();await click(OLDER);await reply(2,first);failed();equal(pageSnapshot(),before,'Historical cursor cycle changed page or history');await click(RETRY);request(3,second.nextCursor);expectPage(await answer(3,records),3);readOnly();
 }],
 ['list mutation uses live keyset pages and back reloads its recorded cursor rather than stale cached rows',async()=>{
  let records=library(205);const first=await answer(0,records);await click(OLDER);const second=await answer(1,records);await click(OLDER);expectPage(await answer(2,records),3);const moved={...records.find(a=>a.id===article(80).id),updated_at:'2026-10-10T14:00:00.000Z',title:'Synthetic article moved newest'};records=records.filter(a=>a.id!==moved.id&&a.id!==article(105).id);records.push(moved,article(999));await click(NEWER);request(3,first.nextCursor);const changedSecond=await answer(3,records);expectPage(changedSecond,2);check(!rowTitles().includes(moved.title),'Back loaded stale cached rows after synthetic update');check(changedSecond.nextCursor!==second.nextCursor,'Synthetic mutation did not produce a changed live boundary');await click(NEWER);request(4);const changedFirst=await answer(4,records);expectPage(changedFirst,1);check(rowTitles()[0]===moved.title,'First page was not reloaded after concurrent mutation');await click(OLDER);request(5,changedFirst.nextCursor);expectPage(await answer(5,records),2);readOnly();
 }],
 ['acknowledged publication from page two resets to newest first page and keeps publication, share and save notice',async()=>{
  const records=library(205);await answer(0,records);await click(OLDER);await answer(1,records);await newDraft();await click('公開する');check(posts.length===1,'Publication did not start');await acknowledge();request(2);busy();check(summary()==='2ページ目 · 100件 · 読み込み中','Save refresh reset history before success');check(element('.document-status').textContent==='公開中'&&element('#share-url').value.endsWith('/p/'+sent(0).id),'Acknowledged publication metadata missing');check(notice().includes('公開しました。')&&!unloadWarns(),'Acknowledged publication lost clean/save state');const before=snapshot();expectPage(await answer(2,records),1);equal(snapshot(),before,'Successful first-page save refresh changed acknowledged document');check(notice().includes('公開しました。')&&posts.length===1,'Page refresh repeated or erased publication');
 }],
 ['a freshly saved article keeps its returned creation metadata after page-away without reopening it',async()=>{
  let records=library(205);await answer(0,records);await newDraft();await click('下書き保存');await acknowledge();const input=sent(0),saved={...article(999),id:input.id,title:input.title,markdown:input.markdown,source_url:input.sourceUrl,published:0,published_at:null,created_at:'2024-01-02T03:04:05Z',updated_at:'2026-10-10T14:00:00.000Z'};records=[saved,...records].sort(compare);expectPage(await answer(1,records),1);check(element('.document-meta').textContent.includes('作成 2024-01-02 UTC'),'Fresh saved selection did not acquire creation metadata');const before=snapshot();await click(OLDER);expectPage(await answer(2,records),2);equal(snapshot(),before,'Fresh saved creation metadata or acknowledgement was lost off-page');check(document.querySelector('.page-selection'),'Fresh saved off-page selection lacks notice');check(posts.length===1,'Fresh saved metadata paging repeated a write');
 }],
 ['failed acknowledged-save refresh leaves old page history and its retry still targets first page',async()=>{
  const records=library(205);await answer(0,records);await click(OLDER);await answer(1,records);const prior=pageSnapshot();await newDraft();await click('下書き保存');await acknowledge();request(2);await reject(2);failed();equal(pageSnapshot(),prior,'Failed save refresh committed first-page history');check(!unloadWarns()&&notice().includes('下書きに保存しました。'),'Failed listing removed acknowledged save');const before=snapshot();await click(RETRY);request(3);expectPage(await answer(3,records),1);equal(snapshot(),before,'Save refresh retry changed acknowledged document');check(posts.length===1&&!conversions.length,'Save refresh retry repeated a mutation');
 }],
 ['a save overrides an older pending page success and cannot be unlocked by that stale reply',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await click(OLDER);await click('下書き保存');check(posts.length===1,'Pending page prevented save');await acknowledge();request(2);const before=snapshot();let staleReads=0;const data={get articles(){staleReads++;return library(100);},nextCursor:null};await rawReply(1,{ok:true,json:async()=>data});check(staleReads===0,'Superseded page consumed stale records');busy();equal(snapshot(),before,'Superseded page changed saved document');check(element('#source-url').disabled,'Stale page unlocked acknowledged save refresh');expectPage(await answer(2,records),1);check(!element('#source-url').disabled&&!unloadWarns(),'Current save refresh failed to settle');check(posts.length===1,'Stale page repeated save');
 }],
 ['a stale page failure cannot resurrect errors after a successful first-page save refresh',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await click(OLDER);await click('下書き保存');await acknowledge();expectPage(await answer(2,records),1);const before=snapshot(),prior=pageSnapshot();await reject(1);settled();equal(pageSnapshot(),prior,'Stale page failure changed first page');equal(snapshot(),before,'Stale page failure changed acknowledgement');check(!sidebar().querySelector('[role="alert"]'),'Stale page failure resurrected sidebar error');
 }],
 ['initial page replies cannot replace a later save first-page refresh or erase its new continuation',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();const records=library(205),fresh=await answer(1,records);expectPage(fresh,1);let staleReads=0;await rawReply(0,{ok:true,json:async()=>({get articles(){staleReads++;return []},nextCursor:null})});check(staleReads===0,'Superseded initial page consumed records');expectPage(fresh,1);await click(OLDER);request(2,fresh.nextCursor);expectPage(await answer(2,records),2);check(posts.length===1&&!unloadWarns(),'Stale initial page changed acknowledged save');
 }],
 ['newer queued edits survive save acknowledgement, first-page refresh, and later page navigation',async()=>{
  const records=library(205);await answer(0,records);await click(OLDER);await answer(1,records);await newDraft();await click('公開する');await edit('#markdown-body','# Queued after submitted publication');await edit('input[name="title"]','Queued publication title');await acknowledge();check(notice().includes('公開しました。')&&notice().includes('まだ保存されていません'),'Save acknowledgement lost queued-edit status');const before=snapshot();expectPage(await answer(2,records),1);equal(snapshot(),before,'First-page refresh lost queued edits');check(unloadWarns(),'First-page refresh cleared queued dirty state');await click(OLDER);expectPage(await answer(3,records),2);equal(snapshot(),before,'Subsequent pagination lost queued edits/save acknowledgement');check(posts.length===1,'Queued editing pagination repeated publication');
 }],
 ['edits queued during acknowledged-save refresh remain dirty and update the save acknowledgement on completion',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await click('公開する');await acknowledge();check(!unloadWarns()&&notice().includes('公開しました。'),'Publication was not acknowledged before refresh');await edit('input[name="title"]','Queued during save refresh');await edit('#markdown-body','# Queued while refresh is pending');await click('Markdown');const before=snapshot();expectPage(await answer(1,records),1);const after=snapshot();equal({...after,notice:before.notice},before,'Save refresh discarded edits queued after acknowledgement');check(after.dirty&&after.notice.includes('公開しました。')&&after.notice.includes('まだ保存されていません'),'Refresh failed to report newer unsaved edits');check(posts.length===1,'Queued save-refresh editing repeated publication');
 }],
 ['a rejected save does not invalidate an already pending valid page',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await click(OLDER);await click('下書き保存');await act(async()=>posts[0].resolve(Response.json({error:'Synthetic save rejected'},{status:400})));const before=snapshot();expectPage(await answer(1,records),2);equal(snapshot(),before,'Pending page changed rejected draft');check(notice()==='Synthetic save rejected'&&unloadWarns(),'Pending page erased save rejection/dirty state');check(gets.length===2&&posts.length===1,'Rejected save started refresh or repeated write');
 }],
 ['same-tick save and pagination controls cannot dispatch a page during the save or its refresh',async()=>{
  const records=library(205);await answer(0,records);await newDraft();await act(async()=>{button('下書き保存').click();button(OLDER).click();button('下書き保存').click();});check(posts.length===1&&gets.length===1,'Same-tick save/page controls duplicated requests');check(button(OLDER).disabled&&button(NEWER).disabled,'Pagination remains enabled during save');await acknowledge();check(gets.length===2,'Acknowledged save did not start exactly one first-page refresh');await act(async()=>{button(OLDER).click();button(NEWER).click();});check(gets.length===2,'Pagination raced acknowledged-save refresh');expectPage(await answer(1,records),1);
 }],
 ['conversion single-flight blocks paging, and failed conversion leaves current history and continuation',async()=>{
  const records=library(205),first=await answer(0,records);await newDraft();confirmationAnswer=true;const prior=pageSnapshot();await act(async()=>{button('URLから変換').click();button(OLDER).click();});check(conversions.length===1&&gets.length===1,'Pagination raced pending conversion');check(button(OLDER).disabled,'Pagination remains enabled during conversion');await act(async()=>conversions[0].resolve(Response.json({error:'Synthetic conversion rejected'},{status:400})));equal(pageSnapshot(),prior,'Failed conversion changed pagination');await click(OLDER);request(1,first.nextCursor);expectPage(await answer(1,records),2);check(notice()==='Synthetic conversion rejected','Page navigation erased conversion rejection');
 }],
 ['unmount invalidates a pending page before late records are consumed by the replacement editor',async()=>{
  const records=library(205);await answer(0,records);await click(OLDER);const old=gets[1];await unmount();await setup();await newDraft();const before=snapshot();let staleReads=0;await act(async()=>old.resolve({ok:true,json:async()=>({get articles(){staleReads++;return library(100)},nextCursor:null})}));check(staleReads===0,'Unmounted page consumed stale records');equal(snapshot(),before,'Unmounted page changed replacement draft');check(gets.length===1&&list().getAttribute('aria-busy')==='true','Unmounted page settled replacement load');expectPage(await answer(0,library(101)),1);equal(snapshot(),before,'Replacement initial page changed dirty draft');readOnly();
 }],
 ['unmounted page failure never reaches the replacement editor or changes its first-page history',async()=>{
  const records=library(205);await answer(0,records);await click(OLDER);const old=gets[1];await unmount();await setup();const fresh=await answer(0,library(101));await newDraft();const before=snapshot();await act(async()=>old.reject(new Error('Synthetic unmounted page rejection')));expectPage(fresh,1);equal(snapshot(),before,'Unmounted page failure changed replacement draft');check(!sidebar().querySelector('[role="alert"]'),'Unmounted page failure created replacement error');readOnly();
 }],
 ['StrictMode replay ignores obsolete initial metadata and current paging preserves dirty edits',async()=>{
  await newDraft();const before=snapshot();let staleReads=0;await rawReply(0,{ok:true,json:async()=>({get articles(){staleReads++;return library(100)},nextCursor:null})});check(staleReads===0,'StrictMode replay consumed obsolete metadata');check(list().getAttribute('aria-busy')==='true','Obsolete StrictMode load settled current request');const records=library(205),first=await answer(1,records);expectPage(first,1);await click(OLDER);request(2,first.nextCursor);expectPage(await answer(2,records),2);equal(snapshot(),before,'StrictMode paging changed dirty edits');readOnly();
 },true],
 ['StrictMode stale failure cannot erase a later page or restore old failure guidance',async()=>{
  const records=library(205);await answer(1,records);await click(OLDER);const second=await answer(2,records),before=pageSnapshot();await reject(0);expectPage(second,2);equal(pageSnapshot(),before,'Obsolete StrictMode failure changed page');check(!sidebar().querySelector('[role="alert"]'),'Obsolete StrictMode failure created error');readOnly();
 },true]
];
const firstPage=page(library(205)),malformedPage=page(library(205),firstPage.nextCursor);
const noncanonical=position=>btoa(JSON.stringify(position)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const position=decodeArticleCursor(malformedPage.nextCursor);
const malformed=[
 ['oversized explicit page',{articles:library(101),nextCursor:null}],
 ['oversized legacy page',{articles:library(101)}],
 ['zero-row continuation',{articles:[],nextCursor:malformedPage.nextCursor}],
 ['short-page continuation',{articles:malformedPage.articles.slice(0,99),nextCursor:encodeArticleCursor(malformedPage.articles[98])}],
 ['numeric continuation',{articles:malformedPage.articles,nextCursor:1}],
 ['boolean continuation',{articles:malformedPage.articles,nextCursor:false}],
 ['object continuation',{articles:malformedPage.articles,nextCursor:{cursor:malformedPage.nextCursor}}],
 ['array continuation',{articles:malformedPage.articles,nextCursor:[malformedPage.nextCursor]}],
 ['empty continuation',{articles:malformedPage.articles,nextCursor:''}],
 ['invalid alphabet continuation',{articles:malformedPage.articles,nextCursor:'not+a/canonical-cursor'}],
 ['padded continuation',{articles:malformedPage.articles,nextCursor:malformedPage.nextCursor+'='}],
 ['overlong continuation',{articles:malformedPage.articles,nextCursor:'a'.repeat(513)}],
 ['wrong cursor version',{articles:malformedPage.articles,nextCursor:noncanonical({version:2,...position})}],
 ['cursor extra key',{articles:malformedPage.articles,nextCursor:noncanonical({version:1,...position,extra:true})}],
 ['noncanonical JSON key order',{articles:malformedPage.articles,nextCursor:noncanonical({...position,version:1})}],
 ['wrong last-row position',{articles:malformedPage.articles,nextCursor:encodeArticleCursor(malformedPage.articles[98])}],
 ['wrong last-row timestamp',{articles:malformedPage.articles,nextCursor:encodeArticleCursor({...malformedPage.articles[99],updated_at:'2026-10-10T00:00:00Z'})}],
 ['invalid last-row cursor timestamp',{articles:malformedPage.articles.map((a,i)=>i===99?{...a,updated_at:'not-a-date'}:a),nextCursor:malformedPage.nextCursor}],
 ['duplicate IDs with cursor',{articles:malformedPage.articles.map((a,i)=>i===0?{...a,id:malformedPage.articles[1].id}:a),nextCursor:malformedPage.nextCursor}],
 ['mixed valid and malformed records',{articles:malformedPage.articles.map((a,i)=>i===42?{...a,title:null}:a),nextCursor:malformedPage.nextCursor}],
 ['unsorted explicit continuation',{articles:malformedPage.articles.map((a,i)=>i===0?malformedPage.articles[1]:i===1?malformedPage.articles[0]:a),nextCursor:malformedPage.nextCursor}],
 ['unsorted terminal page',{articles:malformedPage.articles.slice(0,3).reverse(),nextCursor:null}],
 ['equal-time ascending ID order',{articles:library(3,true).reverse(),nextCursor:null}],
 ['row equal to requested cursor boundary',{articles:[firstPage.articles[99],...malformedPage.articles.slice(0,99)],nextCursor:encodeArticleCursor(malformedPage.articles[98])}],
 ['row above requested cursor boundary',{articles:[firstPage.articles[98],...malformedPage.articles.slice(0,99)],nextCursor:encodeArticleCursor(malformedPage.articles[98])}],
 ['legacy row crossing requested cursor boundary',{articles:[firstPage.articles[99]]}],
 ['missing articles with cursor',{nextCursor:malformedPage.nextCursor}]
];
for(const [name,payload] of malformed)tests.push(['malformed '+name+' fails atomically and can retry the same target',async()=>{
 const records=library(205),first=await answer(0,records),prior=pageSnapshot();await newDraft();const before=snapshot();await click(OLDER);await reply(1,payload);failed();equal(pageSnapshot(),prior,'Malformed '+name+' partially committed rows/history');equal(snapshot(),before,'Malformed '+name+' changed editing state');await click(RETRY);request(2,first.nextCursor);expectPage(await answer(2,records),2);equal(snapshot(),before,'Recovered '+name+' changed editing state');readOnly();
}]);
const results=[];
async function run(){for(const [name,operation,strict] of tests){try{await setup(Boolean(strict));await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{await unmount();}}document.querySelector('#result').textContent=JSON.stringify({results,total:tests.length});}
window.editorPaginationTestDone=run().catch(error=>{document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results,total:tests.length});});
`;

test('actual Editor cursor pagination preserves drafts, recovery, save precedence and lifecycle safety',{timeout:60000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-pagination-test.mjs');
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});
 window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  await import(pathToFileURL(output).href);await window.editorPaginationTestDone;
  const report=JSON.parse(window.document.querySelector('#result').textContent);
  assert.ok(!report.fatal,report.fatal);
  assert.equal(report.total,71,'Unexpected pagination coverage count');
  assert.equal(report.results.length,report.total,'Incomplete pagination coverage');
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
