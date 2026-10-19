// A user-initiated local snapshot only: no network or article save operation.
export function downloadMarkdownBody(markdown:string){
 const blob=new Blob([markdown],{type:'text/markdown;charset=utf-8'});
 const anchor=document.createElement('a');
 const href=URL.createObjectURL(blob);let clicked=false;
 try{
  anchor.href=href;anchor.download='yomudake-draft.md';anchor.hidden=true;
  document.body.append(anchor);anchor.click();clicked=true;
 }finally{
  try{anchor.remove();}finally{
   // Let the browser consume a successful click before releasing the URL.
   if(clicked){try{window.setTimeout(()=>URL.revokeObjectURL(href),0);}catch{URL.revokeObjectURL(href);}}
   else URL.revokeObjectURL(href);
  }
 }
}
