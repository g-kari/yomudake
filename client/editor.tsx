'use client';
import {useEffect,useRef,useState} from 'react';
import {EDITOR_SAVE_PROTOCOL,editorRevision} from '../src/editor-save.mjs';
import {confirmEditorSaveCapability} from './editor-save';
const Link=({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>;
type ApiReply={code?:string;protocol?:string;revision?:string;error?:string;articles?:Article[];url?:string;id?:string;published?:boolean;markdown?:string;sourceUrl?:string;title?:string};
import {Markdown} from '../src/markdown';
import {sample} from '../src/sample';
import {articleLink} from '../src/navigation.mjs';
import {ARTICLE_PAGE_SIZE,decodeArticleCursor,encodeArticleCursor,normalizeArticleQuery} from '../src/article-pages.mjs';
import {ExternalWarning,type PendingLink} from './external-warning';
import {downloadMarkdownBody} from './local-markdown';
type Article={id:string;title:string;source_url:string;markdown:string;published:number;created_at:string;updated_at:string;published_at:string|null};
type PageTarget={cursor:string|null;history:(string|null)[];query:string};
const LIST_TIMEOUT_MS=15_000;
const CONVERSION_TIMEOUT_MS=60_000;
const firstPage=(query=''):PageTarget=>({cursor:null,history:[null],query});
function readArticlePage(raw:Record<string,unknown>,query=''){
 if(query?(raw.query!==query||!Object.hasOwn(raw,'nextCursor')):raw.query!==undefined&&raw.query!=='')throw new Error('Article search context unavailable');
 const records=raw.articles;
 if(!Array.isArray(records)||records.length>ARTICLE_PAGE_SIZE||!records.every(isArticle)||new Set(records.map(a=>a.id)).size!==records.length)throw new Error('Article list unavailable');
 // A bare list remains compatible with the previous API during deployment.
 const cursor=raw.nextCursor===undefined?null:raw.nextCursor;
 if(Object.hasOwn(raw,'nextCursor')&&records.some((article,index)=>index>0&&(article.updated_at>records[index-1].updated_at||(article.updated_at===records[index-1].updated_at&&article.id>=records[index-1].id))))throw new Error('Article list order unavailable');
 if(cursor!==null){
  if(typeof cursor!=='string'||records.length!==ARTICLE_PAGE_SIZE)throw new Error('Article list unavailable');
  decodeArticleCursor(cursor,query);
  if(encodeArticleCursor(records[records.length-1],query)!==cursor)throw new Error('Article list unavailable');
 }
 return {records,nextCursor:cursor as string|null};
}
function isArticle(value:unknown):value is Article{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const article=value as Record<string,unknown>;
 return typeof article.id==='string'&&article.id.length>0&&typeof article.title==='string'&&typeof article.source_url==='string'&&typeof article.markdown==='string'&&(article.published===0||article.published===1)&&typeof article.created_at==='string'&&typeof article.updated_at==='string'&&(article.published_at===null||typeof article.published_at==='string');
}
export default function Editor({signOutPath}:{signOutPath:string}) {
 const [articles,setArticles]=useState<Article[]>([]),[id,setId]=useState(''),[title,setTitle]=useState(sample.title),[markdown,setMarkdown]=useState(sample.markdown),[sourceUrl,setSourceUrl]=useState('');
 const [listPending,setListPending]=useState(true),[listLoaded,setListLoaded]=useState(false),[listError,setListError]=useState('');
 const [searchInput,setSearchInput]=useState(''),[listQuery,setListQuery]=useState(''),[searchError,setSearchError]=useState('');
 const [pageHistory,setPageHistory]=useState<(string|null)[]>([null]),[nextCursor,setNextCursor]=useState<string|null>(null),[selectedMeta,setSelectedMeta]=useState<{id:string;created_at:string}|null>(null);
 const [dirty,setDirty]=useState(false);
 const [exportMessage,setExportMessage]=useState('');
 const currentMarkdown=useRef(sample.markdown);
 function updateMarkdown(value:string){currentMarkdown.current=value;setMarkdown(value);}
 const [pendingLink,setPendingLink]=useState<PendingLink|null>(null);
 const [tab,setTab]=useState<'edit'|'preview'>('preview'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[rights,setRights]=useState(false),[published,setPublished]=useState(false),[shareUrl,setShareUrl]=useState('');
 const savedRevision=useRef<Article|string|null>(null);
 const draftVersion=useRef(0),rightsVersion=useRef<number|null>(null),listVersion=useRef(0),conversion=useRef<{controller:AbortController;version:number}|null>(null),saving=useRef<{version:number}|null>(null);
 const renderedDraftVersion=draftVersion.current;
 const mounted=useRef(false),listRequest=useRef<{version:number;controller:AbortController;target:PageTarget}|null>(null),listElement=useRef<HTMLElement|null>(null);
 const searchInputValue=useRef(''),requestedPage=useRef<PageTarget>(firstPage());
 const failedPage=useRef<PageTarget|null>(null);
 function draftChanged(){
  draftVersion.current++;
  rightsVersion.current=null;setRights(false);
  const pending=conversion.current;
  if(pending){conversion.current=null;pending.controller.abort();setBusy(false);}
 }
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;draftVersion.current++;listVersion.current++;conversion.current?.controller.abort();conversion.current=null;saving.current=null;listRequest.current?.controller.abort();listRequest.current=null;};},[]);
 async function load(active:()=>boolean,target:PageTarget=firstPage()){
  listRequest.current?.controller.abort();
  const version=++listVersion.current;
  const controller=new AbortController();
  const pending={version,controller,target};listRequest.current=pending;requestedPage.current=target;setListPending(true);
  let timeout:number|undefined;
  const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Article list unavailable')),{once:true}));
  timeout=window.setTimeout(()=>controller.abort(),LIST_TIMEOUT_MS);
  const isCurrent=()=>mounted.current&&active()&&version===listVersion.current;
  try{
   const parameters=new URLSearchParams();if(target.cursor)parameters.set('cursor',target.cursor);if(target.query)parameters.set('q',target.query);
   const path=parameters.size?`/api/articles?${parameters}`:'/api/articles';
   // The deadline covers headers and JSON, even when a transport ignores abort.
   const {r,raw}=await Promise.race([(async()=>{const r=await fetch(path,{cache:'no-store',signal:controller.signal});const raw:unknown=await r.json();return {r,raw};})(),aborted]);
   if(!isCurrent())return false;
   if(!r.ok||!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Article list unavailable');
   const page=readArticlePage(raw as Record<string,unknown>,target.query);
   if(target.cursor){
    const position=decodeArticleCursor(target.cursor,target.query);
    if(page.records.some(article=>article.updated_at>position.updatedAt||(article.updated_at===position.updatedAt&&article.id>=position.id)))throw new Error('Article page boundary unavailable');
   }
   if(page.nextCursor&&target.history.includes(page.nextCursor))throw new Error('Article page did not advance');
   setArticles(page.records);setNextCursor(page.nextCursor);setPageHistory(target.history);setListQuery(target.query);setListLoaded(true);setListError('');failedPage.current=null;return true;
  }catch(e){if(isCurrent()){failedPage.current=target;setListError(target.query?`「${target.query}」の検索結果を読み込めませんでした。直前の一覧と編集中の内容は残っています。`:'記事一覧を読み込めませんでした。編集中の内容は残っています。');throw e;}}
  finally{window.clearTimeout(timeout);if(isCurrent()&&listRequest.current===pending){listRequest.current=null;setListPending(false);}}
 }
 useEffect(()=>{let active=true;load(()=>active).catch(()=>{});return ()=>{active=false;};},[]);
 useEffect(()=>{if(listElement.current){listElement.current.scrollTop=0;listElement.current.scrollLeft=0;}},[articles]);
 useEffect(()=>{const selected=articles.find(a=>a.id===id);if(selected)setSelectedMeta({id:selected.id,created_at:selected.created_at});},[articles,id]);
 async function retryList(trigger:HTMLButtonElement){
  if(!mounted.current||listRequest.current||saving.current||conversion.current)return;
  const restoreFocus=document.activeElement===trigger,version=listVersion.current+1;
  const succeeded=await load(()=>mounted.current,failedPage.current||firstPage(requestedPage.current.query)).catch(()=>false);
  if(succeeded&&mounted.current&&version===listVersion.current&&restoreFocus&&(document.activeElement===trigger||document.activeElement===document.body))listElement.current?.focus();
 }
 async function changePage(target:PageTarget,trigger:HTMLButtonElement){
  if(!mounted.current||listRequest.current||saving.current||conversion.current)return;
  const restoreFocus=document.activeElement===trigger,version=listVersion.current+1;
  const succeeded=await load(()=>mounted.current,target).catch(()=>false);
  if(succeeded&&mounted.current&&version===listVersion.current&&restoreFocus&&(document.activeElement===trigger||document.activeElement===document.body))listElement.current?.focus();
 }
 async function searchArticles(value:string,trigger:Element|null){
  if(!mounted.current||saving.current||conversion.current)return;
  let query:string;try{query=normalizeArticleQuery(value);}catch{setSearchError('検索は100文字以内で入力してください。');return;}
  setSearchError('');
  // Submitting a different query may replace a pending GET, never a save.
  if(listRequest.current?.target.query===query&&listRequest.current.target.cursor===null)return;
  const restoreFocus=trigger?.tagName==='BUTTON'&&document.activeElement===trigger,version=listVersion.current+1;
  const succeeded=await load(()=>mounted.current,firstPage(query)).catch(()=>false);
  if(succeeded&&mounted.current&&version===listVersion.current&&restoreFocus&&(document.activeElement===trigger||document.activeElement===document.body))listElement.current?.focus();
 }
 useEffect(()=>{function warn(e:BeforeUnloadEvent){if(dirty){e.preventDefault();e.returnValue='';}}window.addEventListener('beforeunload',warn);return ()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 function mayLeave(){return !dirty||window.confirm('保存していない変更があります。破棄して記事を切り替えますか？');}
 function createNew(){if(saving.current||!mayLeave())return;savedRevision.current=null;setPendingLink(null);draftChanged();setDirty(false);setId('');setSelectedMeta(null);setTitle('');updateMarkdown('');setSourceUrl('');setRights(false);setPublished(false);setShareUrl('');setMessage('新しい下書きです。');setTab('edit');}
 function openArticle(a:Article){if(saving.current||!mayLeave())return;savedRevision.current=a;setPendingLink(null);draftChanged();setDirty(false);setId(a.id);setSelectedMeta({id:a.id,created_at:a.created_at});setTitle(a.title);updateMarkdown(a.markdown);setSourceUrl(a.source_url);setRights(false);setPublished(Boolean(a.published));setShareUrl(a.published?`${window.location.origin}/p/${a.id}`:'');setMessage('');setTab('preview');}
 async function save(makePublic:boolean){
  if(busy||saving.current||conversion.current)return;
  // A queued edit must invalidate confirmation before React rerenders. Also
  // reject handlers whose rendered payload predates an edit or a new check.
  if(makePublic&&(!rights||rightsVersion.current!==draftVersion.current||renderedDraftVersion!==draftVersion.current)){setMessage('本文・出典・ライセンスを確認し、公開確認にチェックしてください。');return;}
  // Keep mutation requests single-flight through list refresh. Newer queued edits
  // invalidate only the clean-state acknowledgement, not the server-side write.
  const baseline=savedRevision.current;
  const pending={version:draftVersion.current};saving.current=pending;
  const active=()=>saving.current===pending;
  setBusy(true);setMessage('');
  const articleId=id||crypto.randomUUID();setId(articleId);
  const savedMessage=()=>`${makePublic?'公開しました。共有URLから、サインインなしで読めます。':'下書きに保存しました。公開ページには表示されません。'}${draftVersion.current!==pending.version?' 編集中の変更はまだ保存されていません。もう一度保存してください。':''}`;
  try {
   await confirmEditorSaveCapability();
   if(!active())return;
   const expectedRevision=typeof baseline==='string'?baseline:baseline?await editorRevision(baseline):null;
   if(!active())return;
   const r=await fetch('/api/editor/articles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:EDITOR_SAVE_PROTOCOL,expectedRevision,id:articleId,title,markdown,sourceUrl,published:makePublic,rightsConfirmed:rights})});const raw:unknown=await r.json();
   if(!active())return;
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('保存結果を確認できませんでした。本文は残っています。');
   const data=raw as ApiReply;
   if(!r.ok){
    // Refresh only the sidebar after a conflict. Never replace the draft or
    // advance its baseline; opening the latest row still confirms discard.
    if(r.status===409&&data.code==='EDITOR_CONFLICT')await load(active,firstPage(requestedPage.current.query)).catch(()=>false);
    if(!active())return;
    throw new Error(typeof data.error==='string'?data.error:'保存できませんでした。本文は残っています。');
   }
   if(data.protocol!==EDITOR_SAVE_PROTOCOL||typeof data.revision!=='string'||!/^[0-9a-f]{64}$/.test(data.revision)||data.id!==articleId||data.published!==makePublic||data.url!==`/p/${articleId}`)throw new Error('保存結果を確認できませんでした。本文は残っています。');
   savedRevision.current=data.revision;
   if(draftVersion.current===pending.version)setDirty(false);
   setPublished(makePublic);setShareUrl(makePublic?`${window.location.origin}${data.url}`:'');setMessage(savedMessage());
   try{await load(active,firstPage(requestedPage.current.query));if(active())setMessage(savedMessage());}
   catch{if(active())setMessage(`${savedMessage()} 記事一覧の状態は一覧欄で確認できます。`);}
  }catch(e){if(active())setMessage(e instanceof Error?e.message:'保存できませんでした。本文は残っています。');}
  finally{if(active()){saving.current=null;setBusy(false);}}
 }
 async function convert(){
  if(busy||saving.current||conversion.current||!sourceUrl)return;
  const version=draftVersion.current;
  if(dirty&&(title.length||markdown.length)&&!window.confirm('保存していない変更があります。変換すると現在のタイトルと本文を置き換えます。続けますか？'))return;
  if(version!==draftVersion.current)return;
  const pending={controller:new AbortController(),version};conversion.current=pending;
  const isCurrent=()=>conversion.current===pending&&draftVersion.current===version;
  setBusy(true);setMessage('');
  let timeout:number|undefined,onAbort=()=>{};
  const aborted=new Promise<never>((_,reject)=>{
   onAbort=()=>{window.clearTimeout(timeout);reject(new Error('変換の応答を60秒以内に確認できませんでした。入力は残っています。時間を置いて再試行するか、本文を直接編集してください。'));};
   pending.controller.signal.addEventListener('abort',onAbort,{once:true});
  });
  timeout=window.setTimeout(()=>pending.controller.abort(),CONVERSION_TIMEOUT_MS);
  try{
   // Bound headers and JSON even if transport cancellation is ignored.
   const {r,raw}=await Promise.race([(async()=>{
    const r=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:sourceUrl}),signal:pending.controller.signal});
    const raw:unknown=await r.json();return {r,raw};
   })(),aborted]);
   if(!isCurrent())return;
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('変換結果を読み込めませんでした。本文は残っています。');
   const data=raw as ApiReply;
   if(!r.ok)throw new Error(typeof data.error==='string'?data.error:'変換できませんでした。');
   if(typeof data.markdown!=='string'||('title' in data&&typeof data.title!=='string')||('sourceUrl' in data&&typeof data.sourceUrl!=='string'))throw new Error('変換結果を読み込めませんでした。本文は残っています。');
   draftVersion.current++;updateMarkdown(data.markdown);setTitle(data.title||'変換した記事');setSourceUrl(data.sourceUrl||sourceUrl);setDirty(true);setRights(false);setTab('preview');setMessage('Markdownに変換しました。本文・出典・ライセンスを確認してから公開してください。');
  }catch(e){if(isCurrent())setMessage(e instanceof Error?e.message:'変換できませんでした。');}
  finally{window.clearTimeout(timeout);pending.controller.signal.removeEventListener('abort',onAbort);if(conversion.current===pending){conversion.current=null;setBusy(false);}}
 }
 async function copyUrl(){try{await navigator.clipboard.writeText(shareUrl);setMessage('共有URLをコピーしました。');}catch{setMessage('コピーできませんでした。表示されたURLを選択してコピーしてください。');}}
 function exportBody(){
  const body=currentMarkdown.current;if(!body.length)return;
  try{downloadMarkdownBody(body);setExportMessage('本文の書き出しを開始しました。端末側でファイルの保存を確認してください。この操作ではサーバーへ保存・公開しません。保存中の処理の結果を示すものではありません。');}
  catch{setExportMessage('本文を書き出せませんでした。本文はこの画面に残っています。');}
 }
 const selectedArticle=articles.find(a=>a.id===id)||(selectedMeta?.id===id?selectedMeta:null);
 const origin=window.location.origin;
 const sourceLink=articleLink(sourceUrl,origin);
 const externalLink=(href:string,label:string,key?:number)=><button key={key} type="button" className="external-link" onClick={e=>setPendingLink({href,trigger:e.currentTarget})}>{label}</button>;
 return <main className="workspace">
  <a className="skip-link" href="#editor-page">本文へ移動</a>
  <header className="editor-top">
   <Link className="brand" href="/">よむだけ</Link>
   <p>気になるページを、読みやすいノートに。</p>
   <span className="private-badge">本人専用</span>
  </header>
  <section className="conversion-panel" aria-labelledby="conversion-label">
   <label id="conversion-label" htmlFor="source-url" className="sr-only">元URL</label>
   <div className="url-row">
    <input disabled={busy} id="source-url" name="sourceUrl" spellCheck={false} type="url" placeholder="https://example.com/article" value={sourceUrl} onChange={e=>{draftChanged();setSourceUrl(e.target.value);setDirty(true);}} maxLength={2048} autoComplete="off" aria-describedby="source-guidance"/>
    <button className="button" onClick={convert} disabled={busy||!sourceUrl}>{busy?'処理中…':'URLから変換'}</button>
   </div>
   <p id="source-guidance">一般の公開HTTPSの記事を取得します。ログイン用・非公開・トークン付きURLは入力しないでください。</p>
  </section>
  <aside className="sidebar" aria-label="記事の一覧">
   <div className="sidebar-heading"><h1>記事</h1><button className="new-button" onClick={createNew} disabled={busy}>＋ 新しい下書き</button></div>
   <form className="article-search" role="search" aria-label="保存記事の検索" onSubmit={e=>{e.preventDefault();searchArticles(searchInputValue.current,document.activeElement);}}>
    <label htmlFor="article-search">保存記事を探す</label>
    <input id="article-search" name="q" type="search" value={searchInput} maxLength={100} disabled={busy} placeholder="タイトル・元URL" autoComplete="off" aria-describedby="article-search-guidance" onChange={e=>{searchInputValue.current=e.target.value;setSearchInput(e.target.value);setSearchError('');}}/>
    <div className="search-actions"><button className="secondary-button" type="submit" disabled={busy}>検索</button><button className="secondary-button" type="button" disabled={busy||(!searchInput&&!requestedPage.current.query&&!listQuery)} onClick={e=>{searchInputValue.current='';setSearchInput('');searchArticles('',e.currentTarget);}}>検索を解除</button></div>
    <p id="article-search-guidance">すべての保存記事のタイトル・元URLを部分一致で探します。入力だけでは検索しません。</p>
    {searchError&&<p className="search-feedback" role="alert">{searchError}</p>}
   </form>
   {listPending&&<p className="list-feedback" role="status">記事一覧を読み込んでいます…</p>}
   {listError&&<div className="list-feedback list-error" role="alert"><p>{listError}</p><button className="secondary-button" type="button" onClick={e=>retryList(e.currentTarget)} disabled={listPending||busy}>記事一覧を再読み込み</button></div>}
   {listLoaded&&<p className="search-status" role="status" aria-live="polite">{listQuery?`検索結果:「${listQuery}」`:'保存したすべての記事'}</p>}
   <nav className="draft-list" aria-label="保存した記事" aria-busy={listPending} tabIndex={-1} ref={listElement}>
    {articles.length?articles.map(a=><button key={a.id} className={`draft-row ${id===a.id?'selected':''}`} aria-current={id===a.id?'true':undefined} onClick={()=>openArticle(a)} disabled={busy}>
     <span className={`status-dot ${a.published?'live':''}`} aria-hidden="true"/>
     <span>{a.title}<small>{a.published?'公開中':'下書き'} · {a.updated_at.slice(0,10)}</small></span>
    </button>):listLoaded&&!listPending&&!listError?<p className="empty-list">{listQuery?'一致する保存記事はありません。別の言葉で検索するか、検索を解除してください。':pageHistory.length===1?'保存した記事はここに並びます。新しい下書きから始められます。':'このページの記事はありません。「新しい記事のページ」で戻れます。'}</p>:null}
   </nav>
   {listLoaded&&<div className="list-pagination" role="group" aria-label="記事一覧のページ切替">
    <p className="page-summary" role="status" aria-live="polite">{pageHistory.length}ページ目 · {articles.length}件{listPending?' · 読み込み中':''}</p>
    <div className="page-actions">
     <button className="secondary-button" type="button" disabled={listPending||busy||pageHistory.length===1} onClick={e=>{const history=pageHistory.slice(0,-1);changePage({cursor:history[history.length-1],history,query:listQuery},e.currentTarget);}}>新しい記事のページ</button>
     <button className="secondary-button" type="button" disabled={listPending||busy||!nextCursor} onClick={e=>{if(nextCursor)changePage({cursor:nextCursor,history:[...pageHistory,nextCursor],query:listQuery},e.currentTarget);}}>以前の記事のページ</button>
    </div>
    {id&&!articles.some(a=>a.id===id)&&<p className="page-selection">選択中の記事はこのページにありません。編集中の内容はそのままです。</p>}
   </div>}
   <div className="sidebar-footer"><a href="/" target="_blank" rel="noopener noreferrer">公開ページを開く ↗</a><a href={signOutPath} target="_top">サインアウト</a></div>
  </aside>
  <section id="editor-page" className="editor-main" aria-label="記事の編集" tabIndex={-1}>
   <section className="editor-shell">
    <div className="document-toolbar">
     <label className="title-label"><span className="sr-only">記事タイトル</span><input disabled={busy} name="title" autoComplete="off" value={title} onChange={e=>{draftChanged();setTitle(e.target.value);setDirty(true);}} placeholder="記事のタイトル" maxLength={160}/></label>
     <span className={`document-status ${published?'is-public':''}`}>{published?'公開中':'下書き'}</span>
    </div>
    <div className="document-meta">
     <span className="document-source">{sourceLink?<>出典・元の記事 {sourceLink.external?externalLink(sourceLink.href,sourceLink.href):<a href={sourceLink.href}>{sourceLink.href}</a>}</>:sourceUrl?'元URLを確認してください':'このサイトで作成した本文'}</span>
     {selectedArticle&&<span>作成 {selectedArticle.created_at.slice(0,10)} UTC</span>}
    </div>
    <div className="tab-bar" aria-label="記事の表示">
     <button aria-pressed={tab==='edit'} aria-controls="markdown-panel" onClick={()=>setTab('edit')}>Markdown</button>
     <button aria-pressed={tab==='preview'} aria-controls="preview-panel" onClick={()=>setTab('preview')}>プレビュー</button>
     <span className="byte-count">{new TextEncoder().encode(markdown).length.toLocaleString()} / 200,000 bytes</span>
    </div>
    <div className={`writing-surface ${tab}`}>
     <div id="markdown-panel" className="markdown-pane" hidden={tab!=='edit'}>
      <label htmlFor="markdown-body" className="sr-only">Markdown本文</label>
      <textarea disabled={busy} name="markdown" id="markdown-body" spellCheck={false} value={markdown} onChange={e=>{draftChanged();updateMarkdown(e.target.value);setDirty(true);}} placeholder={'# 見出し\n\nここにMarkdownを貼り付けてください。'} aria-label="Markdown本文"/>
     </div>
     <div id="preview-panel" className="preview-pane" hidden={tab!=='preview'} aria-label="本文のプレビュー">
      {markdown?<Markdown text={markdown} origin={origin} renderExternal={externalLink}/>:<p className="preview-empty">本文のプレビューがここに表示されます。Markdownを入力するか、URLから変換してください。</p>}
     </div>
    </div>
   </section>
   <section className="publish-bar" aria-label="編集中の本文の書き出し">
    <button type="button" className="secondary-button" onClick={exportBody} disabled={!markdown.length} aria-describedby="local-export-guidance">Markdown本文を端末に書き出す</button>
    <p id="local-export-guidance" className="publication-guidance">編集中の本文だけを .md ファイルにします。タイトル・元URLは含みません。サーバーへの保存や公開とは別の操作です。</p>
    {exportMessage&&<p className="notice" role="status" aria-live="polite">{exportMessage}</p>}
   </section>
   <section className="publish-bar" aria-label="記事の保存と公開">
    <label className="rights-check"><input disabled={busy} type="checkbox" checked={rights} onChange={e=>{draftChanged();rightsVersion.current=e.target.checked?draftVersion.current:null;setRights(e.target.checked);}}/><span>出典・ライセンス・個人情報を確認した</span></label>
    <div className="publish-actions"><button className="button" onClick={()=>save(false)} disabled={busy}>{published?'非公開で保存':'下書き保存'}</button><button className="secondary-button" onClick={()=>save(true)} disabled={busy||!rights}>{busy?'保存中…':published?'公開内容を更新':'公開する'}</button></div>
    <p className="publication-guidance">タイトル・本文・元URLを変更したら、公開前にもう一度確認してください。公開した記事だけ、誰でも読めます。非公開に戻しても、他者が保存したコピーは取り消せません。</p>
   </section>
   {message&&<p className="notice" role="status" aria-live="polite">{message}</p>}
   {shareUrl&&<div className="share-box"><label htmlFor="share-url">公開URL</label><input id="share-url" readOnly value={shareUrl}/><button className="secondary-button" onClick={copyUrl}>コピー</button><a href={shareUrl} target="_blank" rel="noopener noreferrer">開く ↗</a></div>}
   <p className="editor-footnote">HTML・スクリプト・フォームは本文として扱います。外部画像は読み込みません。Markdownの入力は公開するまで下書きです。</p>
  </section>
  <ExternalWarning pending={pendingLink} onClose={()=>setPendingLink(null)}/>
 </main>;
}
