import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIpAddress,publicHostname} from '../src/public-network.mjs';
import {assertPublicDns,fetchPublicHtml,allowedUrl} from '../src/fetch-html.mjs';
import {convertUrl} from '../src/conversion.mjs';
const public4='93.184.215.14',public6='2606:4700:4700::1111';
const resolver=async()=>[public4];
const page=body=>new Response(body||'<p>synthetic text</p>',{headers:{'content-type':'text/html'}});
const answer=(name,type,data)=>({name:name+'.',type,data,TTL:60});
const dnsFetcher=choose=>async value=>{const url=new URL(value),host=url.searchParams.get('name'),type=Number(url.searchParams.get('type'));return Response.json({Status:0,TC:false,Question:[{name:host+'.',type}],Answer:choose(type,host)});};
test('conservative IP classifier rejects special IPv4/IPv6 and accepts ordinary global addresses',()=>{
 for(const ip of ['0.0.0.0','0.255.255.255','10.0.0.0','10.255.255.255','100.64.0.0','100.127.255.255','127.0.0.1','169.254.169.254','172.16.0.0','172.31.255.255','192.0.0.9','192.0.2.1','192.88.99.2','192.168.0.1','198.18.0.0','198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','239.255.255.255','240.0.0.0','255.255.255.255','::','::1','::ffff:8.8.8.8','64:ff9b::808:808','100::1','2001::1','2001:1::1','2001:db8::1','2002:0808:0808::1','3fff::1','3ffe::1','3000::1','2d00::1','2001:1000::1','5f00::1','fc00::1','fdff::1','fe80::1','ff02::1','2606:4700::1%eth0','01.2.3.4','999.1.1.1','1.2.3','2606:::1'])assert.equal(publicIpAddress(ip),false,ip);
 for(const ip of [public4,'8.8.8.8','100.63.255.255','100.128.0.0','172.15.255.255','172.32.0.0','223.255.255.255',public6,'2001:4860:4860::8888','2606:4700:4700:0:0:0:0:1111','2606:4700::0808:0808','2410::1'])assert.equal(publicIpAddress(ip),true,ip);
 assert.equal(publicIpAddress(public6,4),false);assert.equal(publicIpAddress(public4,6),false);
});
test('canonical URL checks deny encoded/numeric IPs, labels, controls, private names and secrets',()=>{
 for(const url of ['https://0x7f000001/','https://0177.0.0.1/','https://%31%32%37.0.0.1/','https://[::ffff:127.0.0.1]/','https://a..example.com/','https://-a.example.com/','https://a-.example.com/','https://x.home.arpa/','https://x.localdomain/','https://example.com\\@evil.example/','https://example.com/\u007f','https://%65xample.com/','https://example.com/?API_KEY=x'])assert.throws(()=>allowedUrl(url),url);
 assert.throws(()=>allowedUrl('https://'+'a'.repeat(64)+'.example/'));assert.throws(()=>allowedUrl('https://example.com/'+ 'a'.repeat(2048)));
 assert.equal(allowedUrl('https://EXAMPLE.com:443/a#anchor').href,'https://example.com/a');assert.ok(publicHostname(allowedUrl('https://例え.jp/').hostname));
});
test('fixed Cloudflare resolver checks both families and supports A-only, AAAA-only and CNAME chains',async()=>{
 const calls=[];const delegate=dnsFetcher((type,host)=>[answer(host,5,'cdn.example.'),...(type===1?[answer('cdn.example',1,public4)]:[])]);
 const addresses=await assertPublicDns('article.example',{fetcher:async(url,options)=>{calls.push({url,options});return delegate(url);}});assert.deepEqual(addresses,[public4]);assert.equal(calls.length,2);
 for(const call of calls){assert.equal(new URL(call.url).origin,'https://cloudflare-dns.com');assert.equal(new URL(call.url).pathname,'/dns-query');assert.equal(call.options.redirect,'error');assert.deepEqual(call.options.headers,{Accept:'application/dns-json'});assert.equal(call.options.method,'GET');}
 assert.deepEqual(await assertPublicDns('article.example',{fetcher:dnsFetcher((type,host)=>type===28?[answer(host,28,public6)]:[])}),[public6]);
 assert.deepEqual(await assertPublicDns('article.example',{fetcher:dnsFetcher((type,host)=>[answer(host,5,'cdn.example.'),...(type===28?[answer('cdn.example',28,public6)]:[])])}),[public6]);
});
test('DNS preflight rejects mixed private answers, wrong families, unrelated records and bad CNAME chains',async()=>{
 const cases=[
  (t,h)=>t===1?[answer(h,1,public4),answer(h,1,'10.0.0.1')]:[],
  (t,h)=>t===28?[answer(h,28,'::ffff:127.0.0.1')]:[],
  (t,h)=>t===1?[answer(h,1,public6)]:[],
  (t,h)=>t===1?[answer('unrelated.example',1,public4)]:[],
  (t,h)=>t===1?[answer(h,5,'metadata.google.internal.'),answer('metadata.google.internal',1,public4)]:[],
  (t,h)=>t===1?[answer(h,5,'cdn.example.')]:[],
  (t,h)=>t===1?[answer(h,5,'cdn.example.'),answer('cdn.example',5,h+'.')]:[],
  (t,h)=>t===1?[answer(h,5,'cdn.example.'),answer(h,1,public4),answer('cdn.example',1,public4)]:[],
  ()=>[]
 ];for(const choose of cases)await assert.rejects(assertPublicDns('article.example',{fetcher:dnsFetcher(choose)}));
});
test('DNS errors, one-family failures, truncation, malformed/oversized and redirected replies fail closed',async()=>{
 for(const data of [{Status:3,TC:false},{Status:0,TC:true},{Status:0,TC:false,Question:[{name:'wrong.example.',type:1}]}])await assert.rejects(assertPublicDns('article.example',{fetcher:async()=>Response.json(data)}));
 await assert.rejects(assertPublicDns('article.example',{fetcher:async url=>Number(new URL(url).searchParams.get('type'))===1?dnsFetcher((t,h)=>[answer(h,t,public4)])(url):new Response('',{status:502})}));
 await assert.rejects(assertPublicDns('article.example',{fetcher:async()=>new Response('not-json')}));
 await assert.rejects(assertPublicDns('article.example',{fetcher:async()=>new Response('x'.repeat(33000))}));
 await assert.rejects(assertPublicDns('article.example',{fetcher:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/'}})}));
});
test('redirects recheck DNS even on the same host and reject unsafe destinations before target calls',async()=>{
 const hosts=[],calls=[];let count=0;
 await assert.rejects(fetchPublicHtml('https://article.example/start',{resolveHostname:async host=>{hosts.push(host);return ++count===1?[public4]:['127.0.0.1'];},fetcher:async url=>{calls.push(url);return new Response('',{status:302,headers:{location:'/next'}});}}));assert.equal(calls.length,1);assert.deepEqual(hosts,['article.example','article.example']);
 for(const target of ['https://[::1]/','https://2130706433/','https://user:password@public.example/','https://reader.example/admin','https://public.example:8443/']){let count=0;await assert.rejects(fetchPublicHtml('https://article.example/start',{ownHost:'reader.example',resolveHostname:resolver,fetcher:async()=>{count++;return new Response('',{status:302,headers:{location:target}});}}));assert.equal(count,1);}
});
test('one acquisition deadline covers stalled DNS and stalled streamed body, cancelling readers',async()=>{
 let calls=0;await assert.rejects(fetchPublicHtml('https://article.example/',{timeoutMs:10,resolveHostname:()=>new Promise(()=>{}),fetcher:async()=>{calls++;return page();}}),error=>error.status===504);assert.equal(calls,0);
 let cancelled=false;await assert.rejects(fetchPublicHtml('https://article.example/',{timeoutMs:10,resolveHostname:resolver,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([60,112,62]));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}})}),error=>error.status===504);assert.ok(cancelled);
});
test('stream size caps count body-reader bytes even with a small compressed Content-Length',async()=>{
 let cancelled=false;await assert.rejects(fetchPublicHtml('https://article.example/',{maxBytes:10,resolveHostname:resolver,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(6));c.enqueue(new Uint8Array(6));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html','content-encoding':'gzip','content-length':'5'}})}),error=>error.status===413);assert.ok(cancelled);
});
test('HTTP charset and bounded meta charset decoding retain non-UTF8 article text',async()=>{
 const bytes=Uint8Array.from([60,112,62,0x82,0xa0,60,47,112,62]);const result=await fetchPublicHtml('https://article.example/',{resolveHostname:resolver,fetcher:async()=>new Response(bytes,{headers:{'content-type':'text/html; charset=shift_jis'}})});assert.ok(result.html.includes('あ'));
 await assert.rejects(fetchPublicHtml('https://article.example/',{resolveHostname:resolver,fetcher:async()=>new Response('x',{headers:{'content-type':'text/html; charset=not-an-encoding'}})}),error=>error.status===415);
});
test('sanitized-HTML expansion is capped before AI and AI wait is bounded without claiming backend cancellation',async()=>{
 let calls=0;await assert.rejects(convertUrl('https://article.example/',{AI:{toMarkdown(){calls++;}}},{resolveHostname:resolver,fetcher:async()=>page('<p>'+'<'.repeat(300000)+'</p>')}),error=>error.status===413);assert.equal(calls,0);
 await assert.rejects(convertUrl('https://article.example/',{AI:{toMarkdown(){return new Promise(()=>{});}}},{resolveHostname:resolver,fetcher:async()=>page(),conversionTimeoutMs:10}),error=>error.status===504);
});
