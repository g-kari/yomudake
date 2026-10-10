'use client';
import {useEffect,useRef,useState} from 'react';
const Link=({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>;
type ApiReply={error?:string;articles?:Article[];url?:string;id?:string;published?:boolean;markdown?:string;sourceUrl?:string;title?:string};
import {Markdown} from '../src/markdown';
import {sample} from '../src/sample';
import {articleLink} from '../src/navigation.mjs';
import {ExternalWarning,type PendingLink} from './external-warning';
type Article={id:string;title:string;source_url:string;markdown:string;published:number;created_at:string;updated_at:string;published_at:string|null};
export default function Editor({signOutPath}:{signOutPath:string}) {
 const [articles,setArticles]=useState<Article[]>([]),[id,setId]=useState(''),[title,setTitle]=useState(sample.title),[markdown,setMarkdown]=useState(sample.markdown),[sourceUrl,setSourceUrl]=useState('');
 const [dirty,setDirty]=useState(false);
 const [pendingLink,setPendingLink]=useState<PendingLink|null>(null);
 const [tab,setTab]=useState<'edit'|'preview'>('preview'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[rights,setRights]=useState(false),[published,setPublished]=useState(false),[shareUrl,setShareUrl]=useState('');
 const draftVersion=useRef(0),listVersion=useRef(0),conversion=useRef<{controller:AbortController;version:number}|null>(null),saving=useRef<{version:number}|null>(null);
 function draftChanged(){
  draftVersion.current++;
  const pending=conversion.current;
  if(pending){conversion.current=null;pending.controller.abort();setBusy(false);}
 }
 useEffect(()=>()=>{draftVersion.current++;listVersion.current++;conversion.current?.controller.abort();conversion.current=null;saving.current=null;},[]);
 async function load(active:()=>boolean){
  const version=++listVersion.current;
  try{const r=await fetch('/api/articles',{cache:'no-store'});const data=await r.json() as ApiReply;if(!active()||version!==listVersion.current)return;if(!r.ok)throw new Error(data.error||'記事を読み込めません。');setArticles(data.articles||[]);}
  catch(e){if(active()&&version===listVersion.current)throw e;}
 }
 useEffect(()=>{let active=true;const version=listVersion.current+1;load(()=>active).catch(()=>{if(active&&version===listVersion.current&&!saving.current)setMessage('記事を読み込めませんでした。再読み込みしてください。');});return ()=>{active=false;};},[]);
 useEffect(()=>{function warn(e:BeforeUnloadEvent){if(dirty){e.preventDefault();e.returnValue='';}}window.addEventListener('beforeunload',warn);return ()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 function mayLeave(){return !dirty||window.confirm('保存していない変更があります。破棄して記事を切り替えますか？');}
 function createNew(){if(saving.current||!mayLeave())return;setPendingLink(null);draftChanged();setDirty(false);setId('');setTitle('');setMarkdown('');setSourceUrl('');setRights(false);setPublished(false);setShareUrl('');setMessage('新しい下書きです。');setTab('edit');}
 function openArticle(a:Article){if(saving.current||!mayLeave())return;setPendingLink(null);draftChanged();setDirty(false);setId(a.id);setTitle(a.title);setMarkdown(a.markdown);setSourceUrl(a.source_url);setRights(false);setPublished(Boolean(a.published));setShareUrl(a.published?`${window.location.origin}/p/${a.id}`:'');setMessage('');setTab('preview');}
 async function save(makePublic:boolean){
  if(busy||saving.current||conversion.current)return;
  if(makePublic&&!rights){setMessage('本文・出典・ライセンスを確認し、公開確認にチェックしてください。');return;}
  // Keep mutation requests single-flight through list refresh. Newer queued edits
  // invalidate only the clean-state acknowledgement, not the server-side write.
  const pending={version:draftVersion.current};saving.current=pending;
  const active=()=>saving.current===pending;
  setBusy(true);setMessage('');
  const articleId=id||crypto.randomUUID();setId(articleId);
  const savedMessage=()=>`${makePublic?'公開しました。共有URLから、サインインなしで読めます。':'下書きに保存しました。公開ページには表示されません。'}${draftVersion.current!==pending.version?' 編集中の変更はまだ保存されていません。もう一度保存してください。':''}`;
  try {
   const r=await fetch('/api/articles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:articleId,title,markdown,sourceUrl,published:makePublic,rightsConfirmed:rights})});const raw:unknown=await r.json();
   if(!active())return;
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('保存結果を確認できませんでした。本文は残っています。');
   const data=raw as ApiReply;
   if(!r.ok)throw new Error(typeof data.error==='string'?data.error:'保存できませんでした。本文は残っています。');
   if(data.id!==articleId||data.published!==makePublic||data.url!==`/p/${articleId}`)throw new Error('保存結果を確認できませんでした。本文は残っています。');
   if(draftVersion.current===pending.version)setDirty(false);
   setPublished(makePublic);setShareUrl(makePublic?`${window.location.origin}${data.url}`:'');setMessage(savedMessage());
   try{await load(active);if(active())setMessage(savedMessage());}
   catch{if(active())setMessage(`${savedMessage()} 記事一覧の再読み込みに失敗しました。ページを再読み込みして一覧を確認してください。`);}
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
  try{
   const r=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:sourceUrl}),signal:pending.controller.signal});
   const raw:unknown=await r.json();
   if(!isCurrent())return;
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('変換結果を読み込めませんでした。本文は残っています。');
   const data=raw as ApiReply;
   if(!r.ok)throw new Error(typeof data.error==='string'?data.error:'変換できませんでした。');
   if(typeof data.markdown!=='string'||('title' in data&&typeof data.title!=='string')||('sourceUrl' in data&&typeof data.sourceUrl!=='string'))throw new Error('変換結果を読み込めませんでした。本文は残っています。');
   draftVersion.current++;setMarkdown(data.markdown);setTitle(data.title||'変換した記事');setSourceUrl(data.sourceUrl||sourceUrl);setDirty(true);setRights(false);setTab('preview');setMessage('Markdownに変換しました。本文・出典・ライセンスを確認してから公開してください。');
  }catch(e){if(isCurrent())setMessage(e instanceof Error?e.message:'変換できませんでした。');}
  finally{if(conversion.current===pending){conversion.current=null;setBusy(false);}}
 }
 async function copyUrl(){try{await navigator.clipboard.writeText(shareUrl);setMessage('共有URLをコピーしました。');}catch{setMessage('コピーできませんでした。表示されたURLを選択してコピーしてください。');}}
 const selectedArticle=articles.find(a=>a.id===id);
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
   <nav className="draft-list" aria-label="保存した記事">
    {articles.length?articles.map(a=><button key={a.id} className={`draft-row ${id===a.id?'selected':''}`} aria-current={id===a.id?'true':undefined} onClick={()=>openArticle(a)} disabled={busy}>
     <span className={`status-dot ${a.published?'live':''}`} aria-hidden="true"/>
     <span>{a.title}<small>{a.published?'公開中':'下書き'} · {a.updated_at.slice(0,10)}</small></span>
    </button>):<p className="empty-list">保存した記事はここに並びます。新しい下書きから始められます。</p>}
   </nav>
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
      <textarea disabled={busy} name="markdown" id="markdown-body" spellCheck={false} value={markdown} onChange={e=>{draftChanged();setMarkdown(e.target.value);setDirty(true);}} placeholder={'# 見出し\n\nここにMarkdownを貼り付けてください。'} aria-label="Markdown本文"/>
     </div>
     <div id="preview-panel" className="preview-pane" hidden={tab!=='preview'} aria-label="本文のプレビュー">
      {markdown?<Markdown text={markdown} origin={origin} renderExternal={externalLink}/>:<p className="preview-empty">本文のプレビューがここに表示されます。Markdownを入力するか、URLから変換してください。</p>}
     </div>
    </div>
   </section>
   <section className="publish-bar" aria-label="記事の保存と公開">
    <label className="rights-check"><input disabled={busy} type="checkbox" checked={rights} onChange={e=>{draftChanged();setRights(e.target.checked);}}/><span>出典・ライセンス・個人情報を確認した</span></label>
    <div className="publish-actions"><button className="button" onClick={()=>save(false)} disabled={busy}>{published?'非公開で保存':'下書き保存'}</button><button className="secondary-button" onClick={()=>save(true)} disabled={busy||!rights}>{busy?'保存中…':published?'公開内容を更新':'公開する'}</button></div>
    <p className="publication-guidance">公開した記事だけ、誰でも読めます。非公開に戻しても、他者が保存したコピーは取り消せません。</p>
   </section>
   {message&&<p className="notice" role="status" aria-live="polite">{message}</p>}
   {shareUrl&&<div className="share-box"><label htmlFor="share-url">公開URL</label><input id="share-url" readOnly value={shareUrl}/><button className="secondary-button" onClick={copyUrl}>コピー</button><a href={shareUrl} target="_blank" rel="noopener noreferrer">開く ↗</a></div>}
   <p className="editor-footnote">HTML・スクリプト・フォームは本文として扱います。外部画像は読み込みません。Markdownの入力は公開するまで下書きです。</p>
  </section>
  <ExternalWarning pending={pendingLink} onClose={()=>setPendingLink(null)}/>
 </main>;
}
