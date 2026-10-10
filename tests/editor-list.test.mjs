import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

// Every request is deferred and answered locally. No owner session, external
// article, network connection, production database, or real credential is used.
const fixture=String.raw`
import React,{act,Component,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Editor from './client/editor';
window.IS_REACT_ACT_ENVIRONMENT=true;
const saved={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'Saved list fixture',source_url:'https://source.example.test/saved',markdown:'# Saved list body',published:1,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z',published_at:'2026-10-09T00:00:00Z'};
const fresh={...saved,id:'6d467bf2-2d45-4343-90b0-85bd24d4fb96',title:'Fresh list fixture',published:0,published_at:null};
let root,gets=[],posts=[],conversions=[],confirmations=[],renderErrors=[];
class TestBoundary extends Component{
 constructor(props){super(props);this.state={failed:false};}
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<p className="test-render-error">Malformed list crashed the editor</p>:this.props.children;}
}
window.confirm=message=>{confirmations.push(message);return false;};
window.fetch=(url,options={})=>{
 if(url==='/api/articles'&&(!options.method||options.method==='GET'))return new Promise((resolve,reject)=>gets.push({url,options,resolve,reject}));
 if(url==='/api/articles'&&options.method==='POST')return new Promise((resolve,reject)=>posts.push({url,options,resolve,reject}));
 if(url==='/api/convert'&&options.method==='POST')return new Promise((resolve,reject)=>conversions.push({url,options,resolve,reject}));
 throw new Error('Unexpected synthetic request: '+url);
};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const element=selector=>{const found=document.querySelector(selector);check(found,'Missing element: '+selector);return found;};
const button=text=>{const found=[...document.querySelectorAll('button')].find(b=>b.textContent===text);check(found,'Missing button: '+text);return found;};
const retry=()=>button('記事一覧を再読み込み');
const list=()=>element('.draft-list');
const sidebar=()=>element('.sidebar');
const notice=()=>document.querySelector('.notice')?.textContent||'';
const snapshot=()=>({title:element('input[name="title"]').value,body:element('#markdown-body').value,source:element('#source-url').value,rights:element('.rights-check input').checked,tab:element('.writing-surface').className,status:element('.document-status').textContent,share:document.querySelector('#share-url')?.value||''});
const equal=(actual,expected,label)=>check(JSON.stringify(actual)===JSON.stringify(expected),label+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));
const unloadWarns=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
const healthy=()=>check(renderErrors.length===0&&!document.querySelector('.test-render-error'),'List response crashed the editor: '+renderErrors.join('; '));
const busy=()=>{check(list().getAttribute('aria-busy')==='true','Pending list is not exposed as aria-busy');const status=sidebar().querySelector('[role="status"]');check(status&&/読み込|取得/.test(status.textContent),'Sidebar loading status missing');};
const settled=()=>check(list().getAttribute('aria-busy')==='false','Settled list remains busy or lost its aria-busy state');
const failed=()=>{healthy();settled();check(!document.querySelector('.empty-list'),'Failed request was presented as an empty library');check(sidebar().contains(retry()),'Retry action is not in the article sidebar');const explanation=sidebar().cloneNode(true);explanation.querySelectorAll('button').forEach(button=>button.remove());check(/読み込め|失敗/.test(explanation.textContent),'Persistent sidebar failure explanation missing');check(!retry().disabled,'Settled list cannot be retried');};
const readOnly=()=>{check(posts.length===0&&conversions.length===0,'List recovery sent a mutation request');for(const request of gets){check(!request.options.method||request.options.method==='GET','Recovery used a non-GET request');check(!request.options.body,'Recovery sent a write body');check(request.options.cache==='no-store','Recovery reused a potentially stale cached list');}};
async function click(text){await act(async()=>button(text).click());}
async function edit(selector,value){await act(async()=>{const target=element(selector);const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));});}
async function setup(strict=false){gets=[];posts=[];conversions=[];confirmations=[];renderErrors=[];root=createRoot(element('#root'),{onCaughtError:error=>renderErrors.push(String(error))});const editor=<TestBoundary><Editor signOutPath="/synthetic-signout"/></TestBoundary>;await act(async()=>root.render(strict?<StrictMode>{editor}</StrictMode>:editor));check(gets.length===(strict?2:1),'Mount did not start expected initial list requests: '+gets.length);}
async function unmount(){if(root){await act(async()=>root.unmount());root=null;}}
async function reply(index,articles=[saved],status=200){await rawReply(index,Response.json(status===200?{articles}:{error:'Synthetic list HTTP failure'},{status}));}
async function rawReply(index,response){check(gets[index],'Missing deferred GET '+index);await act(async()=>gets[index].resolve(response));}
async function reject(index,message='Synthetic list network failure'){check(gets[index],'Missing deferred GET '+index);await act(async()=>gets[index].reject(new Error(message)));}
async function newDraft(){await click('＋ 新しい下書き');await edit('input[name="title"]','Unsaved synthetic title');await edit('#markdown-body','# Unsaved synthetic body');await edit('#source-url','https://source.example.test/unsaved');await act(async()=>element('.rights-check input').click());await click('プレビュー');}
const sent=index=>JSON.parse(posts[index].options.body);
async function acknowledge(index=0){const input=sent(index);await act(async()=>posts[index].resolve(Response.json({id:input.id,published:input.published,url:'/p/'+input.id})));}
const tests=[
 ['initial pending list has a live loading status and never looks empty',async()=>{
  busy();check(!document.querySelector('.empty-list'),'Initial pending request looked like an empty library');check(!element('input[name="title"]').disabled&&!element('#markdown-body').disabled,'List-only loading locked the draft');readOnly();await reply(0);healthy();settled();check(list().textContent.includes(saved.title),'Valid list was not rendered');check(!document.querySelector('.empty-list'),'Populated list showed an empty state');
 }],
 ['real empty success alone exposes the empty-library guidance',async()=>{
  check(!document.querySelector('.empty-list'),'Empty guidance appeared before successful GET');await reply(0,[]);healthy();settled();check(element('.empty-list').textContent.includes('新しい下書き'),'Actual empty success lacks a next action');check(!document.querySelector('.sidebar [role="alert"]'),'Successful empty list still reports an error');check([...sidebar().querySelectorAll('button')].every(b=>b.textContent!=='記事一覧を再読み込み'),'Empty success still exposes a failure retry');readOnly();
 }],
 ['network rejection has a persistent sidebar retry and recovers with GET only',async()=>{
  await reject(0);failed();const message=notice();await click('Markdown');failed();check(notice()===message,'Tab switch rewrote the editor notice');await click('記事一覧を再読み込み');check(gets.length===2,'Retry did not start one GET');busy();check(retry().disabled,'Pending retry remains clickable');await reply(1);healthy();settled();check(list().textContent.includes(saved.title),'Retry did not restore records');check(!document.querySelector('.sidebar [role="alert"]'),'Recovered list retains an error');readOnly();
 }],
 ['HTTP rejection does not masquerade as an empty result and permits retry',async()=>{
  await reply(0,[],503);failed();await click('記事一覧を再読み込み');await reply(1,[fresh]);healthy();settled();check(list().textContent.includes(fresh.title),'HTTP failure retry did not restore records');readOnly();
 }],
 ['invalid JSON preserves the editor and recovers without a page reload',async()=>{
  const before=snapshot();await rawReply(0,new Response('{invalid JSON',{status:200,headers:{'Content-Type':'application/json'}}));failed();equal(snapshot(),before,'Invalid JSON altered draft');await click('記事一覧を再読み込み');await reply(1);healthy();settled();equal(snapshot(),before,'Recovery altered draft');readOnly();
 }],
 ['rapid retries and repeated failures stay single-flight without writes',async()=>{
  await reject(0);failed();await act(async()=>{const target=retry();target.click();target.click();target.click();});check(gets.length===2,'Same-tick retries dispatched duplicate GETs');busy();check(retry().disabled,'Retry is enabled while GET is pending');await act(async()=>{retry().click();retry().click();});check(gets.length===2,'Pending retries dispatched duplicate GETs');await reject(1,'Second synthetic list failure');failed();check(gets.length===2,'Failure automatically retried in a request loop');await click('記事一覧を再読み込み');check(gets.length===3,'Second explicit retry unavailable');await reply(2,[],502);failed();await click('記事一覧を再読み込み');await reply(3,[fresh]);settled();check(list().textContent.includes(fresh.title),'Repeated failures blocked eventual recovery');readOnly();
 }],
 ['retry preserves dirty title body source rights tab and unload/navigation guards',async()=>{
  await reject(0);await newDraft();failed();const before=snapshot();const message=notice();check(unloadWarns(),'Edited draft lacks unload warning');await click('記事一覧を再読み込み');busy();equal(snapshot(),before,'Retry start changed edited fields');check(unloadWarns(),'Pending retry cleared dirty state');check(notice()===message,'Retry start replaced the editor notice');check(!element('#source-url').disabled&&!element('.rights-check input').disabled,'List recovery locked draft controls');await reply(1);healthy();settled();equal(snapshot(),before,'Recovered list discarded draft values or tab');check(unloadWarns(),'Recovered list marked unsaved edits clean');check(notice()===message,'Successful retry erased the draft notice');await click('＋ 新しい下書き');equal(snapshot(),before,'Recovery bypassed New dirty guard');await click('Saved list fixture公開中 · 2026-10-09');equal(snapshot(),before,'Recovery bypassed Open dirty guard');check(confirmations.length===2,'Recovery removed navigation confirmations');readOnly();
 }],
 ['a queued edit during retry remains dirty and does not invalidate list recovery',async()=>{
  await reject(0);await newDraft();retry().focus();await click('記事一覧を再読み込み');await edit('#markdown-body','# Newer during list retry');await edit('input[name="title"]','Newer retry title');await click('Markdown');const focused=element('input[name="title"]');focused.focus();const before=snapshot();await reply(1,[fresh]);healthy();settled();equal(snapshot(),before,'Recovery overwrote queued edits');check(document.activeElement===focused,'Recovery stole focus from ongoing editing');check(unloadWarns(),'Recovery cleared newer dirty draft');check(list().textContent.includes(fresh.title),'Draft edits incorrectly discarded current list response');readOnly();
 }],
 ['a successful publication stays acknowledged while its failed list refresh is retried',async()=>{
  await reply(0);await newDraft();await click('公開する');check(posts.length===1,'Publication did not start');await acknowledge();check(gets.length===2,'Acknowledged save did not refresh list');busy();await reply(1,[],503);failed();check(!unloadWarns(),'Confirmed publication became dirty');check(element('.document-status').textContent==='公開中','List failure hid confirmed publication');check(element('#share-url').value.endsWith('/p/'+sent(0).id),'List failure lost confirmed share URL');check(notice().includes('公開しました。'),'List failure erased save acknowledgement');const before=snapshot();await click('記事一覧を再読み込み');busy();equal(snapshot(),before,'Retry changed acknowledged publication');check(notice().includes('公開しました。'),'Pending retry erased save acknowledgement');await reply(2,[fresh]);settled();equal(snapshot(),before,'Successful recovery changed acknowledged publication');check(notice().includes('公開しました。'),'Successful recovery erased save acknowledgement');check(!unloadWarns(),'GET recovery marked confirmed save dirty');check(posts.length===1&&conversions.length===0,'Recovering the list repeated publication or conversion');
 }],
 ['newer changes and publication acknowledgement both survive recovery after a list failure',async()=>{
  await reply(0);await newDraft();await click('公開する');await acknowledge();await edit('#markdown-body','# Newer than acknowledged publication');await rawReply(1,new Response('{invalid JSON',{status:200}));failed();const before=snapshot();check(unloadWarns(),'Newer draft was falsely marked saved');check(notice().includes('公開しました。')&&notice().includes('まだ保存されていません'),'Failed refresh lost save/newer-edit status');await click('記事一覧を再読み込み');await reply(2,[fresh]);settled();equal(snapshot(),before,'Retry changed newer draft or confirmed publication');check(unloadWarns(),'GET retry cleared newer dirty edits');check(notice().includes('公開しました。')&&notice().includes('まだ保存されていません'),'GET retry erased acknowledgement or newer-edit notice');check(posts.length===1,'GET retry sent another save');
 }],
 ['manual recovery after a failed save refresh retains old rows and clears obsolete failure guidance',async()=>{
  await reply(0);await newDraft();await click('下書き保存');await acknowledge();busy();check(list().textContent.includes(saved.title),'Pending save refresh discarded prior rows');await rawReply(1,Response.json({articles:[fresh,{...saved,title:null}]}));failed();check(list().textContent.includes(saved.title),'Malformed refresh discarded last successful rows');check(!list().textContent.includes(fresh.title),'Malformed refresh partially committed rows');const before=snapshot();check(!unloadWarns(),'Malformed refresh dirtied confirmed save');check(notice().includes('下書きに保存しました。'),'Malformed refresh lost save acknowledgement');retry().focus();await click('記事一覧を再読み込み');busy();check(list().textContent.includes(saved.title),'Manual retry discarded prior rows');await reply(2,[fresh]);healthy();settled();equal(snapshot(),before,'Manual recovery changed confirmed save');check(document.activeElement===list(),'Successful keyboard retry left focus on a removed retry button');check(list().textContent.includes(fresh.title)&&!list().textContent.includes(saved.title),'Manual recovery did not replace old rows');check(!/読み込めません|失敗|再読み込みしてください/.test(sidebar().textContent),'Recovered sidebar still reports failure');check(!/失敗|再読み込みしてください|ページを再読み込み/.test(notice()),'Recovered save acknowledgement retains obsolete failure guidance');check(notice().includes('下書きに保存しました。'),'Manual recovery erased confirmed save');check(!unloadWarns()&&posts.length===1&&conversions.length===0,'Manual recovery changed save state or repeated a write');
 }],
 ['a save rejection is preserved independently from list failure and recovery',async()=>{
  await newDraft();await click('下書き保存');await act(async()=>posts[0].resolve(Response.json({error:'Synthetic save rejection'},{status:400})));check(notice()==='Synthetic save rejection','Save rejection missing');await reject(0);failed();check(notice()==='Synthetic save rejection','List failure replaced save rejection');const before=snapshot();await click('記事一覧を再読み込み');await reply(1);settled();equal(snapshot(),before,'List recovery changed rejected draft');check(notice()==='Synthetic save rejection','List recovery erased save rejection');check(unloadWarns(),'List recovery cleared rejected draft dirty state');check(posts.length===1,'GET retry repeated failed save');
 }],
 ['initial response cannot replace the later acknowledged-save refresh',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();check(gets.length===2,'Save did not start a newer list request');const input=sent(0);await reply(1,[{...fresh,id:input.id,title:'Newest acknowledged article'}]);const message=notice();await reply(0,[{...saved,title:'Stale initial article'}]);healthy();settled();check(list().textContent.includes('Newest acknowledged article')&&!list().textContent.includes('Stale initial article'),'Stale initial GET replaced saved records');check(notice()===message,'Stale initial GET changed save acknowledgement');check(!unloadWarns(),'Stale initial GET dirtied the confirmed draft');
 }],
 ['initial failure arriving after save refresh cannot create a stale list error',async()=>{
  await newDraft();await click('下書き保存');await acknowledge();await reply(1,[fresh]);const message=notice();await reject(0,'Obsolete initial failure');healthy();settled();check(list().textContent.includes(fresh.title),'Obsolete initial failure discarded fresh list');check(!document.querySelector('.sidebar [role="alert"]'),'Obsolete initial failure reached sidebar');check(notice()===message,'Obsolete initial failure changed acknowledgement');
 }],
 ['retry remains disabled during a save and its acknowledgement refresh',async()=>{
  await reject(0);await newDraft();await click('下書き保存');check(posts.length===1,'Save did not start');check(retry().disabled,'Retry is enabled during save POST');await act(async()=>retry().click());check(gets.length===1,'Disabled retry sent a GET during save');await acknowledge();check(gets.length===2,'Acknowledged save did not start refresh');busy();check(retry().disabled,'Retry is enabled during save refresh');await act(async()=>retry().click());check(gets.length===2,'Disabled retry raced save refresh');await reject(1);failed();check(!element('#source-url').disabled,'Failed refresh kept save locked');check(!unloadWarns(),'Failed refresh removed confirmed clean state');check(notice().includes('下書きに保存しました。'),'Failed refresh lost confirmed save');
 }],
 ['an older retry cannot overwrite or unlock an acknowledged save refresh',async()=>{
  await reject(0);await newDraft();await click('記事一覧を再読み込み');check(gets.length===2,'Retry missing');await click('下書き保存');check(posts.length===1,'List-only retry prevented save');await acknowledge();check(gets.length===3,'Save acknowledgement failed to supersede retry');busy();const before=snapshot();await reply(1,[{...saved,title:'Stale retry article'}]);healthy();busy();equal(snapshot(),before,'Old retry changed current draft');check(element('#source-url').disabled,'Old retry unlocked save refresh');check(!list().textContent.includes('Stale retry article'),'Stale retry replaced newer list');await reply(2,[fresh]);settled();check(list().textContent.includes(fresh.title),'Save refresh did not win precedence');check(!element('#source-url').disabled&&!unloadWarns(),'Newest save refresh did not settle independently');
 }],
 ['late retry failure cannot replace records or status from a newer save refresh',async()=>{
  await reject(0);await newDraft();await click('記事一覧を再読み込み');await click('下書き保存');await acknowledge();await reply(2,[fresh]);const before=snapshot(),message=notice();await reject(1,'Obsolete retry failure');healthy();settled();equal(snapshot(),before,'Obsolete retry failure changed document');check(list().textContent.includes(fresh.title),'Obsolete retry failure discarded fresh list');check(!document.querySelector('.sidebar [role="alert"]'),'Obsolete retry failure restored stale error');check(notice()===message,'Obsolete retry failure replaced save status');check(!unloadWarns(),'Obsolete retry failure dirtied confirmed save');
 }],
 ['a failed save does not suppress the already pending valid retry',async()=>{
  await reject(0);await newDraft();await click('記事一覧を再読み込み');await click('下書き保存');await act(async()=>posts[0].resolve(Response.json({error:'Synthetic save rejection'},{status:400})));await reply(1,[fresh]);healthy();settled();check(list().textContent.includes(fresh.title),'Failed save invalidated valid pending retry');check(notice()==='Synthetic save rejection','Retry hid failed save status');check(unloadWarns(),'Retry cleared rejected draft dirty state');
 }],
 ['same-tick retry and save clicks cannot start duplicate reads or writes',async()=>{
  await reject(0);await newDraft();await act(async()=>{const target=retry();target.click();button('下書き保存').click();target.click();});check(gets.length===2&&posts.length===1,'Same-tick retry/save dispatched duplicate requests');await acknowledge();check(gets.length===3,'Save refresh did not supersede pending retry');await reply(2,[fresh]);await reply(1,[saved]);healthy();settled();check(list().textContent.includes(fresh.title),'Same-tick obsolete retry replaced save refresh');check(!unloadWarns(),'Same-tick save did not stay acknowledged');
 }],
 ['unmount invalidates initial load before stale article records are consumed',async()=>{
  const old=gets[0];await unmount();await setup();await newDraft();const before=snapshot();let staleReads=0;const data={get articles(){staleReads++;return [{...saved,title:'Unmounted initial article'}];}};await act(async()=>old.resolve({ok:true,json:async()=>data}));check(staleReads===0,'Unmounted initial load consumed stale records');healthy();busy();equal(snapshot(),before,'Unmounted initial load changed new editor');check(gets.length===1,'Old load started a request in new editor');await reply(0,[fresh]);settled();check(list().textContent.includes(fresh.title),'New editor load failed to settle');check(unloadWarns(),'Old load cleared new editor dirty state');
 }],
 ['unmount during retry ignores late success and does not unlock a new save',async()=>{
  await reject(0);await click('記事一覧を再読み込み');const old=gets[1];await unmount();await setup();await newDraft();await click('下書き保存');const before=snapshot();let staleReads=0;const data={get articles(){staleReads++;return [{...saved,title:'Unmounted retry article'}];}};await act(async()=>old.resolve({ok:true,json:async()=>data}));check(staleReads===0,'Unmounted retry consumed stale records');healthy();equal(snapshot(),before,'Unmounted retry changed new editor');check(element('#source-url').disabled,'Old retry unlocked a new save');check(gets.length===1,'Old retry started new editor requests');await acknowledge();await reply(1,[fresh]);settled();check(!element('#source-url').disabled&&!unloadWarns(),'New editor save did not settle independently');
 }],
 ['unmounted retry failure never reaches a replacement editor',async()=>{
  await reject(0);await click('記事一覧を再読み込み');const old=gets[1];await unmount();await setup();await reply(0,[fresh]);await newDraft();const before=snapshot(),message=notice();await act(async()=>old.reject(new Error('Unmounted retry failure')));healthy();settled();equal(snapshot(),before,'Unmounted retry failure changed new editor');check(notice()===message,'Unmounted retry failure replaced new message');check(!sidebar().textContent.includes('Unmounted retry failure'),'Unmounted failure reached new sidebar');check(!document.querySelector('.sidebar [role="alert"]'),'Unmounted failure created new error');check(unloadWarns(),'Unmounted failure cleared new dirty draft');
 }],
 ['StrictMode replay ignores the first effect response and settles the current list independently',async()=>{
  busy();await newDraft();const before=snapshot();let staleReads=0;const stale={get articles(){staleReads++;return [{...saved,title:'StrictMode obsolete article'}];}};await rawReply(0,{ok:true,json:async()=>stale});check(staleReads===0,'Replayed effect consumed obsolete article records');healthy();busy();equal(snapshot(),before,'Replayed effect changed unsaved draft');check(!list().textContent.includes('StrictMode obsolete article'),'Replayed effect committed obsolete rows');await reply(1,[fresh]);healthy();settled();check(list().textContent.includes(fresh.title),'Current StrictMode load failed to populate');equal(snapshot(),before,'Current StrictMode load discarded edited draft');check(unloadWarns(),'StrictMode replay cleared dirty state');readOnly();
 },true],
 ['StrictMode replay ignores an old failure after current failure and successful manual recovery',async()=>{
  await reject(1,'Current StrictMode list failure');failed();await newDraft();const before=snapshot(),message=notice();await act(async()=>{const target=retry();target.click();target.click();});check(gets.length===3,'StrictMode manual retry duplicated a GET');busy();await reply(2,[fresh]);healthy();settled();await reject(0,'Obsolete StrictMode effect failure');healthy();settled();check(list().textContent.includes(fresh.title),'Old StrictMode failure discarded recovered records');check(!document.querySelector('.sidebar [role="alert"]'),'Old StrictMode failure resurrected sidebar error');equal(snapshot(),before,'StrictMode recovery changed dirty fields');check(notice()===message,'Old StrictMode failure changed draft status');check(unloadWarns(),'StrictMode recovery cleared dirty state');readOnly();
 },true]
];
const malformed=[
 ['null response',null],['array response',[]],['missing article array',{}],['null articles',{articles:null}],['object articles',{articles:{}}],['string articles',{articles:'not an article array'}],
 ['null record',{articles:[null]}],['primitive record',{articles:[42]}],['array record',{articles:[[]]}],['missing record fields',{articles:[{id:'synthetic-incomplete'}]}],
 ['invalid id',{articles:[{...saved,id:null}]}],['invalid title',{articles:[{...saved,title:{bad:true}}]}],['invalid source URL',{articles:[{...saved,source_url:[]}]}],['invalid Markdown',{articles:[{...saved,markdown:null}]}],
 ['invalid publication state',{articles:[{...saved,published:2}]}],['invalid created timestamp',{articles:[{...saved,created_at:null}]}],['invalid updated timestamp',{articles:[{...saved,updated_at:{bad:true}}]}],['invalid publication timestamp',{articles:[{...saved,published_at:42}]}],
 ['mixed valid and invalid records',{articles:[saved,{...fresh,title:null}]}],['duplicate article IDs',{articles:[saved,{...fresh,id:saved.id}]}]
];
for(const [name,payload] of malformed)tests.push(['malformed '+name+' fails safely and permits a valid retry',async()=>{
 await newDraft();const before=snapshot(),message=notice();await rawReply(0,Response.json(payload));failed();equal(snapshot(),before,'Malformed list changed unsaved draft');check(unloadWarns(),'Malformed list cleared dirty state');check(notice()===message,'Malformed list replaced unrelated editor notice');check(list().querySelectorAll('.draft-row').length===0,'Malformed list partially committed records');await click('記事一覧を再読み込み');await reply(1,[saved,fresh]);healthy();settled();equal(snapshot(),before,'Malformed-response recovery changed draft');check(list().querySelectorAll('.draft-row').length===2,'Valid retry after malformed response did not restore both records');check(unloadWarns(),'Malformed-response recovery cleared dirty state');readOnly();
}]);
const results=[];
async function run(){for(const [name,operation,strict] of tests){try{await setup(Boolean(strict));await operation();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}finally{await unmount();}}document.querySelector('#result').textContent=JSON.stringify({results,total:tests.length});}
window.editorListTestDone=run().catch(error=>{document.querySelector('#result').textContent=JSON.stringify({fatal:error.stack||String(error),results,total:tests.length});});
`;

test('actual Editor article-list recovery preserves drafts and response precedence with synthetic replies',{timeout:20000},async t=>{
 mkdirSync('.sites-runtime',{recursive:true});
 const output=join(process.cwd(),'.sites-runtime/editor-list-test.mjs');
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output});
 const window=new Window({url:'https://reader.example.test'});
 window.document.body.innerHTML='<div id="root"></div><pre id="result">running</pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,fetch:(...args)=>window.fetch(...args)};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  await import(pathToFileURL(output).href);await window.editorListTestDone;
  const report=JSON.parse(window.document.querySelector('#result').textContent);
  assert.ok(!report.fatal,report.fatal);
  assert.equal(report.total,44,'Unexpected article-list coverage count');
  assert.equal(report.results.length,report.total,'Incomplete article-list coverage');
  for(const result of report.results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
 }finally{
  await window.happyDOM.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
