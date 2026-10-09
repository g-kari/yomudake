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
