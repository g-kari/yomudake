import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// Native workerd parses RequestInit before the synthetic outbound handler.
// This catches runtime-only failures that Node fetch and mocked fetchers hide.
let runtime,mode,calls;
before(async()=>{
 const bundle=await build({stdin:{contents:`
  import {convertUrl} from './src/conversion.mjs';
  export default {async fetch(){let aiCalls=0;try{
   const result=await convertUrl('https://article.example/start',{AI:{async toMarkdown(){aiCalls++;return {format:'markdown',data:'Synthetic fixture only'};}}});
   return Response.json({ok:true,sourceUrl:result.sourceUrl,markdown:result.markdown,aiCalls});
  }catch(error){return Response.json({ok:false,status:error.status,code:error.code,message:error.message,aiCalls});}}};
 `,sourcefile:'workers-dns-fixture.mjs',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false});
 runtime=new Miniflare({cf:false,workers:[{config:{name:'dns-fixture',compatibilityDate:'2026-10-09',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],manifest:{mainModule:'fixture.mjs',modules:{'fixture.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}}},dev:{outboundService:{type:'fetcher',handler:async request=>{
  const url=new URL(request.url);calls.push({url:url.href,redirect:request.redirect,headers:[...request.headers.keys()]});
  if(url.origin==='https://cloudflare-dns.com'&&url.pathname==='/dns-query'){
   assert.equal(request.method,'GET');assert.equal(request.headers.get('accept'),'application/dns-json');assert.equal(url.searchParams.get('name'),'article.example');
   if(mode==='dns-redirect')return new Response('',{status:302,headers:{location:'https://127.0.0.1/dns-query'}});
   const type=Number(url.searchParams.get('type'));assert.ok([1,28].includes(type));
   const name=mode==='dotless'?'article.example':'article.example.';
   return Response.json({Status:0,TC:false,Question:[{name,type}],Answer:type===1?[{name,type,data:'93.184.215.14'}]:mode==='mixed-private'?[{name,type,data:'::1'}]:[]});
  }
  if(url.origin==='https://article.example'){
   if(mode==='source-redirect'&&url.pathname==='/start')return new Response('',{status:302,headers:{location:'/final'}});
   assert.ok(['/start','/final'].includes(url.pathname));return new Response('<title>Synthetic</title><p>Self-authored fixture</p>',{headers:{'content-type':'text/html'}});
  }
  throw new Error('Unexpected fixture destination');
 }}}}]});
});
after(async()=>{await runtime?.dispose();});
async function run(value){mode=value;calls=[];return (await runtime.dispatchFetch('https://fixture.invalid/')).json();}
test('native Workers fetch accepts DNS preflight and dotless matching questions before conversion',async()=>{
 for(const value of ['normal','dotless']){const result=await run(value);assert.deepEqual(result,{ok:true,sourceUrl:'https://article.example/start',markdown:'Synthetic fixture only',aiCalls:1});assert.equal(calls.length,3);assert.equal(calls.filter(c=>c.url.startsWith('https://cloudflare-dns.com/')).length,2);}
});
test('native DNS redirect remains unfollowed and prevents source and AI calls',async()=>{
 const result=await run('dns-redirect');assert.equal(result.ok,false);assert.equal(result.status,502);assert.equal(result.aiCalls,0);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url.startsWith('https://cloudflare-dns.com/dns-query?')));
});
test('native mixed-family private DNS answer still blocks source and AI',async()=>{
 const result=await run('mixed-private');assert.equal(result.ok,false);assert.equal(result.status,422);assert.equal(result.aiCalls,0);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url.startsWith('https://cloudflare-dns.com/')));
});
test('native source redirects repeat both DNS checks before each public HTML hop',async()=>{
 const result=await run('source-redirect');assert.equal(result.ok,true);assert.equal(result.sourceUrl,'https://article.example/final');assert.equal(result.aiCalls,1);assert.equal(calls.length,6);assert.equal(calls.filter(c=>c.url.startsWith('https://cloudflare-dns.com/')).length,4);
});
