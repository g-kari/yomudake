import {readFileSync,existsSync} from 'node:fs';
if(!existsSync('wrangler.jsonc'))throw new Error('Approved production config missing. Copy wrangler.example.jsonc only after resources, owner Access policy, hostname, and usage limits are approved.');
const raw=readFileSync('wrangler.jsonc','utf8');
if(raw.includes('00000000-0000-4000-8000-000000000000'))throw new Error('Production D1 is not configured.');
// Credentials and owner email must be supplied as runtime secrets, not committed source.
if(!/"routes"\s*:/.test(raw))throw new Error('Approved custom hostname route missing; workers.dev remains disabled.');
console.log('Production config present. Confirm resource approval and live Access JWT tests before deploying.');
