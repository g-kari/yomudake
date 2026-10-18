import {EDITOR_SAVE_PROTOCOL} from '../src/editor-save.mjs';
// Bound only this read. Never time out/replay a mutation whose outcome is unknown.
export async function confirmEditorSaveCapability(){
 const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;
 try{
  const capability=await Promise.race([
   (async()=>{const response=await fetch('/api/editor/articles',{signal:controller.signal});if(!response.ok)throw new Error('unsupported');return response.json();})(),
   new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},15_000);})
  ]);
  if(!capability||typeof capability!=='object'||Array.isArray(capability)||capability.protocol!==EDITOR_SAVE_PROTOCOL)throw new Error('unsupported');
 }catch{throw new Error('競合を防ぐ保存機能を確認できませんでした。本文は残っています。画面を開き直してから保存してください。保存リクエストは送っていません。');}
 finally{clearTimeout(timeout);}
}
