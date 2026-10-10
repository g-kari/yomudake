import React from 'react';
import {articleLink} from './navigation.mjs';
type LinkOptions={origin?:string;renderExternal?:(href:string,label:string,key:number)=>React.ReactNode};
function inline(text:string, options:LinkOptions, depth=0):React.ReactNode[] {
 if(depth>3) return [text];
 const result:React.ReactNode[]=[];
 const re=/(!?\[([^\]\n]*)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
 let start=0; let match:RegExpExecArray|null;
 while((match=re.exec(text))) {
  if(match.index>start) result.push(text.slice(start,match.index));
  const key=match.index;
  if(match[1].startsWith('![')) result.push(<span key={key} className="image-placeholder">［画像: {match[2] || '説明なし'}］</span>);
  else if(match[1].startsWith('[')) {
   const link=articleLink(match[3],options.origin);
   result.push(link ? link.external&&options.renderExternal?options.renderExternal(link.href,match[2],key):<a key={key} href={link.href} {...(link.external?{target:'_blank',rel:'noopener noreferrer nofollow',referrerPolicy:'no-referrer' as const}:{})}>{match[2]}</a>:<span key={key}>{match[2]}［リンク無効］</span>);
  } else if(match[4]) result.push(<code key={key}>{match[4]}</code>);
  else if(match[5]) result.push(<strong key={key}>{inline(match[5],options,depth+1)}</strong>);
  else if(match[6]) result.push(<em key={key}>{inline(match[6],options,depth+1)}</em>);
  start=re.lastIndex;
 }
 if(start<text.length) result.push(text.slice(start));
 return result;
}
export function Markdown({text,...options}:{text:string}&LinkOptions) {
 const lines=text.replace(/\r\n?/g,'\n').split('\n'); const nodes:React.ReactNode[]=[];
 let i=0;
 while(i<lines.length) {
  const line=lines[i]; const key=i;
  if(!line.trim()) {i++;continue;}
  if(/^\s*```/.test(line)) {
   const language=line.trim().slice(3).slice(0,32); const code:string[]=[];i++;
   while(i<lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
   if(i<lines.length)i++;
   nodes.push(<pre key={key}><code data-language={language}>{code.join('\n')}</code></pre>);continue;
  }
  const heading=/^(#{1,6})\s+(.+)$/.exec(line);
  if(heading) { const tag=`h${heading[1].length}`;nodes.push(React.createElement(tag,{key},inline(heading[2],options)));i++;continue;}
  if(/^\s*([-*_])\1\1+\s*$/.test(line)) {nodes.push(<hr key={key}/>);i++;continue;}
  if(/^\s*>/.test(line)) {const content:string[]=[];while(i<lines.length && /^\s*>/.test(lines[i]))content.push(lines[i++].replace(/^\s*>\s?/,''));nodes.push(<blockquote key={key}>{inline(content.join('\n'),options)}</blockquote>);continue;}
  if(/^\s*([-+*]|\d+\.)\s+/.test(line)) {
   const ordered=/^\s*\d+\./.test(line);const items:React.ReactNode[]=[];
   while(i<lines.length && (ordered ? /^\s*\d+\.\s+/:/^\s*[-+*]\s+/).test(lines[i])) items.push(<li key={i}>{inline(lines[i++].replace(/^\s*([-+*]|\d+\.)\s+/,''),options)}</li>);
   nodes.push(ordered?<ol key={key}>{items}</ol>:<ul key={key}>{items}</ul>);continue;
  }
  const para:string[]=[line];i++;
  while(i<lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>|[-+*]\s|\d+\.\s)/.test(lines[i]))para.push(lines[i++]);
  nodes.push(<p key={key}>{inline(para.join('\n'),options)}</p>);
 }
 return <div className="prose">{nodes}</div>;
}
