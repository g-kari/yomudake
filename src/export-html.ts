import React from 'react';
import {Markdown} from './markdown';
import {safeHttpUrl} from './security.mjs';
const tags=new Set(['div','span','p','h1','h2','h3','h4','h5','h6','strong','em','a','pre','code','ul','ol','li','blockquote','hr']);
function escape(s:string){return s.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));}
function serialize(node:React.ReactNode):string {
 if(node===null||node===undefined||typeof node==='boolean')return '';
 if(typeof node==='string'||typeof node==='number')return escape(String(node));
 if(Array.isArray(node))return node.map(serialize).join('');
 if(!React.isValidElement(node)||typeof node.type!=='string'||!tags.has(node.type))return '';
 const props=node.props as {children?:React.ReactNode;href?:string};
 const href=node.type==='a'?safeHttpUrl(props.href):null;
 const attrs=href?` href="${escape(href)}" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer"`:'';
 if(node.type==='hr')return '<hr>';
 return `<${node.type}${attrs}>${serialize(props.children)}</${node.type}>`;
}
export function markdownToHtml(text:string){return serialize(Markdown({text}));}
