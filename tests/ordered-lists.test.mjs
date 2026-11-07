import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {exportMarkdown} from '../src/navigation.mjs';

mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Markdown} from './src/markdown';export * from './src/export-html';export const preview=(text)=>renderToStaticMarkup(React.createElement(Markdown,{text,origin:'https://reader.example'}));",loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/ordered-lists-renderer-test.mjs',jsx:'automatic'});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/ordered-lists-worker-test.mjs',jsx:'automatic'});
const renderer=await import('../.sites-runtime/ordered-lists-renderer-test.mjs');
const {createWorker}=await import('../.sites-runtime/ordered-lists-worker-test.mjs');
const origin='https://reader.example';
const dom=html=>{const window=new Window();window.document.body.innerHTML=html;return window.document;};
const outputs=text=>[renderer.preview(text),renderer.markdownToHtml(text,{origin})];
const starts=doc=>[...doc.querySelectorAll('ol')].map(list=>list.start);
const items=doc=>[...doc.querySelectorAll('li')].map(item=>item.textContent);

test('actual preview and safe HTML preserve non-default and zero ordered-list starts',()=>{
 for(const start of [3,0])for(const html of outputs(`${start}. 合成の手順\n${start+1}. 次の手順`)){
  const doc=dom(html);assert.deepEqual(starts(doc),[start]);assert.equal(doc.querySelector('ol').getAttribute('start'),String(start));
  assert.deepEqual(items(doc),['合成の手順','次の手順']);
 }
});
test('default start and unordered lists retain their existing output; leading zeros become numbers',()=>{
 for(const html of outputs('1. one\n2. two\n\n003. three\n004. four\n\n- plain\n+ second')){
  const doc=dom(html);assert.deepEqual(starts(doc),[1,3]);assert.equal(doc.querySelector('ol').getAttribute('start'),null);
  assert.equal(doc.querySelector('ul').hasAttribute('start'),false);assert.deepEqual([...doc.querySelectorAll('[start]')].map(node=>node.tagName),['OL']);
  assert.deepEqual(items(doc),['one','two','three','four','plain','second']);
 }
});
test('separate lists keep independent starts and later markers never reset the first start',()=>{
 for(const html of outputs('3. third\n9. fourth\n1. fifth\n\nParagraph\n\n0. zero\n7. next')){
  const doc=dom(html);assert.deepEqual(starts(doc),[3,0]);assert.deepEqual(items(doc),['third','fourth','fifth','zero','next']);
  assert.equal(doc.querySelectorAll('li[value]').length,0);assert.equal(doc.querySelector('p').textContent,'Paragraph');
 }
});
test('ordered markers are bounded to nine digits and larger or signed markers remain inert text',()=>{
 for(const html of outputs('999999999. final supported marker'))assert.deepEqual(starts(dom(html)),[999999999]);
 for(const text of ['1000000000. too large','999999999999999999999999. not a list','-1. negative','+3. signed'])for(const html of outputs(text)){
  const doc=dom(html);assert.equal(doc.querySelectorAll('ol,ul').length,0);assert.equal(doc.body.textContent,text);
 }
 for(const html of outputs('3. valid\n1000000000. literal tail')){
  const doc=dom(html);assert.deepEqual(starts(doc),[3]);assert.equal(doc.querySelector('p').textContent,'1000000000. literal tail');
 }
});
test('fenced list examples stay code and list text cannot inject attributes or executable markup',()=>{
 const text='```md\n3. literal\n4. example\n```\n\n3. **safe** <img src=x onerror=evil()>\n4. [guarded](https://example.org/list)';
 for(const html of outputs(text)){
  const doc=dom(html);assert.equal(doc.querySelector('pre code').textContent,'3. literal\n4. example');assert.deepEqual(starts(doc),[3]);
  assert.equal(doc.querySelector('li strong').textContent,'safe');assert.equal(doc.querySelectorAll('img,script,iframe,[onerror],[onclick]').length,0);
  assert.match(doc.querySelector('li').textContent,/<img src=x onerror=evil\(\)>/);assert.deepEqual([...doc.querySelector('ol').attributes].map(a=>a.name),['start']);
 }
 assert.deepEqual(renderer.markdownExternalLinks(text,origin),['https://example.org/list']);
});
test('paragraph, heading and table boundaries still keep numbered steps as their own blocks',()=>{
 const text='Before\n3. third\n4. fourth\n## Next\n\n| A | B |\n| --- | --- |\n| one | two |\n0. zero';
 for(const html of outputs(text)){
  const doc=dom(html);assert.deepEqual(starts(doc),[3,0]);assert.equal(doc.querySelector('p').textContent,'Before');assert.equal(doc.querySelector('h2').textContent,'Next');
  assert.equal(doc.querySelectorAll('table').length,1);assert.deepEqual(items(doc),['third','fourth','zero']);
 }
});

function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_articles.sql','utf8'));function prepare(sql,args=[]){return {bind(...a){return prepare(sql,a)},async all(){return {success:true,results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){db.prepare(sql).run(...args);return {success:true}}};}return {prepare};}
const worker=createWorker({verifyOwner:async()=>({ok:true,status:200})});
const article={id:'629114e0-e266-4a55-8aa3-00694d0d0335',title:'合成の番号付き手順',sourceUrl:'https://example.org/source',published:true,rightsConfirmed:true};
async function publish(text,published=true){const env={DB:database()};const response=await worker.fetch(new Request(origin+'/api/articles',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...article,markdown:text,published})}),env);assert.equal(response.status,200);return env;}
async function read(path,env){return worker.fetch(new Request(origin+path),env);}
test('public page and exact HTML export preserve starts without rewriting stored or exported Markdown',async()=>{
 const text='## 合成の手順\n\n3. third\n4. fourth\n\nParagraph\n\n0. zero\n1. next';const env=await publish(text);
 const html=await (await read('/p/'+article.id,env)).text(),download=await read('/export/'+article.id+'?format=html',env);
 assert.equal(await download.text(),html);assert.deepEqual(starts(dom(html)),[3,0]);assert.equal(dom(html).querySelectorAll('script,img,iframe').length,0);
 const saved=await (await read('/api/articles',env)).json();assert.equal(saved.articles[0].markdown,text);
 assert.equal(await (await read('/export/'+article.id+'?format=md',env)).text(),exportMarkdown({...article,source_url:article.sourceUrl,markdown:text}));
 assert.equal(download.headers.get('cache-control'),'no-store, no-transform');
});
test('private numbered instructions remain unavailable on public and HTML export routes',async()=>{
 const env=await publish('3. private step',false);
 for(const path of ['/p/'+article.id,'/export/'+article.id+'?format=html'])assert.equal((await read(path,env)).status,404);
});
