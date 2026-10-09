export class IngestError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const REDIRECTS=new Set([301,302,303,307,308]);
export function allowedUrl(value,hosts,ownHost='') {
 let url;try{url=new URL(value);}catch{throw new IngestError('公開HTTPSのURLを入力してください。');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname.endsWith('.')||/[\u0000-\u0020\\]/.test(value))throw new IngestError('HTTPS・認証情報なし・標準ポートのURLに限定しています。');
 const host=url.hostname.toLowerCase();
 if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)||!host.includes('.')||/^\d+(\.\d+){3}$/.test(host)||host===ownHost||/(^|\.)(localhost|local|internal|lan|home|invalid|test)$/.test(host))throw new IngestError('内部向け・IPアドレス・このサイト自身のURLは取得できません。');
 const allowed=new Set(String(hosts||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
 if(!allowed.size)throw new IngestError('URL変換の取得先がまだ設定されていません。',503);
 if(!allowed.has(host))throw new IngestError('この取得先はまだ許可されていません。',422);
 for(const key of url.searchParams.keys())if(/^(access_token|token|api_?key|authorization|password|secret|signature|sig)$/i.test(key))throw new IngestError('認証用の情報を含むURLは取得できません。');
 url.hash='';return url;
}
export async function readBounded(response,maxBytes) {
 const declared=Number(response.headers.get('content-length')||0);
 if(declared>maxBytes){await response.body?.cancel();throw new IngestError('本文のサイズ上限を超えています。',413);}
 if(!response.body)return new Uint8Array();
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new IngestError('本文のサイズ上限を超えています。',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.byteLength;}return result;
}
export async function fetchPublicHtml(value,{allowedHosts,ownHost='',fetcher=fetch,maxBytes=1000000,timeoutMs=10000,maxRedirects=3}={}) {
 let url=allowedUrl(value,allowedHosts,ownHost);const seen=new Set();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try {
  for(let hop=0;;hop++){
   if(seen.has(url.href))throw new IngestError('転送がループしています。');seen.add(url.href);
   const response=await fetcher(url.href,{method:'GET',redirect:'manual',headers:{Accept:'text/html, application/xhtml+xml;q=0.9','User-Agent':'Yomudake/1.0'},signal:controller.signal});
   if(REDIRECTS.has(response.status)){
    const location=response.headers.get('location');await response.body?.cancel();
    if(!location||hop>=maxRedirects)throw new IngestError('転送回数の上限を超えたか、転送先が不正です。');
    url=allowedUrl(new URL(location,url).href,allowedHosts,ownHost);continue;
   }
   if(!response.ok){await response.body?.cancel();throw new IngestError(`取得元がHTTP ${response.status}を返しました。認証・アクセス制限は回避しません。`,422);}
   const type=response.headers.get('content-type')||'';
   if(!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(type)){await response.body?.cancel();throw new IngestError('現在はHTMLの記事だけに対応しています。',415);}
   const bytes=await readBounded(response,maxBytes);return {html:new TextDecoder().decode(bytes),sourceUrl:url.href};
  }
 }catch(error){if(controller.signal.aborted)throw new IngestError('取得がタイムアウトしました。',504);throw error;}finally{clearTimeout(timer);}
}
