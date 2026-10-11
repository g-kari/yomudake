import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
test('approved MCP limiter works in pinned native workerd without external services',async()=>{
 const config=JSON.parse(readFileSync('wrangler.jsonc'));
 const binding=config.ratelimits.find(x=>x.name==='MCP_RATE_LIMITER');
 assert.deepEqual(binding,{name:'MCP_RATE_LIMITER',namespace_id:'58001',simple:{limit:6,period:60}});
 const code="export default {async fetch(request,env){const outcome=await env.MCP_RATE_LIMITER.limit({key:'yomudake-owner-tools'});return Response.json(outcome);}};";
 const mf=new Miniflare({cf:false,workers:[{config:{name:'synthetic-mcp-limiter',compatibilityDate:config.compatibility_date,manifest:{mainModule:'fixture.mjs',modules:{'fixture.mjs':{type:'esm',contents:code}}},env:{MCP_RATE_LIMITER:{type:'rate-limit',namespace:binding.namespace_id,simple:binding.simple}}},dev:{outboundService:{type:'fetcher',handler:async()=>{throw new Error('No external network permitted');}}}}]});
 try{
  for(let i=0;i<6;i++)assert.equal((await (await mf.dispatchFetch('https://fixture.example/')).json()).success,true);
  assert.equal((await (await mf.dispatchFetch('https://fixture.example/')).json()).success,false);
 }finally{await mf.dispose();}
});
