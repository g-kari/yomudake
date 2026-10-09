import {parse} from 'parse5';
import {safeHttpUrl} from './security.mjs';
import {fetchPublicHtml,IngestError,withAbort} from './fetch-html.mjs';
const ALLOWED=new Set(['main','article','section','div','p','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','ul','ol','li','blockquote','pre','code','hr','br','table','thead','tbody','tr','th','td','dl','dt','dd','a']);
const OMIT=new Set(['script','style','head','base','meta','link','img','picture','source','video','audio','iframe','object','embed','svg','math','form','input','button','select','textarea','noscript','template']);
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sanitizeConversionInput(html,sourceUrl) {
 const tree=parse(html),links=[];let title='';
 function text(node){return node.nodeName==='#text'?node.value:(node.childNodes||[]).map(text).join('');}
 const pending=[tree];let nodeCount=0;
 while(pending.length){const node=pending.pop();if(++nodeCount>50000)throw new IngestError('HTMLの構造が複雑すぎます。',422);if(node.tagName==='title'&&!title)title=text(node).trim().slice(0,160);for(const child of node.childNodes||[])pending.push(child);}
 function walk(node,depth=0){
  if(depth>200)throw new IngestError('HTMLの入れ子が深すぎます。',422);
  if(node.nodeName==='#text')return escape(node.value);
  const tag=node.tagName;
  if(OMIT.has(tag))return '';
  const content=(node.childNodes||[]).map(child=>walk(child,depth+1)).join('');
  if(!tag||!ALLOWED.has(tag))return content;
  if(tag==='a'){
   const raw=node.attrs?.find(a=>a.name==='href')?.value;let safe=null;
   if(raw){try{safe=safeHttpUrl(new URL(raw,sourceUrl).href);}catch{}}
   if(safe){const index=links.push(safe)-1;return `<a href="#yomudake-link-${index}">${content}</a>`;}
   return content;
  }
  return ['br','hr'].includes(tag)?`<${tag}>`:`<${tag}>${content}</${tag}>`;
 }
 return {html:`<!doctype html><html><body><main>${walk(tree)}</main></body></html>`,links,title};
}
export function restoreLinks(markdown,links) {
 return markdown.replace(/\]\((?:https:\/\/yomudake\.invalid\/?)?#yomudake-link-(\d+)\)/g,(whole,n)=>links[Number(n)]?`](${links[Number(n)]})`:whole);
}
export async function convertUrl(value,env,{ownHost='',fetcher=fetch,resolveHostname,conversionTimeoutMs=30000}={}) {
 if(!env.AI?.toMarkdown)throw new IngestError('Cloudflareの変換機能が未接続です。',503);
 const raw=await fetchPublicHtml(value,{ownHost,fetcher,resolveHostname});
 const sanitized=sanitizeConversionInput(raw.html,raw.sourceUrl);
 if(new TextEncoder().encode(sanitized.html).byteLength>1000000)throw new IngestError('変換用HTMLが1MBを超えています。',413);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),conversionTimeoutMs);let result;
 try{result=await withAbort(env.AI.toMarkdown({name:'page.html',blob:new Blob([sanitized.html],{type:'text/html'})},{conversionOptions:{output:{format:'markdown'},html:{hostname:'https://yomudake.invalid',cssSelector:'body'}}}),controller.signal);}
 catch(error){if(controller.signal.aborted)throw new IngestError('Markdown変換の待機がタイムアウトしました。本文は残っています。',504);throw error;}
 finally{clearTimeout(timer);}
 const first=Array.isArray(result)?result[0]:result;
 if(!first||first.format==='error'||typeof first.data!=='string')throw new IngestError('Markdown変換が完了しませんでした。',502);
 const markdown=restoreLinks(first.data,sanitized.links);
 if(new TextEncoder().encode(markdown).byteLength>200000)throw new IngestError('変換後の本文が200KBを超えています。',413);
 return {markdown,sourceUrl:raw.sourceUrl,title:sanitized.title||'変換した記事',convertedAt:new Date().toISOString()};
}
