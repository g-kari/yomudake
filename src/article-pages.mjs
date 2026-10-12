export const ARTICLE_PAGE_SIZE=100;
const MAX_CURSOR_LENGTH=512;
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
export function encodeArticleCursor(article){
 const position={updatedAt:article.updated_at,id:article.id};
 if(!validPosition(position))throw new Error('storage page position unavailable');
 return btoa(JSON.stringify({version:1,...position})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodeArticleCursor(cursor){
 if(typeof cursor!=='string'||!cursor.length||cursor.length>MAX_CURSOR_LENGTH||!/^[a-zA-Z0-9_-]+$/.test(cursor))throw new ArticlePageError();
 try{
  const encoded=cursor.replace(/-/g,'+').replace(/_/g,'/');
  const text=atob(encoded+'='.repeat((4-encoded.length%4)%4));
  if(btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==cursor)throw new ArticlePageError();
  const value=JSON.parse(text);
  if(!validPosition(value)||value.version!==1||Object.keys(value).length!==3||encodeArticleCursor({updated_at:value.updatedAt,id:value.id})!==cursor)throw new ArticlePageError();
  return {updatedAt:value.updatedAt,id:value.id};
 }catch{throw new ArticlePageError();}
}
export function articleCursorFromUrl(url){
 const values=url.searchParams.getAll('cursor');
 if(!values.length)return null;
 if(values.length!==1)throw new ArticlePageError();
 return decodeArticleCursor(values[0]);
}
