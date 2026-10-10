import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {exportMarkdown} from '../src/navigation.mjs';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/export-html.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/outline-export-test.mjs',jsx:'automatic'});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/outline-worker-test.mjs',jsx:'automatic'});
const renderer=await import('../.sites-runtime/outline-export-test.mjs');
const {createWorker}=await import('../.sites-runtime/outline-worker-test.mjs');
const origin='https://reader.example';
const document=html=>{const window=new Window();window.document.body.innerHTML=html;return window.document;};
const headingIds=html=>[...document(html).querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>h.id);

test('heading IDs are deterministic, unique and independent of Japanese labels',()=>{
 const text='# 同じ見出し\n\n## 同じ見出し\n\n###### 同じ見出し';
 const html=renderer.markdownToHtml(text);
 assert.deepEqual(headingIds(html),['yomu-section-1','yomu-section-2','yomu-section-3']);
 assert.equal(renderer.markdownToHtml(text),html);
 assert.deepEqual(headingIds(renderer.markdownToHtml('# 別の記事')),['yomu-section-1']);
});
test('outline comes from real rendered headings with exact levels and inert inline text',()=>{
 assert.equal(typeof renderer.markdownToHtmlWithOutline,'function');
 const text='# 日本語 **見出し** [出典](https://example.org/ref)\r\n\r\n```md\r\n## コード内\r\n```\r\n\r\n#### `中間` *見出し*\r\n\r\n> ## 引用内\r\n\r\n- ## リスト内\r\n\r\n  ## 字下げされた本文\r\n\r\n###### 終わり';
 const {html,outline}=renderer.markdownToHtmlWithOutline(text,{origin});
 assert.deepEqual(outline,[{id:'yomu-section-1',level:1,label:'日本語 見出し 出典'},{id:'yomu-section-2',level:4,label:'中間 見出し'},{id:'yomu-section-3',level:6,label:'終わり'}]);
 assert.deepEqual(headingIds(html),outline.map(h=>h.id));
 assert.ok(html.includes('## コード内'));
});
test('generated IDs alone survive serialization, while heading labels stay escaped',()=>{
 const html=renderer.markdownToHtml('# <script>alert(1)</script> {#evil}\n\n## ![画像](https://evil.example/pixel)');
 const doc=document(html);
 assert.equal(doc.querySelectorAll('script,img,iframe,style').length,0);
 for(const heading of doc.querySelectorAll('h1,h2'))assert.deepEqual([...heading.attributes].map(a=>a.name).sort(),['id','tabindex']);
 assert.equal(doc.querySelector('h1').getAttribute('tabindex'),'-1');
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('id="evil"'));
});
test('long and empty rendered labels keep safe numeric IDs and a usable fallback',()=>{
 const label='長い見出し'.repeat(1000);
 const {outline}=renderer.markdownToHtmlWithOutline('# '+label+'\n\n##   ');
 assert.deepEqual(outline,[{id:'yomu-section-1',level:1,label},{id:'yomu-section-2',level:2,label:'見出し 2'}]);
});

function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_articles.sql','utf8'));function prepare(sql,args=[]){return {bind(...a){return prepare(sql,a)},async all(){return {success:true,results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){db.prepare(sql).run(...args);return {success:true}}};}return {prepare};}
const worker=createWorker({verifyOwner:async()=>({ok:true,status:200})});
const data={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'架空の目次記事',sourceUrl:'https://example.org/source',published:true,rightsConfirmed:true};
async function publish(markdown,published=true){const env={DB:database()};const response=await worker.fetch(new Request(origin+'/api/articles',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...data,markdown,published})}),env);assert.equal(response.status,200);return env;}
async function read(path,env){return worker.fetch(new Request(origin+path),env);}

test('public reader and HTML download contain matching script-free TOC targets',async()=>{
 const markdown='# 日本語 **導入**\n\n本文\n\n#### 同じ見出し\n\n## 同じ見出し\n\n###### '+ '長い節'.repeat(80);
 const env=await publish(markdown),page=await read('/p/'+data.id,env),download=await read('/export/'+data.id+'?format=html',env);
 const html=await page.text();assert.equal(await download.text(),html);
 const doc=document(html),nav=doc.querySelector('nav[aria-label="記事の目次"]');assert.ok(nav);
 assert.equal(nav.closest('details').hasAttribute('open'),true);
 assert.equal(nav.closest('details').querySelector('summary').textContent,'目次');
 const links=[...nav.querySelectorAll('a')];assert.equal(links.length,4);
 assert.deepEqual(links.map(a=>a.textContent),['日本語 導入','同じ見出し','同じ見出し','長い節'.repeat(80)]);
 assert.deepEqual(links.map(a=>a.getAttribute('href')),['#yomu-section-1','#yomu-section-2','#yomu-section-3','#yomu-section-4']);
 assert.deepEqual([...nav.querySelectorAll('li')].map(li=>li.className),['outline-level-1','outline-level-4','outline-level-2','outline-level-6']);
 for(const link of links){const target=doc.getElementById(link.getAttribute('href').slice(1));assert.ok(target);assert.equal(target.getAttribute('tabindex'),'-1');}
 assert.equal(doc.querySelectorAll('script,img,iframe,form').length,0);
 assert.equal(download.headers.get('cache-control'),'no-store, no-transform');
 assert.equal(download.headers.get('content-security-policy'),page.headers.get('content-security-policy'));
});
test('zero or one heading omits TOC without changing article text or headings',async()=>{
 for(const markdown of ['見出しのない本文','## 見出しひとつ\n\n本文','```md\n# コードだけ\n## これもコード\n```']){
  const env=await publish(markdown),doc=document(await (await read('/p/'+data.id,env)).text());
  assert.equal(doc.querySelectorAll('.article-outline').length,0);
 }
});
test('outline labels cannot inject attributes or nest source-site anchors',async()=>{
 const markdown='# [出典](https://example.org/first) <svg onload="evil()">\n\n## " onclick="evil() & <iframe>\n\n[次の出典](https://example.org/second)';
 const env=await publish(markdown),doc=document(await (await read('/p/'+data.id,env)).text());
 const nav=doc.querySelector('.article-outline nav');assert.ok(nav);
 assert.equal(nav.querySelectorAll('a').length,2);
 for(const link of nav.querySelectorAll('a')){assert.deepEqual([...link.attributes].map(a=>a.name),['href']);assert.equal(link.querySelectorAll('*').length,0);assert.ok(link.getAttribute('href').startsWith('#yomu-section-'));}
 assert.equal(doc.querySelectorAll('svg,iframe,[onclick],[onload]').length,0);
 const hrefs=[...doc.querySelectorAll('a')].map(a=>a.getAttribute('href')).filter(href=>href.includes('/out/'));
 assert.deepEqual(hrefs.map(href=>new URL(href).pathname),['/out/'+data.id+'/source','/out/'+data.id+'/link-0','/out/'+data.id+'/link-1']);
 for(const [index,href] of hrefs.entries())assert.ok((await (await worker.fetch(new Request(href),env)).text()).includes(['https://example.org/source','https://example.org/first','https://example.org/second'][index]));
});
test('fragment navigation does not change stored Markdown or its attribution export',async()=>{
 const markdown='# はじめ\r\n\r\n本文 [節へ](#yomu-section-2)\r\n\r\n## おわり';
 const env=await publish(markdown);await read('/p/'+data.id+'#yomu-section-2',env);
 const list=await (await read('/api/articles',env)).json();assert.equal(list.articles[0].markdown,markdown);
 const download=await read('/export/'+data.id+'?format=md',env);
 assert.equal(await download.text(),exportMarkdown({...data,source_url:data.sourceUrl,markdown}));
});
test('outline never exposes a private or missing article',async()=>{
 const env=await publish('# 非公開\n\n## 秘密',false);
 for(const path of ['/p/'+data.id,'/export/'+data.id+'?format=html','/p/missing']){const response=await read(path,env);assert.equal(response.status,404);assert.ok(!(await response.text()).includes('yomu-section-'));}
});
