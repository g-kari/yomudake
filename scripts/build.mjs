import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/worker.mjs'],bundle:true,platform:'browser',target:'es2022',format:'esm',outfile:'dist/worker.js',jsx:'automatic',minify:true,external:['cloudflare:workers']});
await build({entryPoints:['client/index.tsx'],bundle:true,platform:'browser',target:'es2022',format:'iife',outfile:'public/editor.js',jsx:'automatic',minify:true});
console.log('Cloudflare Worker and owner editor built. No deployment performed.');
