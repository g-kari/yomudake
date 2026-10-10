import test from 'node:test';
import assert from 'node:assert/strict';
import {articleLink,articleRevision,confirmationUrl,exportMarkdown} from '../src/navigation.mjs';
const origin='https://reader.example';
test('navigation admits local anchors and own-origin paths without loosening HTTP policy',()=>{
 for(const value of ['#section','/p/sample-safe-reading','https://reader.example/p/sample-safe-reading'])assert.equal(articleLink(value,origin)?.external,false,value);
 assert.equal(articleLink('https://example.org/note',origin)?.external,true);
 for(const value of ['//evil.example/','/\\evil.example/','javascript:alert(1)','data:text/html,hello','https://user:password@example.org/','https://example.org:444/','http://127.0.0.1/','https://private.local/','https://example.org/?token=private','https://example.org/?SIG=private','https://example.org/\nother'])assert.equal(articleLink(value,origin),null,value);
 assert.equal(articleLink('/local'),null);
 assert.equal(articleLink('http://127.0.0.1:4179/out/id/source?rev=public','http://127.0.0.1:4179')?.external,false);
 assert.equal(articleLink('http://user:pass@127.0.0.1:4179/','http://127.0.0.1:4179'),null);
 assert.equal(articleLink('/p/example?token=private',origin),null);
});
test('Markdown export adds a non-injectable original source link and retains body bytes',()=>{
 const markdown='# Body\r\n\r\nOriginal **content**.\n';
 const article={source_url:'https://example.org/a)[injected](https://evil.example/)?q="value"',markdown};
 const exported=exportMarkdown(article);
 assert.ok(exported.startsWith('元の記事: [元ページを開く](https://example.org/a%29%5Binjected%5D%28https://evil.example/%29?q=%22value%22)'));
 assert.equal(exported.slice(exported.indexOf('\n\n---\n\n')+'\n\n---\n\n'.length),markdown);
 for(const source_url of ['',null,'javascript:alert(1)','https://example.org/?token=private'])assert.equal(exportMarkdown({...article,source_url}),markdown);
});
test('confirmation revisions bind source and body even when timestamps are equal',async()=>{
 const article={id:'fixture',updated_at:'2026-10-10T00:00:00Z',source_url:'https://example.org/a',markdown:'# Body'};
 const revision=await articleRevision(article);assert.match(revision,/^[0-9a-f]{64}$/);
 for(const changed of [{...article,source_url:'https://example.org/b'},{...article,markdown:'# New body'}])assert.notEqual(await articleRevision(changed),revision);
 const url=new URL(confirmationUrl(origin,article,'source',revision));assert.equal(url.pathname,'/out/fixture/source');assert.equal(url.searchParams.get('rev'),revision);assert.ok(!url.href.includes('example.org'));
});

test('curated illustration selection uses only the verified pool and supports bounded future variety',async()=>{
 const {warningArtworks,selectWarningArtwork}=await import('../src/warning-art.mjs');
 assert.equal(warningArtworks.length,1);assert.equal(selectWarningArtwork().id,'150221597');
 const synthetic=[{id:'synthetic-first'},{id:'synthetic-second'},{id:'synthetic-third'}];
 for(const [value,id] of [[0,'synthetic-first'],[0.4,'synthetic-second'],[0.99,'synthetic-third'],[-1,'synthetic-first'],[1,'synthetic-third'],[NaN,'synthetic-first']])assert.equal(selectWarningArtwork(()=>value,synthetic).id,id);
 assert.equal(selectWarningArtwork(()=>0,[]),null);
});
