import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProductionConfig} from '../scripts/require-config.mjs';
function config(){const data=JSON.parse(readFileSync('wrangler.example.jsonc'));data.d1_databases[0].database_id='c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d';data.routes=[{pattern:'reader.example',custom_domain:true}];data.vars={ACCESS_TEAM_DOMAIN:'synthetic.cloudflareaccess.com',ACCESS_AUD:'synthetic-audience'};return data;}
test('deploy preflight enforces public-only routing and the reviewed binding layout',()=>{
 assert.ok(validateProductionConfig(config()));
 for(const key of ['vpc_networks','vpc_services','services','browser','unsafe','env','hyperdrive','mtls_certificates','dispatch_namespaces'])assert.throws(()=>validateProductionConfig({...config(),[key]:[]}));
 assert.throws(()=>validateProductionConfig({...config(),compatibility_flags:['nodejs_compat']}));assert.throws(()=>validateProductionConfig({...config(),compatibility_flags:['global_fetch_strictly_public','global_fetch_private_origin']}));
 for(const key of ['workers_dev','preview_urls'])assert.throws(()=>validateProductionConfig({...config(),[key]:true}));
 assert.throws(()=>validateProductionConfig({...config(),vars:{...config().vars,OWNER_EMAIL:'synthetic@example.com'}}));assert.throws(()=>validateProductionConfig({...config(),routes:[{pattern:'*.example',custom_domain:true}]}));
 assert.throws(()=>validateProductionConfig(JSON.parse(readFileSync('wrangler.example.jsonc'))));
});


test('approved MCP limiter and audience are narrowly checked',()=>{
 const base=config(),ratelimits=[{name:'MCP_RATE_LIMITER',namespace_id:'58001',simple:{limit:6,period:60}}];assert.ok(validateProductionConfig({...base,ratelimits,vars:{...base.vars,MCP_ACCESS_AUD:'synthetic-mcp-aud'}}));
 for(const value of [[],[...ratelimits,...ratelimits],[{...ratelimits[0],name:'OTHER'}],[{...ratelimits[0],namespace_id:'0'}],[{...ratelimits[0],namespace_id:'58002'}],[{...ratelimits[0],simple:{limit:60,period:60}}],[{...ratelimits[0],simple:{limit:6,period:10}}]])assert.throws(()=>validateProductionConfig({...base,ratelimits:value}));
 for(const MCP_ACCESS_AUD of ['',null,'wrong audience',base.vars.ACCESS_AUD])assert.throws(()=>validateProductionConfig({...base,vars:{...base.vars,MCP_ACCESS_AUD}}));
});
