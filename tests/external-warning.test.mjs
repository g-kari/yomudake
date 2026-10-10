import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

const fixture=String.raw`
import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ExternalWarning} from './client/external-warning';
function Demo(){const [pending,setPending]=useState(null);return <><button id="first" onClick={e=>setPending({href:'https://example.org/first',trigger:e.currentTarget})}>First source</button><button id="second" onClick={e=>setPending({href:'https://example.org/second',trigger:e.currentTarget})}>Second source</button><ExternalWarning pending={pending} onClose={()=>setPending(null)}/></>;}
const root=createRoot(document.querySelector('#root'));
const check=(condition,message)=>{if(!condition)throw new Error(message);};
async function run(){const results=[];try{
 for(const mode of ['Back','Escape']){try{
  await act(async()=>root.render(<Demo key={mode}/>));
  const dialog=document.querySelector('dialog'),first=document.querySelector('#first'),second=document.querySelector('#second');
  const queued=[];
  // Native dialog.close() queues a close event, rather than delivering it
  // synchronously. Hold that event until the next warning has already opened.
  dialog.close=()=>{dialog.removeAttribute('open');queued.push(()=>dialog.dispatchEvent(new Event('close')));};
  for(let iteration=0;iteration<3;iteration++){
   await act(async()=>first.click());check(dialog.open,'First warning did not open');
   await act(async()=>mode==='Escape'?dialog.dispatchEvent(new Event('cancel',{cancelable:true})):dialog.querySelector('button').click());
   check(!dialog.open,'Warning did not close');check(document.activeElement===first,'First trigger focus was lost');
   await act(async()=>second.click());check(dialog.open,'Second warning did not open');
   await act(async()=>queued.shift()());
   check(dialog.open,'A delayed native close event dismissed the newly opened warning');
   check(dialog.querySelector('a').href==='https://example.org/second','New warning destination changed');
   await act(async()=>dialog.querySelector('button').click());check(!dialog.open,'Second warning did not close');
   check(document.activeElement===second,'Second trigger focus was lost');
   await act(async()=>{while(queued.length)queued.shift()();});
  }
  results.push({name:mode+' followed by a new warning ignores stale native close events and restores the correct trigger',ok:true});
 }catch(error){results.push({name:mode+' followed by a new warning ignores stale native close events and restores the correct trigger',ok:false,error:error.stack||String(error)});}}
}finally{await act(async()=>root.unmount());}document.querySelector('#result').textContent=JSON.stringify(results);}
window.warningTestDone=run();
`;
test('actual external-warning component tolerates delayed native close events',async t=>{
 mkdirSync('.sites-runtime',{recursive:true});const output=new URL('../.sites-runtime/external-warning-test.mjs',import.meta.url);
 await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',outfile:output.pathname});
 const window=new Window({url:'https://reader.example.test'});window.document.body.innerHTML='<div id="root"></div><pre id="result"></pre>';
 const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,Event:window.Event,Node:window.Node,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{await import(pathToFileURL(output.pathname).href);await window.warningTestDone;const results=JSON.parse(window.document.querySelector('#result').textContent);assert.equal(results.length,2);for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));}
 finally{await window.happyDOM.close();for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
