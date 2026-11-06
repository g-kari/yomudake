import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeConversionInput} from '../src/conversion.mjs';

const sourceUrl='https://article.example/original';
const wrap=content=>`<!doctype html><html><body><main>${content}</main></body></html>`;

test('sanitizer validates entity-decoded unsafe hrefs and preserves their labels',()=>{
 for(const href of [
  'jav&#x61;script&colon;alert(1)',
  'data&colon;text/html,unsafe',
  'https&colon;//127.0.0.1/private',
 ]){
  const result=sanitizeConversionInput(`<p><a href="${href}">A &amp; B</a></p>`,sourceUrl);
  assert.deepEqual(result.links,[],href);
  assert.equal(result.html,wrap('<p>A &amp; B</p>'),href);
 }
});

test('sanitizer preserves decoded valid URLs only in its separate link map',()=>{
 const result=sanitizeConversionInput(
  '<p><a href="https&colon;//article.example/read?x=1&amp;y=2">A &amp; B</a>'
  +'<a href="&#47;next?x=1&#38;y=2">Next</a></p>',
  sourceUrl,
 );
 assert.deepEqual(result.links,[
  'https://article.example/read?x=1&y=2',
  'https://article.example/next?x=1&y=2',
 ]);
 assert.equal(result.html,wrap(
  '<p><a href="#yomudake-link-0">A &amp; B</a>'
  +'<a href="#yomudake-link-1">Next</a></p>',
 ));
});

test('sanitizer omits HTML descendants of malformed SVG integration-point content',()=>{
 const result=sanitizeConversionInput(
  '<p>Kept</p><svg><desc><b>Hidden</desc>'
  +'<a href="https://article.example/hidden">Still hidden</a>',
  sourceUrl,
 );
 // The malformed close leaves the descendants inside the omitted SVG subtree.
 assert.deepEqual(result.links,[]);
 assert.equal(result.html,wrap('<p>Kept</p>'));
});

test('sanitizer preserves supplementary Unicode and escapes decoded text once',()=>{
 const literal='𠮷'.repeat(20);
 const result=sanitizeConversionInput(
  `<p>${literal}&#x1F600; &NotEqualTilde; &lt;b&gt;&amp;&quot;&#39;</p>`,
  sourceUrl,
 );
 assert.deepEqual(result.links,[]);
 assert.equal(result.html,wrap(
  `<p>${literal}😀 \u2242\u0338 &lt;b&gt;&amp;&quot;&#39;</p>`,
 ));
});
