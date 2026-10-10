import React from 'react';
import {Markdown} from './markdown';
import {articleLink} from './navigation.mjs';
const tags=new Set(['div','span','p','h1','h2','h3','h4','h5','h6','strong','em','a','pre','code','ul','ol','li','blockquote','hr']);
function escape(s:string){return s.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));}
function serialize(node:React.ReactNode,origin:string):string {
 if(node===null||node===undefined||typeof node==='boolean')return '';
 if(typeof node==='string'||typeof node==='number')return escape(String(node));
 if(Array.isArray(node))return node.map(n=>serialize(n,origin)).join('');
 if(!React.isValidElement(node)||typeof node.type!=='string'||!tags.has(node.type))return '';
 const props=node.props as {children?:React.ReactNode;href?:string;target?:string};
 const link=node.type==='a'?articleLink(props.href,origin):null;
 const attrs=link?` href="${escape(link.href)}"${props.target==='_blank'?' target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer"':''}`:'';
 if(node.type==='hr')return '<hr>';
 return `<${node.type}${attrs}>${serialize(props.children,origin)}</${node.type}>`;
}
export function markdownExternalLinks(text:string,origin:string){const links:string[]=[];Markdown({text,origin,renderExternal:(href)=>{links.push(href);return null;}});return links;}
export function markdownToHtml(text:string,{origin='',externalHref}:{origin?:string;externalHref?:(href:string,index:number)=>string}={}){
 let index=0;
 return serialize(Markdown({text,origin,...(externalHref?{renderExternal:(href:string,label:string,key:number)=>React.createElement('a',{key,href:externalHref(href,index++)},label)}:{})}),origin);
}
