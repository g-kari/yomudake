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
 const props=node.props as {children?:React.ReactNode;href?:string;target?:string;id?:string;tabIndex?:number};
 const link=node.type==='a'?articleLink(props.href,origin):null;
 const heading=/^h[1-6]$/.test(node.type)&&typeof props.id==='string'&&/^yomu-section-[1-9]\d*$/.test(props.id);
 const attrs=link?` href="${escape(link.href)}"${props.target==='_blank'?' target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer"':''}`:heading?` id="${props.id}" tabindex="-1"`:'';
 if(node.type==='hr')return '<hr>';
 return `<${node.type}${attrs}>${serialize(props.children,origin)}</${node.type}>`;
}
export function markdownExternalLinks(text:string,origin:string){const links:string[]=[];Markdown({text,origin,renderExternal:(href)=>{links.push(href);return null;}});return links;}
export type MarkdownHeading={id:string;level:number;label:string};
function plainText(node:React.ReactNode):string {
 if(typeof node==='string'||typeof node==='number')return String(node);
 if(Array.isArray(node))return node.map(plainText).join('');
 return React.isValidElement(node)?plainText((node.props as {children?:React.ReactNode}).children):'';
}
export function markdownToHtmlWithOutline(text:string,{origin='',externalHref}:{origin?:string;externalHref?:(href:string,index:number)=>string}={}){
 let index=0;
 const rendered=Markdown({text,origin,...(externalHref?{renderExternal:(href:string,label:string,key:number)=>React.createElement('a',{key,href:externalHref(href,index++)},label)}:{})});
 const outline:MarkdownHeading[]=[];
 // Read the same rendered nodes we serialize, rather than parsing Markdown a
 // second way. Fences, paragraph boundaries and outbound-link order stay shared.
 for(const node of rendered.props.children as React.ReactNode[]){
  if(!React.isValidElement(node)||typeof node.type!=='string'||!/^h[1-6]$/.test(node.type))continue;
  const props=node.props as {id:string;children?:React.ReactNode};
  outline.push({id:props.id,level:Number(node.type.slice(1)),label:plainText(props.children).trim()||`見出し ${outline.length+1}`});
 }
 return {html:serialize(rendered,origin),outline};
}
export function markdownToHtml(text:string,options:{origin?:string;externalHref?:(href:string,index:number)=>string}={}){
 return markdownToHtmlWithOutline(text,options).html;
}
