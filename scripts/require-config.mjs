import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const allowedKeys=new Set(['$schema','name','main','account_id','compatibility_date','compatibility_flags','workers_dev','preview_urls','assets','d1_databases','ai','vars','limits','observability','routes']);
export function validateProductionConfig(config){
 if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Production config must be an object.');
 for(const key of Object.keys(config))if(!allowedKeys.has(key))throw new Error(`Unsupported production config key: ${key}. Private/VPC/service/browser/proxy bindings are not permitted by this reader's threat model.`);
 if(!config.compatibility_flags?.includes('global_fetch_strictly_public')||config.compatibility_flags.includes('global_fetch_private_origin'))throw new Error('Public-only global fetch routing must stay enabled.');
 if(config.workers_dev!==false||config.preview_urls!==false)throw new Error('workers.dev and preview URLs must remain disabled.');
 if(config.main!=='dist/worker.js'||config.name!=='yomudake')throw new Error('Unexpected Worker entry point or name.');
 if(!Array.isArray(config.routes)||!config.routes.length||config.routes.some(route=>typeof route!=='object'||typeof route.pattern!=='string'||!route.custom_domain||route.pattern.includes('*')))throw new Error('An exact approved custom-domain route is required.');
 if(!Array.isArray(config.d1_databases)||config.d1_databases.length!==1||config.d1_databases[0].binding!=='DB'||config.d1_databases[0].database_id==='00000000-0000-4000-8000-000000000000'||!config.d1_databases[0].database_id)throw new Error('Approved dedicated production D1 must be configured.');
 if(config.ai?.binding!=='AI'||config.assets?.binding!=='ASSETS'||config.assets?.run_worker_first!==true)throw new Error('Only the reviewed AI, DB and static asset binding layout is supported.');
 if(!config.vars?.ACCESS_TEAM_DOMAIN||!config.vars?.ACCESS_AUD||Object.keys(config.vars).some(key=>!['ACCESS_TEAM_DOMAIN','ACCESS_AUD'].includes(key)))throw new Error('Owner email is a runtime secret; only Access team and audience belong in config vars.');
 if(config.limits?.cpu_ms!==10)throw new Error('The reviewed CPU limit is 10ms. This is not a monetary limit.');
 return config;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!existsSync('wrangler.jsonc'))throw new Error('Approved production config missing. Configure only after resources, owner Access policy, hostname and usage conditions are approved.');
 // JSON is valid JSONC. Fail closed on comments/overrides rather than interpreting
 // a partial config; the example is JSON and needs only approved value changes.
 validateProductionConfig(JSON.parse(readFileSync('wrangler.jsonc','utf8')));
 console.log('Reviewed public-egress configuration present. Resource approval and live security tests are still required.');
}
