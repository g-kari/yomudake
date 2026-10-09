// Conservative special-purpose IP policy, checked against IANA on 2026-10-09.
// This is DNS preflight, not connection-IP pinning. Production global fetch must
// use Cloudflare's public Internet boundary, without private-network bindings.
export function publicHostname(value) {
 if(typeof value!=='string'||value.length>253||!value.includes('.'))return false;
 const host=value.toLowerCase();
 if(!host.split('.').every(label=>label.length>0&&label.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))return false;
 if(/(^|\.)(localhost|local|localdomain|internal|lan|home|invalid|test)$/.test(host)||host.endsWith('.home.arpa'))return false;
 // Includes URL-canonicalized numeric IPv4 and unqualified numeric names.
 return !/^\d+(\.\d+)*$/.test(host);
}
function ipv4(value) {
 if(!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value))return null;
 const bytes=value.split('.').map(Number);if(bytes.some(v=>v>255))return null;
 return bytes.reduce((result,v)=>(result<<8n)|BigInt(v),0n);
}
function ipv6(value) {
 if(!/^[0-9a-f:.]+$/i.test(value)||!value.includes(':'))return null;
 let input=value.toLowerCase();
 if(input.includes('.')){const at=input.lastIndexOf(':');const tail=ipv4(input.slice(at+1));if(tail===null)return null;input=input.slice(0,at+1)+(tail>>16n).toString(16)+':'+(tail&65535n).toString(16);}
 const halves=input.split('::');if(halves.length>2)return null;
 const cells=part=>part?part.split(':'):[];const left=cells(halves[0]),right=cells(halves[1]||'');
 if([...left,...right].some(v=>!/^[0-9a-f]{1,4}$/.test(v)))return null;
 const missing=8-left.length-right.length;
 if(halves.length===1&&missing!==0||halves.length===2&&missing<1)return null;
 return [...left,...Array(missing).fill('0'),...right].reduce((result,v)=>(result<<16n)|BigInt('0x'+v),0n);
}
const blocked4=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.88.99.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4'];
const blocked6=['2001::/23','2001:db8::/32','2002::/16','3fff::/20'];
// IANA IPv6 unicast ALLOCATED entries, snapshot 2026-10-09; omitted space
// remains reserved. Special-purpose allocations are still denied above.
const allocated6=['2001::/23','2001:200::/23','2001:400::/23','2001:600::/23','2001:800::/22','2001:c00::/23','2001:e00::/23','2001:1200::/23','2001:1400::/22','2001:1800::/23','2001:1a00::/23','2001:1c00::/22','2001:2000::/19','2001:4000::/23','2001:4200::/23','2001:4400::/23','2001:4600::/23','2001:4800::/23','2001:4a00::/23','2001:4c00::/23','2001:5000::/20','2001:8000::/19','2001:a000::/20','2001:b000::/20','2002::/16','2003::/18','2400::/12','2410::/12','2600::/12','2610::/23','2620::/23','2630::/12','2800::/12','2a00::/12','2a10::/12','2c00::/12'];
function compileRanges(list,width,parser){return list.map(cidr=>{const [base,prefix]=cidr.split('/');const shift=BigInt(width-Number(prefix));return {shift,base:parser(base)>>shift};});}
const deny4=compileRanges(blocked4,32,ipv4),deny6=compileRanges(blocked6,128,ipv6),allow6=compileRanges(allocated6,128,ipv6);
const matches=(value,list)=>list.some(range=>(value>>range.shift)===range.base);
export function publicIpAddress(value,expectedFamily) {
 if(typeof value!=='string')return false;
 const v4=ipv4(value);if(v4!==null)return expectedFamily!==6&&!matches(v4,deny4);
 const v6=ipv6(value);if(v6===null)return false;
 // Reject mapped, NAT64, local, multicast and future unallocated space.
 return expectedFamily!==4&&matches(v6,allow6)&&!matches(v6,deny6);
}
