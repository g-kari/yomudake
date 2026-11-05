import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreLinks,convertUrl} from '../src/conversion.mjs';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/export-html.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/converted-links-test.mjs',jsx:'automatic'});
const {markdownToHtml,markdownExternalLinks}=await import('../.sites-runtime/converted-links-test.mjs');
const origin='https://reader.example';
const destinations=[
 'https://article.example/Function_(math)?kind=a|b&kept=%28encoded%29#part(2)',
 'https://article.example/only(parentheses)',
 'https://article.example/only?kind=a|b',
 'https://article.example/%28encoded%29?x=%7C&double=%2528',
 'https://article.example/plain?x=1&y=2',
];
test('converted paragraph and table links render the exact original URI',()=>{
 for(const destination of destinations){
  const link=restoreLinks('[出典](#yomudake-link-0)',[destination]);
  for(const markdown of [link,'| 出典 | 説明 |\n| --- | --- |\n| '+link+' | 保持 |']){
   assert.deepEqual(markdownExternalLinks(markdown,origin),[destination]);
   const html=markdownToHtml(markdown,{origin});
   assert.ok(html.includes('href="'+destination.replace(/&/g,'&amp;').replace(/'/g,'&#39;')+'"'));
   assert.equal((html.match(/<a /g)||[]).length,1);
   if(markdown.startsWith('|')){assert.equal((html.match(/<td/g)||[]).length,2);assert.match(html,/<td>保持<\/td>/);}
  }
 }
});
test('conversion and the outbound-link selector retain URL bytes after synthetic AI',async()=>{
 const source='<article>'+destinations.map((href,index)=>'<p><a href="'+href.replace(/&/g,'&amp;')+'">出典'+index+'</a></p>').join('')+'</article>';
 const markdown=destinations.map((_,index)=>'[出典'+index+'](#yomudake-link-'+index+')').join('\n\n');
 const result=await convertUrl('https://article.example/original',{AI:{async toMarkdown(){return {format:'markdown',data:markdown};}}},{resolveHostname:async()=>['93.184.215.14'],fetcher:async()=>new Response(source,{headers:{'content-type':'text/html'}})});
 assert.deepEqual(markdownExternalLinks(result.markdown,origin),destinations);
});
test('angle destinations retain the existing link safety and inert image policy',()=>{
 for(const markdown of ['[x](<https://article.example/path)','[x](<https://article.example/path>suffix)','[x](<<https://article.example/path>>)','[x](<https://article.example/space path>)','[x](<https://article.example/a<bc>)','[x](<https://article.example/a>>)','[x](<https://article.example/path>suffix>)']){
  assert.deepEqual(markdownExternalLinks(markdown,origin),[]);
  assert.equal(markdownToHtml(markdown,{origin}).includes('<a '),false);
 }
 for(const destination of ['javascript:alert(1)','data:text/html,evil','//evil.example/path','https://user:secret@article.example/a','https://127.0.0.1/a']){
  assert.deepEqual(markdownExternalLinks('[unsafe](<'+destination+'>)',origin),[]);
  assert.equal(markdownToHtml('[unsafe](<'+destination+'>)',{origin}).includes('<a '),false);
 }
 assert.deepEqual(markdownExternalLinks('![画像](<https://article.example/a(b)>)',origin),[]);
});
