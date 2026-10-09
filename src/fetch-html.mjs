import {publicHostname,publicIpAddress} from './public-network.mjs';
export class IngestError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const REDIRECTS=new Set([301,302,303,307,308]);
export function allowedUrl(value,ownHost='') {
 if(typeof value!=='string'||value.length>2048)throw new IngestError('URLは2048文字以内で入力してください。');
 let url;try{url=new URL(value);}catch{throw new IngestError('公開HTTPSのURLを入力してください。');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname.endsWith('.')||/[\u0000-\u0020\u007f\\]/.test(value)||/%/.test(value.split('/')[2]||''))throw new IngestError('HTTPS・認証情報なし・標準ポートのURLに限定しています。');
 const host=url.hostname.toLowerCase();
 if(!publicHostname(host)||host===ownHost.toLowerCase())throw new IngestError('内部向け・IPアドレス・このサイト自身のURLは取得できません。');
 for(const key of url.searchParams.keys())if(/^(access_token|token|api_?key|authorization|password|secret|signature|sig)$/i.test(key))throw new IngestError('認証用の情報を含むURLは取得できません。');
 url.hash='';return url;
}
export function withAbort(promise,signal){
 if(!signal)return promise;
 const pending=Promise.resolve(promise);
 return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));if(signal.aborted){void pending.catch(()=>{});abort();return;}signal.addEventListener('abort',abort,{once:true});pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
export async function readBounded(response,maxBytes,signal) {
 const declared=Number(response.headers.get('content-length')||0);
 if(declared>maxBytes){await response.body?.cancel();throw new IngestError('本文のサイズ上限を超えています。',413);}
 if(!response.body)return new Uint8Array();
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{for(;;){const {done,value}=await withAbort(reader.read(),signal);if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new IngestError('本文のサイズ上限を超えています。',413);}chunks.push(value);}}catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.byteLength;}return result;
}
export async function assertPublicDns(host,{fetcher=fetch,signal}={}) {
 const replies=await Promise.all([1,28].map(async type=>{
  const query=new URL('https://cloudflare-dns.com/dns-query');query.searchParams.set('name',host);query.searchParams.set('type',String(type));
  const response=await withAbort(fetcher(query.href,{method:'GET',redirect:'error',headers:{Accept:'application/dns-json'},signal}),signal);
  if(!response.ok){await response.body?.cancel();throw new IngestError('公開DNSの確認に失敗しました。',502);}
  let data;try{data=JSON.parse(new TextDecoder().decode(await readBounded(response,32768,signal)));}catch(error){if(signal?.aborted)throw error;throw new IngestError('公開DNSの応答が不正です。',502);}
  if(data?.Status!==0||data.TC!==false||!Array.isArray(data.Question)||data.Question.length!==1||typeof data.Question[0]?.name!=='string'||data.Question[0].name.toLowerCase()!==host+'.'||data.Question[0].type!==type||data.Answer!==undefined&&!Array.isArray(data.Answer)||data.Answer?.length>64)throw new IngestError('公開DNSを確認できませんでした。',422);
  const aliases=new Map(),records=new Map(),owners=new Set();
  for(const record of data.Answer||[]){
   const owner=typeof record?.name==='string'?record.name.toLowerCase().replace(/\.$/,''):'';if(!publicHostname(owner))throw new IngestError('公開DNSの応答が不正です。',502);owners.add(owner);
   if(record.type===5){const alias=typeof record.data==='string'?record.data.toLowerCase().replace(/\.$/,''):'';if(!publicHostname(alias)||aliases.has(owner)&&aliases.get(owner)!==alias)throw new IngestError('内部向け・不正なDNS転送は取得できません。',422);aliases.set(owner,alias);}
   else if(record.type===1||record.type===28){if(record.type!==type||!publicIpAddress(record.data,record.type===1?4:6))throw new IngestError('非公開・特殊用途のIPへ向くURLは取得できません。',422);records.set(owner,[...(records.get(owner)||[]),record.data]);}
   else throw new IngestError('公開DNSの応答が不正です。',502);
  }
  const chain=new Set();let terminal=host;
  while(aliases.has(terminal)){if(chain.has(terminal)||chain.size>=8||records.has(terminal))throw new IngestError('DNS転送が不正か、長すぎます。',422);chain.add(terminal);terminal=aliases.get(terminal);}
  chain.add(terminal);if([...owners].some(owner=>!chain.has(owner)))throw new IngestError('取得先と無関係なDNS応答です。',422);
  // A valid CNAME chain may end in NOERROR/NODATA for one address family.
  // At least one terminal global address across both families is required below.
  return records.get(terminal)||[];
 }));
 const addresses=replies.flat();if(!addresses.length)throw new IngestError('公開IPを確認できませんでした。',422);return addresses;
}
export async function fetchPublicHtml(value,{ownHost='',fetcher=fetch,resolveHostname=assertPublicDns,maxBytes=1000000,timeoutMs=10000,maxRedirects=3}={}) {
 let url=allowedUrl(value,ownHost);const seen=new Set();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try {
  for(let hop=0;;hop++){
   if(seen.has(url.href))throw new IngestError('転送がループしています。');seen.add(url.href);
   const addresses=await withAbort(resolveHostname(url.hostname,{fetcher,signal:controller.signal}),controller.signal);
   if(!Array.isArray(addresses)||!addresses.length||addresses.some(address=>!publicIpAddress(address)))throw new IngestError('公開IPを確認できませんでした。',422);
   const response=await withAbort(fetcher(url.href,{method:'GET',redirect:'manual',headers:{Accept:'text/html, application/xhtml+xml;q=0.9','User-Agent':'Yomudake/1.0'},signal:controller.signal}),controller.signal);
   if(REDIRECTS.has(response.status)){
    const location=response.headers.get('location');await response.body?.cancel();
    if(!location||hop>=maxRedirects)throw new IngestError('転送回数の上限を超えたか、転送先が不正です。');
    url=allowedUrl(new URL(location,url).href,ownHost);continue;
   }
   if(!response.ok){await response.body?.cancel();throw new IngestError(`取得元がHTTP ${response.status}を返しました。認証・アクセス制限は回避しません。`,422);}
   const type=response.headers.get('content-type')||'';
   if(!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(type)){await response.body?.cancel();throw new IngestError('現在はHTMLの記事だけに対応しています。',415);}
   const bytes=await readBounded(response,maxBytes,controller.signal);
   // HTTP charset takes precedence; otherwise use a bounded HTML meta sniff.
   const prefix=new TextDecoder().decode(bytes.slice(0,1024));
   const declared=/charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(type)?.[1];
   const meta=/<meta\b[^>]*\bcharset\s*=\s*["']?([a-z0-9_-]+)/i.exec(prefix)?.[1];
   let body;try{body=new TextDecoder(declared||meta||'utf-8').decode(bytes);}catch{throw new IngestError('この記事の文字コードには対応していません。',415);}
   return {html:body,sourceUrl:url.href};
  }
 }catch(error){if(controller.signal.aborted)throw new IngestError('取得がタイムアウトしました。',504);throw error;}finally{clearTimeout(timer);controller.abort();}
}
