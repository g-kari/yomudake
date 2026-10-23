// Editor-only optimistic concurrency. Navigation revisions have a different scope.
export const EDITOR_SAVE_PROTOCOL='compare-v1';
export const EDITOR_FIELDS=['id','title','source_url','markdown','published','created_at','updated_at','published_at'];
export async function editorRevision(article){
 const bytes=new TextEncoder().encode(JSON.stringify(EDITOR_FIELDS.map(key=>article[key])));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function saveEditorArticle(env,a,expectedRevision){
 if(!env.DB)throw new Error('storage unavailable');
 const before=await env.DB.prepare('SELECT '+EDITOR_FIELDS.join(',')+' FROM articles WHERE id = ?').bind(a.id).first();
 if(expectedRevision===null?before:!before||await editorRevision(before)!==expectedRevision)return null;
 const now=new Date().toISOString();
 const after={id:a.id,title:a.title,source_url:a.sourceUrl,markdown:a.markdown,published:a.published?1:0,created_at:before?.created_at??now,updated_at:now,published_at:a.published?(before?.published_at??now):null};
 // Compare every persisted field in the same statement as the write. A read or
 // timestamp token alone does not protect the interval before UPDATE executes.
 const sql=before?'UPDATE articles SET title=?,source_url=?,markdown=?,published=?,updated_at=?,published_at=? WHERE '+EDITOR_FIELDS.map(key=>key+' IS ?').join(' AND '):'INSERT INTO articles ('+EDITOR_FIELDS.join(',')+') VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING';
 const values=before?[after.title,after.source_url,after.markdown,after.published,after.updated_at,after.published_at,...EDITOR_FIELDS.map(key=>before[key])]:EDITOR_FIELDS.map(key=>after[key]);
 const result=await env.DB.prepare(sql).bind(...values).run();
 if(!result.success||!Number.isInteger(result.meta?.changes))throw new Error('storage save unverified');
 if(result.meta.changes!==1)return null;
 // Never read back a later writer's revision and acknowledge it as our own.
 return editorRevision(after);
}
