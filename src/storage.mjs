import {sample} from './sample';
import {ARTICLE_PAGE_SIZE,encodeArticleCursor} from './article-pages.mjs';
const COLUMNS='id,title,source_url,markdown,published,created_at,updated_at,published_at';
export async function listArticles(env,publicOnly=false){if(!env.DB)throw new Error('storage unavailable');const r=await env.DB.prepare(`SELECT ${COLUMNS} FROM articles ${publicOnly?'WHERE published = 1':''} ORDER BY updated_at DESC LIMIT 100`).all();if(!r.success)throw new Error('storage read failed');return r.results||[];}
export async function listOwnerArticlePage(env,position=null){
 if(!env.DB)throw new Error('storage unavailable');
 const query=`SELECT ${COLUMNS} FROM articles ${position?'WHERE updated_at < ? OR (updated_at = ? AND id < ?)':''} ORDER BY updated_at DESC, id DESC LIMIT ${ARTICLE_PAGE_SIZE+1}`;
 let statement=env.DB.prepare(query);
 if(position)statement=statement.bind(position.updatedAt,position.updatedAt,position.id);
 const result=await statement.all();
 if(!result.success)throw new Error('storage read failed');
 const rows=result.results||[],articles=rows.slice(0,ARTICLE_PAGE_SIZE);
 return {articles,nextCursor:rows.length>ARTICLE_PAGE_SIZE?encodeArticleCursor(articles[articles.length-1]):null};
}
export async function getArticle(env,id,publicOnly=false){if(id===sample.id)return sample;if(!env.DB)throw new Error('storage unavailable');return env.DB.prepare(`SELECT ${COLUMNS} FROM articles WHERE id = ? ${publicOnly?'AND published = 1':''}`).bind(id).first();}
export async function saveArticle(env,a){if(!env.DB)throw new Error('storage unavailable');const now=new Date().toISOString();const r=await env.DB.prepare('INSERT INTO articles (id,title,source_url,markdown,published,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,source_url=excluded.source_url,markdown=excluded.markdown,published=excluded.published,updated_at=excluded.updated_at,published_at=CASE WHEN excluded.published = 1 THEN COALESCE(articles.published_at,excluded.published_at) ELSE NULL END').bind(a.id,a.title,a.sourceUrl,a.markdown,a.published?1:0,now,now,a.published?now:null).run();if(!r.success)throw new Error('storage save failed');}

// Atomic published-state protection: a preceding read alone can race a
// publication. Draft writes cannot overwrite or unpublish a published row.
export async function saveDraftArticle(env,a){
 if(!env.DB)throw new Error('storage unavailable');
 const now=new Date().toISOString();
 const r=await env.DB.prepare('INSERT INTO articles (id,title,source_url,markdown,published,created_at,updated_at,published_at) VALUES (?,?,?,?,0,?,?,NULL) ON CONFLICT(id) DO UPDATE SET title=excluded.title,source_url=excluded.source_url,markdown=excluded.markdown,updated_at=excluded.updated_at WHERE articles.published = 0').bind(a.id,a.title,a.sourceUrl,a.markdown,now,now).run();
 if(!r.success||!Number.isInteger(r.meta?.changes))throw new Error('storage save unverified');
 return r.meta.changes>0;
}
