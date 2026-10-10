import test from 'node:test';
import assert from 'node:assert/strict';
import {convertUrl} from '../src/conversion.mjs';
import {fetchPublicHtml,IngestError} from '../src/fetch-html.mjs';

const source='https://x.com/synthetic/status/123?s=20';
const resolveHostname=async()=>['93.184.215.14'];
const page=()=>new Response('<title>Synthetic</title><p>Self-authored fixture</p>',{headers:{'content-type':'text/html'}});
const privateError=new Error('Cookie=private-synthetic-cookie; https://private.example/?token=private-synthetic-token; private article');
const rejects=async(promise,status,code)=>{
 await assert.rejects(promise,error=>{
  assert.ok(error instanceof IngestError);
  assert.equal(error.status,status);assert.equal(error.code,code);
  assert.ok(!error.message.includes('private'));
  assert.ok(!error.cause);
  return true;
 });
};

test('DNS transport failures are classified before fetching the source or invoking AI',async()=>{
 let sourceCalls=0,aiCalls=0;
 await rejects(convertUrl(source,{AI:{toMarkdown(){aiCalls++;}}},{resolveHostname:async()=>{throw privateError;},fetcher:async()=>{sourceCalls++;return page();}}),502,'SOURCE_DNS_ERROR');
 assert.equal(sourceCalls,0);assert.equal(aiCalls,0);
});
test('X-shaped source transport failures are distinct from conversion-service failures',async()=>{
 let sourceCalls=0,aiCalls=0;
 await rejects(convertUrl(source,{AI:{toMarkdown(){aiCalls++;}}},{resolveHostname,fetcher:async()=>{sourceCalls++;throw privateError;}}),502,'SOURCE_CONNECTION_ERROR');
 assert.equal(sourceCalls,1);assert.equal(aiCalls,0);
});
test('source streaming failures are classified without exposing upstream details',async()=>{
 let cancelled=false;
 await rejects(fetchPublicHtml(source,{resolveHostname,fetcher:async()=>new Response(new ReadableStream({pull(){throw privateError;},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}})}),502,'SOURCE_CONNECTION_ERROR');
 // An errored stream is already closed by the runtime, rather than cancellable.
 assert.equal(cancelled,false);
});
test('conversion-service synchronous and asynchronous exceptions hide upstream details',async()=>{
 for(const toMarkdown of [()=>{throw privateError;},async()=>{throw privateError;}]){
  await rejects(convertUrl(source,{AI:{toMarkdown}},{resolveHostname,fetcher:async()=>page()}),502,'CONVERSION_SERVICE_ERROR');
 }
});
test('missing or non-callable AI binding stops before any source request',async()=>{
 for(const AI of [undefined,{}, {toMarkdown:'not-callable'}]){
  let calls=0;
  await rejects(convertUrl(source,{AI},{fetcher:async()=>{calls++;return page();}}),503,'CONVERSION_BINDING_MISSING');assert.equal(calls,0);
 }
});
test('error or malformed conversion results expose only a fixed result-failure code',async()=>{
 for(const result of [undefined,{format:'error',error:privateError.message}, {format:'markdown',data:{private:'text'}}]){
  await rejects(convertUrl(source,{AI:{toMarkdown:async()=>result}},{resolveHostname,fetcher:async()=>page()}),502,'CONVERSION_RESULT_ERROR');
 }
});
test('HTTP source restrictions keep their existing status and never retry or call AI',async()=>{
 for(const status of [401,403,429,503]){
  let calls=0,aiCalls=0;
  await rejects(convertUrl(source,{AI:{toMarkdown(){aiCalls++;}}},{resolveHostname,fetcher:async()=>{calls++;return new Response('Private error body',{status});}}),422,undefined);
  assert.equal(calls,1);assert.equal(aiCalls,0);
 }
});
test('DNS/source/AI deadlines remain timeouts without retrying or reclassifying them',async()=>{
 await rejects(fetchPublicHtml(source,{timeoutMs:5,resolveHostname:()=>new Promise(()=>{}),fetcher:async()=>page()}),504,undefined);
 await rejects(fetchPublicHtml(source,{timeoutMs:5,resolveHostname,fetcher:()=>new Promise(()=>{})}),504,undefined);
 await rejects(convertUrl(source,{AI:{toMarkdown:()=>new Promise(()=>{})}},{conversionTimeoutMs:5,resolveHostname,fetcher:async()=>page()}),504,undefined);
});
test('arbitrary error codes cannot become response metadata',()=>{
 assert.equal(new IngestError('Fixed',502,privateError.message).code,undefined);
});
