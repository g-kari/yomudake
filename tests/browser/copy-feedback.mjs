import {chromium} from 'playwright';
import {ready,close} from './fixture-server.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
await ready;
const origin='http://127.0.0.1:4179';
const out=new URL('../../.sites-runtime/browser/',import.meta.url);mkdirSync(new URL('screenshots/',out),{recursive:true});
const first={id:'c276dbe0-bdb7-47e0-8e6c-adfa3f8a7d8d',title:'合成の公開記事A',source_url:'https://example.org/first',markdown:'# 合成の本文A',published:1,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z',published_at:'2026-10-09T00:00:00Z'};
const second={...first,id:'dcbe3c20-d502-44dd-b8c4-356585b3985d',title:'合成の公開記事B',markdown:'# 合成の本文B'};
const results=[];let browser;
const timer=setTimeout(()=>{console.error('Synthetic copy-feedback QA exceeded 90 seconds');process.exit(1);},90000);
const notice=async page=>(await page.locator('.editor-main > .notice').count())?page.locator('.editor-main > .notice').textContent():null;
const state=page=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return {title:document.querySelector('input[name="title"]').value,body:document.querySelector('#markdown-body').value,url:document.querySelector('#source-url').value,share:document.querySelector('#share-url')?.value||'',rights:document.querySelector('.rights-check input').checked,dirty:e.defaultPrevented,status:document.querySelector('.document-status').textContent};});
const settle=async(page,index,success)=>{await page.evaluate(({index,success})=>{const copy=window.__copies[index];success?copy.resolve():copy.reject(new Error('Synthetic clipboard unavailable'));},{index,success});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));};
try{
 browser=await chromium.launch();
 for(const width of [390,1440])for(const scenario of ['new','other','roundtrip','save-error','during-save','overlap','current-error','edit']){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];let posts=0,releaseSave;
  const saveGate=new Promise(resolve=>{releaseSave=resolve;});page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{window.__copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>new Promise((resolve,reject)=>window.__copies.push({value,resolve,reject}))}});});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'No external network');
   if(url.pathname==='/api/articles'){
    assert.equal(request.method(),'GET','No unsafe legacy editor write');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({articles:[first,second]})});return;
   }
   if(url.pathname==='/api/editor/articles'){
    if(request.method()==='GET'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({protocol:'compare-v1'})});return;}
    assert.equal(request.method(),'POST');posts++;if(scenario==='during-save')await saveGate;
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成の保存失敗。本文は残っています。'})});return;
   }
   assert.equal(request.method(),'GET','No unexpected write');await route.continue();
  });
  try{
   await page.goto(origin+'/admin');await page.getByRole('button',{name:/合成の公開記事A/}).click();
   const copy=page.getByRole('button',{name:'コピー',exact:true});
   if(scenario==='during-save'){await page.getByRole('button',{name:'非公開で保存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#markdown-body').disabled);}
   await copy.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.__copies.length),1);assert.equal(await page.evaluate(()=>window.__copies[0].value),origin+'/p/'+first.id);
   if(scenario==='new')await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();
   if(scenario==='other'||scenario==='roundtrip'){await page.getByRole('button',{name:/合成の公開記事B/}).click();if(scenario==='roundtrip')await page.getByRole('button',{name:/合成の公開記事A/}).click();}
   if(scenario==='save-error')await page.getByRole('button',{name:'非公開で保存',exact:true}).click();
   if(scenario==='during-save')releaseSave();
   if(scenario==='save-error'||scenario==='during-save')await page.getByRole('status').filter({hasText:'合成の保存失敗。本文は残っています。'}).waitFor();
   if(scenario==='overlap'){await copy.click();await settle(page,1,false);await page.getByRole('status').filter({hasText:'コピーできませんでした。'}).waitFor();}
   if(scenario==='edit'){await page.locator('input[name="title"]').fill('合成の未保存タイトル');assert.equal((await state(page)).dirty,true);}
   const before=await state(page),previous=await notice(page);
   await settle(page,0,!['other','current-error'].includes(scenario));
   if(scenario==='current-error'){
    assert.equal(await notice(page),'コピーできませんでした。表示されたURLを選択してコピーしてください。');assert.equal(await page.locator('#share-url').isVisible(),true);assert.equal(await page.locator('#share-url').getAttribute('readonly'),'');
   }else if(scenario==='edit')assert.equal(await notice(page),'共有URLをコピーしました。');
   else assert.equal(await notice(page),previous,'Stale completion replaced the current notice');
   assert.deepEqual(await state(page),before,'Copy result changed document/dirty/publication state');assert.equal(posts,['save-error','during-save'].includes(scenario)?1:0,'Unexpected mutation or replay');
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No horizontal page overflow');
   if(['new','current-error','during-save'].includes(scenario)){const target=page.locator('.editor-main > .notice');await target.scrollIntoViewIfNeeded();await page.screenshot({path:new URL(`screenshots/copy-${scenario}-${width}.png`,out).pathname,fullPage:false});}
   results.push({name:`copy feedback ${scenario} ${width}px preserves current notice/draft`,ok:true});
  }finally{releaseSave();await context.close();}
 }
 writeFileSync(new URL('copy-feedback-results.json',out),JSON.stringify({syntheticOnly:true,clipboard:'deferred synthetic API, not real system clipboard',results},null,2));console.log(JSON.stringify(results,null,2));
}catch(error){writeFileSync(new URL('copy-feedback-results.json',out),JSON.stringify({syntheticOnly:true,results,error:error.stack||String(error)},null,2));throw error;}
finally{clearTimeout(timer);await browser?.close();await close();}
