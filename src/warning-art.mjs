// Only metadata-verified, owner-approved Pixiv artwork IDs belong in this list.
// No live search, arbitrary URL input, direct image extraction or rehosting.
export const warningArtworks=Object.freeze([
 Object.freeze({id:'150221597',title:'やばいこれ毒かも！',author:'ジセイノク',authorUrl:'https://www.pixiv.net/en/users/83957688'})
]);
export function selectWarningArtwork(random=Math.random,pool=warningArtworks){
 if(!pool.length)return null;
 const value=random();const index=Number.isFinite(value)?Math.max(0,Math.min(pool.length-1,Math.floor(value*pool.length))):0;
 return pool[index];
}
