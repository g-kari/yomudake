export const ARTICLE_PAGE_SIZE=100;
const MAX_CURSOR_LENGTH=512;
const MAX_SEARCH_CURSOR_LENGTH=1024;
const MAX_QUERY_LENGTH=100;
export class ArticlePageError extends Error {
 constructor(){super('記事一覧のページ指定が不正です。');this.name='ArticlePageError';}
}
function validPosition(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const {updatedAt,id}=value;
 if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)||typeof updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(updatedAt))return false;
 const date=new Date(updatedAt);
 return Number.isFinite(date.getTime())&&date.toISOString()===(updatedAt.length===20?updatedAt.slice(0,-1)+'.000Z':updatedAt);
}
export function normalizeArticleQuery(value=''){
 if(typeof value!=='string'||value.length>MAX_QUERY_LENGTH)throw new ArticlePageError();
 return value.trim();
}
export function articleQueryFromUrl(url){
 const values=url.searchParams.getAll('q');
 if(!values.length)return '';
 if(values.length!==1)throw new ArticlePageError();
 return normalizeArticleQuery(values[0]);
}
function base64Url(bytes){
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function encodeArticleCursor(article,query=''){
 query=normalizeArticleQuery(query);
 const position={updatedAt:article.updated_at,id:article.id};
 if(!validPosition(position))throw new Error('storage page position unavailable');
 const value=query?{version:2,...position,query}:{version:1,...position};
 return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}
export function decodeArticleCursor(cursor,query=''){
 query=normalizeArticleQuery(query);
 if(typeof cursor!=='string'||!cursor.length||cursor.length>(query?MAX_SEARCH_CURSOR_LENGTH:MAX_CURSOR_LENGTH)||!/^[a-zA-Z0-9_-]+$/.test(cursor))throw new ArticlePageError();
 try{
  const encoded=cursor.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=Uint8Array.from(atob(encoded+'='.repeat((4-encoded.length%4)%4)),char=>char.charCodeAt(0));
  if(base64Url(bytes)!==cursor)throw new ArticlePageError();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const value=JSON.parse(text);
  if(!validPosition(value)||value.version!==(query?2:1)||Object.keys(value).length!==(query?4:3)||(query&&value.query!==query)||encodeArticleCursor({updated_at:value.updatedAt,id:value.id},query)!==cursor)throw new ArticlePageError();
  return {updatedAt:value.updatedAt,id:value.id};
 }catch{throw new ArticlePageError();}
}
export function articleCursorFromUrl(url,query=''){
 const values=url.searchParams.getAll('cursor');
 if(!values.length)return null;
 if(values.length!==1)throw new ArticlePageError();
 return decodeArticleCursor(values[0],query);
}
