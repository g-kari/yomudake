import {safeHttpUrl} from './security.mjs';
const sensitiveQuery=url=>[...url.searchParams.keys()].some(key=>/^(access_token|token|api_?key|authorization|password|secret|signature|sig)$/i.test(key));

// Navigation does not fetch the destination. Keep the existing HTTP URL policy,
// and admit only local fragments/paths when a caller supplies its own origin.
export function articleLink(value,origin='') {
 if(typeof value!=='string'||!value||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value))return null;
 if(value.startsWith('#'))return {href:value,external:false};
 if(value.startsWith('/')){
  if(!origin||value.startsWith('//'))return null;
  try{const url=new URL(value,origin);return url.origin===origin&&!url.username&&!url.password&&!sensitiveQuery(url)?{href:url.href,external:false}:null;}catch{return null;}
 }
 let direct;try{direct=new URL(value);}catch{return null;}
 if(direct.username||direct.password||sensitiveQuery(direct))return null;
 if(origin&&direct.origin===origin&&['https:','http:'].includes(direct.protocol))return {href:direct.href,external:false};
 const href=safeHttpUrl(value);if(!href)return null;
 const url=new URL(href);
 return {href,external:url.origin!==origin};
}

export async function articleRevision(article) {
 const data=new TextEncoder().encode(JSON.stringify([article.updated_at,article.source_url,article.markdown]));
 const digest=await crypto.subtle.digest('SHA-256',data);
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

export function confirmationUrl(origin,article,selector,revision) {
 const url=new URL(`/out/${article.id}/${selector}`,origin);
 url.searchParams.set('rev',revision);
 return url.href;
}

export function exportMarkdown(article) {
 const source=articleLink(article.source_url);
 if(!source)return article.markdown;
 // Encode Markdown delimiters rather than interpolating an untrusted label or
 // angle-bracket destination. The original stored body remains byte-for-byte.
 const destination=source.href.replace(/[()\[\]<>`"']/g,c=>encodeURIComponent(c).replace(/['()]/g,x=>`%${x.charCodeAt(0).toString(16).toUpperCase()}`));
 return `元の記事: [元ページを開く](${destination})\n\n外部サイトへのリンクです。内容や安全性は保証できません。Markdownビューアーでは確認画面を表示できません。\n\n---\n\n${article.markdown}`;
}
