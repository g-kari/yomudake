import {useEffect,useRef} from 'react';
import {articleLink} from '../src/navigation.mjs';
export type PendingLink={href:string;trigger:HTMLElement};
export function ExternalWarning({pending,onClose}:{pending:PendingLink|null;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  const node=dialog.current;if(!node)return;
  if(pending){trigger.current=pending.trigger;if(!node.open)node.showModal();}
  else if(node.open){node.close();if(trigger.current?.isConnected)trigger.current.focus();trigger.current=null;}
 },[pending]);
 const link=articleLink(pending?.href);
 const close=()=>{if(dialog.current?.open)dialog.current.close();onClose();if(trigger.current?.isConnected)trigger.current.focus();trigger.current=null;};
 return <dialog ref={dialog} className="external-dialog" aria-labelledby="external-title" aria-describedby="external-description" onCancel={e=>{e.preventDefault();close();}} onClose={close}>
  <h2 id="external-title">外部サイトです</h2>
  <p id="external-description">リンク先の内容や安全性は、よむだけでは保証できません。移動先を確認してから進んでください。</p>
  {link&&<dl className="outbound-destination"><dt>移動先のサイト</dt><dd>{new URL(link.href).hostname}</dd><dt>URL</dt><dd>{link.href}</dd></dl>}
  <div className="outbound-actions"><button type="button" className="secondary-button" onClick={close}>戻る</button>{link&&<a className="button" href={link.href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">外部サイトへ進む</a>}</div>
 </dialog>;
}
