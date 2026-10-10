import {verifyOwnerRequest} from './access.mjs';
import {listArticles,getArticle,saveArticle} from './storage.mjs';
import {sample} from './sample';
import {markdownToHtml} from './export-html';
import {safeHttpUrl,isSameOriginMutation,validateArticleInput} from './security.mjs';
import {readBounded,IngestError} from './fetch-html.mjs';
import {convertUrl} from './conversion.mjs';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
const json=(data,status=200)=>Response.json(data,{status,headers});
const html=(body,status=200)=>new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>よむだけ</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/styles.css"></head><body>${body}</body></html>`,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
const brand='<a href="/" class="brand"><span class="brand-mark">読</span> よむだけ</a>';
function articleHtml(a){const source=safeHttpUrl(a.source_url);return `<main class="reading-page"><header class="topbar">${brand}<span class="read-only">公開 / 閲覧専用</span></header><article class="reading"><div class="article-meta"><span>${a.id===sample.id?'サンプル / CC0':'公開記事'}</span><span>作成 ${escape(a.created_at.slice(0,10))} UTC</span></div><h1 class="article-title">${escape(a.title)}</h1><div class="article-source">${source?`元URL <a href="${escape(source)}" target="_blank" rel="noopener noreferrer nofollow">${escape(source)}</a>`:'このサイトで作成した本文'}</div><div class="prose">${markdownToHtml(a.markdown)}</div><div class="reading-end"><a href="/export/${escape(a.id)}?format=md" download>Markdownを保存 ↓</a><a href="/export/${escape(a.id)}?format=html" download>HTMLを保存 ↓</a></div></article><footer class="site-footer">外部画像は読み込みません。リンクを開くと元サイトへ移動します。</footer></main>`;}
export function createWorker({verifyOwner=verifyOwnerRequest,convert=convertUrl}={}){return {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname;
 try{
  if(path==='/admin'||path.startsWith('/api/')){const owner=await verifyOwner(request,env);if(!owner.ok)return path.startsWith('/api/')?json({error:owner.error||'所有者のサインインが必要です。'},owner.status||403):html(`<main class="signin">${brand}<h1>所有者のサインインが必要です</h1><p>管理用Access設定を確認してください。匿名では記事を作成・編集できません。</p></main>`,owner.status||403);}
  if(path==='/admin'&&request.method==='GET')return html('<div id="root"></div><script src="/editor.js" defer></script>');
  if(path==='/api/articles'&&request.method==='GET')return json({articles:await listArticles(env)});
  if((path==='/api/articles'||path==='/api/convert')&&request.method==='POST'){
   if(!isSameOriginMutation(request))return json({error:'管理画面から操作してください。'},403);
   let data;try{const body=await readBounded(request,215000);data=JSON.parse(new TextDecoder().decode(body));}catch(error){if(error instanceof IngestError)return json({error:error.message},error.status);return json({error:'JSON入力が不正です。'},400);}
   if(path==='/api/convert'){if(typeof data?.url!=='string')return json({error:'元URLを入力してください。'},400);return json(await convert(data.url,env,{ownHost:url.hostname}));}
   const result=validateArticleInput(data);if(!result.article)return json({error:result.error},400);await saveArticle(env,result.article);return json({id:result.article.id,published:result.article.published,url:`/p/${result.article.id}`});
  }
  if(path==='/'&&request.method==='GET'){const articles=await listArticles(env,true);return html(`<main class="public-home"><header class="topbar">${brand}<a href="/admin" class="quiet-link">管理画面 ↗</a></header><section class="home-intro"><h1>本文を読む。</h1><p>公開されたMarkdown記事です。</p></section><section class="article-grid">${[...articles,sample].map(a=>`<a class="article-card" href="/p/${escape(a.id)}"><h2>${escape(a.title)}</h2><p>${escape(a.markdown.replace(/[#*>\x60]/g,'').slice(0,100))}</p><span class="card-bottom">${escape(a.created_at.slice(0,10))}<span>読む ↗</span></span></a>`).join('')}</section></main>`);}
  const match=/^\/(p|export)\/([a-zA-Z0-9-]+)$/.exec(path);
  if(match&&request.method==='GET'){
   const a=await getArticle(env,match[2],true);if(!a)return html('<main class="signin"><h1>公開されていない記事です</h1><a href="/">公開記事へ</a></main>',404);
   if(match[1]==='p')return html(articleHtml(a));
   const isHtml=url.searchParams.get('format')==='html';const result=isHtml?html(articleHtml(a)):new Response(a.markdown,{headers:{...headers,'Content-Type':'text/markdown; charset=utf-8'}});if(isHtml)result.headers.set('Cache-Control','no-store, no-transform');result.headers.set('Content-Disposition',`attachment; filename="article-${a.id}.${isHtml?'html':'md'}"`);return result;
  }
  if(path.startsWith('/api/')||path==='/admin')return json({error:'この操作には対応していません。'},405);
  if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'読取専用です。'},405);
  if(['/styles.css','/editor.js','/favicon.svg'].includes(path)&&env.ASSETS){const asset=await env.ASSETS.fetch(request);const result=new Response(asset.body,asset);result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('Referrer-Policy','no-referrer');return result;}
  return html('<main class="signin"><h1>ページが見つかりません</h1><a href="/">公開記事へ</a></main>',404);
 }catch(error){if(error instanceof IngestError)return json({error:error.message},error.status);return path.startsWith('/api/')?json({error:'処理できませんでした。入力は画面に残っています。時間を置いて再試行してください。'},503):html('<main class="signin"><h1>記事を読み込めませんでした</h1><p>時間を置いて再試行してください。</p></main>',503);}
}};}
export default createWorker();
