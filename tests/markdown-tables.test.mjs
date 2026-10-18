import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {exportMarkdown} from '../src/navigation.mjs';

mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Markdown} from './src/markdown';export * from './src/export-html';export const preview=(text)=>renderToStaticMarkup(React.createElement(Markdown,{text,origin:'https://reader.example'}));",loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/tables-renderer-test.mjs',jsx:'automatic'});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/tables-worker-test.mjs',jsx:'automatic'});
const renderer=await import('../.sites-runtime/tables-renderer-test.mjs');
const {createWorker}=await import('../.sites-runtime/tables-worker-test.mjs');
const origin='https://reader.example';
const dom=html=>{const window=new Window();window.document.body.innerHTML=html;return window.document;};
const cells=(doc,selector)=>[...doc.querySelectorAll(selector)].map(row=>[...row.children].map(cell=>cell.textContent));
const markdown='| 項目 | 条件 | 数量 |\n| :--- | :---: | ---: |\n| **合成A** | `ready` | 12 |\n| 合成B | 未確定 | 3 |';

test('actual preview and safe HTML renderer display the same Japanese comparison table',()=>{
 for(const html of [renderer.preview(markdown),renderer.markdownToHtml(markdown)]){
  const doc=dom(html);assert.equal(doc.querySelectorAll('table').length,1);
  assert.deepEqual(cells(doc,'thead tr'),[['項目','条件','数量']]);
  assert.deepEqual(cells(doc,'tbody tr'),[['合成A','ready','12'],['合成B','未確定','3']]);
  assert.equal(doc.querySelector('tbody strong').textContent,'合成A');assert.equal(doc.querySelector('tbody code').textContent,'ready');
  assert.deepEqual([...doc.querySelectorAll('th')].map(cell=>cell.getAttribute('scope')),['col','col','col']);
  assert.deepEqual([...doc.querySelectorAll('th')].map(cell=>cell.getAttribute('align')),['left','center','right']);
  const region=doc.querySelector('.table-scroll');assert.equal(region.getAttribute('tabindex'),'0');assert.equal(region.getAttribute('role'),'region');assert.match(region.getAttribute('aria-label'),/表 1/);
 }
});
test('optional edge pipes, whitespace, escaped pipes and empty cells keep the table shape',()=>{
 const text=['名前 | 内容 | 空欄',':--- | ---: | :---:','  A\\|B | b `\\|` c | ','| **C\\|D** | 2 | end |'].join('\n');
 const doc=dom(renderer.markdownToHtml(text));
 assert.deepEqual(cells(doc,'thead tr'),[['名前','内容','空欄']]);
 assert.deepEqual(cells(doc,'tbody tr'),[['A|B','b | c',''],['C|D','2','end']]);
 assert.equal(doc.querySelector('code').textContent,'|');
});
test('short body rows get empty cells and excess body cells follow basic GFM truncation',()=>{
 const doc=dom(renderer.markdownToHtml('| A | B |\n| --- | --- |\n| one |\n| two | three | four |\n| | |'));
 assert.deepEqual(cells(doc,'tbody tr'),[['one',''],['two','three'],['','']]);
});
test('header-only tables omit an empty body and repeated tables get distinct region labels',()=>{
 const doc=dom(renderer.markdownToHtml('| one |\n| --- |\n\n| two |\n| --- |'));
 assert.equal(doc.querySelectorAll('table').length,2);assert.equal(doc.querySelectorAll('tbody').length,0);
 assert.deepEqual([...doc.querySelectorAll('.table-scroll')].map(region=>region.getAttribute('aria-label')),['表 1（左右にスクロールできます）','表 2（左右にスクロールできます）']);
});
test('fenced tables, literal prose, mismatched headers and malformed delimiter rows stay non-tables',()=>{
 for(const text of ['```md\n'+markdown+'\n```','A | B\nnot a delimiter\none | two','| A | B |\n| --- |\n| one | two |','| A | B |\n| --- | --x |\n| one | two |','plain text\n---\nmore text','`A \\| B`\n| --- |','| only escaped \\| pipe |\nnot a table','    | A | B |\n    | --- | --- |\n    | one | two |']){
  const doc=dom(renderer.markdownToHtml(text));assert.equal(doc.querySelectorAll('table').length,0,text);
 }
});
test('tables end at blank lines and real block starts; adjacent headings keep existing IDs',()=>{
 const text=markdown+'\n## 次の節\n\n文章\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |\n> 引用\n\n- 項目';
 const {html,outline}=renderer.markdownToHtmlWithOutline(text);const doc=dom(html);
 assert.equal(doc.querySelectorAll('table').length,2);assert.equal(doc.querySelector('h2').textContent,'次の節');assert.equal(doc.querySelector('blockquote').textContent,'引用');assert.equal(doc.querySelector('li').textContent,'項目');
 assert.deepEqual(outline,[{id:'yomu-section-1',level:2,label:'次の節'}]);
});
test('tables can follow a paragraph without swallowing it, and plain following prose stays outside',()=>{
 const doc=dom(renderer.markdownToHtml('Before\n'+markdown+'\nAfter'));
 assert.equal(doc.querySelectorAll('table').length,1);assert.deepEqual([...doc.querySelectorAll('p')].map(p=>p.textContent),['Before','After']);
});
test('pipe escape parity preserves literal pipes and does not hide a real separator',()=>{
 const doc=dom(renderer.markdownToHtml('| A | B |\n| --- | --- |\n| one\\|two | end\\| |\n| slash\\\\| next |'));
 assert.deepEqual(cells(doc,'tbody tr'),[['one|two','end|'],['slash\\\\','next']]);
});
test('excessively wide or padded tables fall back to complete inert source rather than expanding the DOM',()=>{
 const wide='|'+Array(33).fill('header').join('|')+'|\n|'+Array(33).fill('---').join('|')+'|\n|tail|';
 const tall='|'+Array(32).fill('header').join('|')+'|\n|'+Array(32).fill('---').join('|')+'|\n'+Array(313).fill('|body|').join('\n')+'\n|tail|';
 for(const text of [wide,tall]){
  const doc=dom(renderer.markdownToHtml(text));assert.equal(doc.querySelectorAll('table,th,td').length,0);assert.equal(doc.body.textContent,text);
 }
});
test('the exact 10,000-cell boundary renders, but one additional body row preserves the whole source',()=>{
 const atLimit='| A | B |\n| --- | --- |\n'+Array(4999).fill('| one | two |').join('\n');
 const valid=dom(renderer.markdownToHtml(atLimit));assert.equal(valid.querySelectorAll('th,td').length,10_000);assert.equal(valid.querySelectorAll('tbody tr').length,4999);
 const over=atLimit+'\n| unique-tail | retained |',fallback=dom(renderer.markdownToHtml(over));assert.equal(fallback.querySelectorAll('table').length,0);assert.equal(fallback.body.textContent,over);
});
test('both oversized fallbacks retain literal inline syntax, HTML and image text without link-index changes',()=>{
 const raw='**raw** `code` [tail](https://example.org/ignored) ![image](https://example.org/pixel) <script>inert()</script>';
 const wide='|'+Array(33).fill('header').join('|')+'|\n|'+Array(33).fill('---').join('|')+'|\n|'+raw+'|';
 const tall='|'+Array(32).fill('header').join('|')+'|\n|'+Array(32).fill('---').join('|')+'|\n'+Array(313).fill('|body|').join('\n')+'\n|'+raw+'|';
 for(const block of [wide,tall]){
  const text=block+'\n\n[following](https://example.org/following)';
  for(const html of [renderer.preview(text),renderer.markdownToHtml(text,{origin,externalHref:(_href,index)=>origin+'/out/table/link-'+index})]){
   const doc=dom(html),fallback=doc.querySelector('p');assert.equal(fallback.textContent,block);assert.equal(fallback.querySelectorAll('*').length,0);
   assert.equal(doc.querySelectorAll('script,img,iframe,table,strong,code').length,0);assert.equal(doc.querySelectorAll('a').length,1);
  }
  assert.deepEqual(renderer.markdownExternalLinks(text,origin),['https://example.org/following']);
  assert.equal(dom(renderer.markdownToHtml(text,{origin,externalHref:(_href,index)=>origin+'/out/table/link-'+index})).querySelector('a').getAttribute('href'),origin+'/out/table/link-0');
 }
});
test('table cells keep inert HTML, image placeholders and guarded links without new attributes',()=>{
 const text='| HTML | Link | Image |\n| --- | --- | --- |\n| <img src=x onerror=evil()> <script>bad()</script> | [unsafe](javascript:evil) [safe](https://example.org/table) | ![合成](https://example.org/pixel) |';
 const html=renderer.markdownToHtml(text,{origin,externalHref:(_href,index)=>origin+'/out/table/link-'+index});const doc=dom(html);
 assert.equal(doc.querySelectorAll('table').length,1);assert.equal(doc.querySelectorAll('script,img,iframe,style,form,[onerror],[onclick]').length,0);
 assert.match(doc.querySelector('tbody').textContent,/<script>bad\(\)<\/script>/);assert.match(doc.querySelector('tbody').textContent,/unsafe［リンク無効］/);assert.match(doc.querySelector('tbody').textContent,/［画像: 合成］/);
 assert.equal(doc.querySelector('tbody a').getAttribute('href'),origin+'/out/table/link-0');
 assert.deepEqual(renderer.markdownExternalLinks(text,origin),['https://example.org/table']);
 assert.ok(!html.includes('style='));
});

function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_articles.sql','utf8'));function prepare(sql,args=[]){return {bind(...a){return prepare(sql,a)},async all(){return {success:true,results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){db.prepare(sql).run(...args);return {success:true}}};}return {prepare};}
const worker=createWorker({verifyOwner:async()=>({ok:true,status:200})});
const article={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'合成の比較表',sourceUrl:'https://example.org/source',published:true,rightsConfirmed:true};
async function publish(text,published=true){const env={DB:database()};const response=await worker.fetch(new Request(origin+'/api/articles',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...article,markdown:text,published})}),env);assert.equal(response.status,200);return env;}
async function read(path,env){return worker.fetch(new Request(origin+path),env);}
test('public page and exact HTML download share script-free tables and preserve stored Markdown',async()=>{
 const text='## 導入\n\n'+markdown+'\n\n## 終わり';const env=await publish(text);
 const page=await read('/p/'+article.id,env),download=await read('/export/'+article.id+'?format=html',env);const html=await page.text();
 assert.equal(await download.text(),html);assert.equal(dom(html).querySelectorAll('table').length,1);assert.equal(dom(html).querySelectorAll('script,img,iframe,form').length,0);
 const saved=await (await read('/api/articles',env)).json();assert.equal(saved.articles[0].markdown,text);
 assert.equal(await (await read('/export/'+article.id+'?format=md',env)).text(),exportMarkdown({...article,source_url:article.sourceUrl,markdown:text}));
 assert.equal(download.headers.get('cache-control'),'no-store, no-transform');
});
test('private tables remain unavailable to public article and HTML download routes',async()=>{
 const env=await publish(markdown,false);
 for(const path of ['/p/'+article.id,'/export/'+article.id+'?format=html']){const response=await read(path,env);assert.equal(response.status,404);assert.ok(!(await response.text()).includes('<table>'));}
});
