import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {ready,close} from './fixture-server.mjs';
await ready;
const origin='http://127.0.0.1:4179',out='.sites-runtime/browser/editor-conflict';mkdirSync(out,{recursive:true});
const results=[];let browser;
const timeout=setTimeout(()=>{console.error('Synthetic editor conflict QA exceeded 90 seconds');process.exit(1)},90000);
const dirty=page=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented});
async function context(width){const c=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',acceptDownloads:true});await c.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin,'No external request');return route.continue()});return c}
async function open(page,title){await page.goto(origin+'/admin');await page.getByRole('button').filter({hasText:title}).first().click();await page.getByRole('button',{name:'Markdown',exact:true}).click()}
// Cross-feature regression: explicit local export must follow the current buffer,
// not the server row or a stale ref, and must not acknowledge/replay a save.
async function exportCurrent(page,expected){
 const before=await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return {dirty:e.defaultPrevented,title:document.querySelector('input[name="title"]').value,body:document.querySelector('#markdown-body').value,status:document.querySelector('.document-status').textContent}});
 let requests=0;const count=()=>requests++;page.on('request',count);
 try{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Markdown本文を端末に書き出す',exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),'yomudake-draft.md');assert.equal(await download.failure(),null);assert.deepEqual(readFileSync(await download.path()),Buffer.from(expected,'utf8'));assert.equal(requests,0,'Export made network request');
 const after=await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return {dirty:e.defaultPrevented,title:document.querySelector('input[name="title"]').value,body:document.querySelector('#markdown-body').value,status:document.querySelector('.document-status').textContent}});assert.deepEqual(after,before,'Export changed editor/save state');
 }finally{page.off('request',count)}
}

try{
 browser=await chromium.launch();
 for(const width of [390,1440]){
  const c=await context(width),a=await c.newPage(),b=await c.newPage();let oldWrites=0;
  c.on('request',r=>{if(new URL(r.url()).pathname==='/api/articles'&&r.method()==='POST')oldWrites++});
  const id=crypto.randomUUID(),title='Synthetic shared '+width,original='# Original '+width,newer='# Newer A '+width,localTitle='Synthetic B title '+width;
  const seeded=await c.request.post(origin+'/api/articles',{headers:{origin},data:{id,title,markdown:original,sourceUrl:'',published:false}});assert.equal(seeded.status(),200);const seedWrites=oldWrites;
  await open(a,title);await open(b,title);await exportCurrent(b,original);
  await a.locator('#markdown-body').fill(newer);await a.getByRole('button',{name:'下書き保存',exact:true}).click();await a.locator('.notice').filter({hasText:'下書きに保存しました'}).waitFor();
  await b.locator('input[name="title"]').fill(localTitle);
  for(let repeat=0;repeat<2;repeat++){
   const response=b.waitForResponse(r=>r.url().endsWith('/api/editor/articles')&&r.request().method()==='POST');await b.getByRole('button',{name:'下書き保存',exact:true}).click();assert.equal((await response).status(),409);
   await b.locator('.notice').filter({hasText:'別の操作で更新'}).waitFor();assert.equal(await b.locator('#markdown-body').inputValue(),original);assert.equal(await b.locator('input[name="title"]').inputValue(),localTitle);assert.equal(await dirty(b),true);
   const persisted=(await (await c.request.get(origin+'/api/articles')).json()).articles.find(row=>row.id===id);assert.equal(persisted.markdown,newer);assert.equal(persisted.title,title);await exportCurrent(b,original);
  }
  const notice=b.locator('.notice').filter({hasText:'別の操作で更新'});await notice.scrollIntoViewIfNeeded();assert.equal(await notice.isVisible(),true);const box=await notice.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=1001);assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await b.screenshot({path:out+'/conflict-'+width+'.png'});
  // Refresh is read-only; reopening latest is still an explicit discard choice.
  b.once('dialog',d=>d.dismiss());await b.getByRole('button').filter({hasText:title}).first().click();assert.equal(await b.locator('input[name="title"]').inputValue(),localTitle);assert.equal(await dirty(b),true);
  b.once('dialog',d=>d.accept());await b.getByRole('button').filter({hasText:title}).first().click();await b.getByRole('button',{name:'Markdown',exact:true}).click();assert.equal(await b.locator('#markdown-body').inputValue(),newer);assert.equal(await dirty(b),false);await exportCurrent(b,newer);
  await b.locator('#markdown-body').fill('# Reconciled B '+width);await b.getByRole('button',{name:'下書き保存',exact:true}).click();await b.locator('.notice').filter({hasText:'下書きに保存しました'}).waitFor();assert.equal(await dirty(b),false);assert.equal(oldWrites,seedWrites,'Editor fell back to legacy POST');results.push({name:width+'px localExport current/open/stale409/repeated409/latest-row/noNetwork/dirty/baseline',ok:true});results.push({name:width+'px two-editor stale409/repeat/noOverwrite/dirty/readOnlyRefresh/confirmedLatest/reconcile',ok:true});await c.close();
  const old=await context(width),page=await old.newPage();let posts=0;
  await old.route(origin+'/api/editor/articles',route=>{if(route.request().method()==='POST')posts++;return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Synthetic old server'})})});
  page.on('request',r=>{if(r.method()==='POST')posts++});await page.goto(origin+'/admin');await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();await page.locator('input[name="title"]').fill('Synthetic unsupported save');await page.locator('#markdown-body').fill('# Retained unsupported draft');await page.getByRole('button',{name:'下書き保存',exact:true}).click();const message=page.locator('.notice').filter({hasText:'保存リクエストは送っていません'});await message.waitFor();assert.equal(posts,0);assert.equal(await dirty(page),true);assert.equal(await page.locator('#markdown-body').inputValue(),'# Retained unsupported draft');await exportCurrent(page,'# Retained unsupported draft');assert.equal(posts,0);await message.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/unsupported-'+width+'.png'});results.push({name:width+'px old-server noPOST/noFallback/retainedDraft/visibleError',ok:true});await old.close();
 }
}finally{clearTimeout(timeout);await browser?.close();await close();writeFileSync(out+'/results.json',JSON.stringify({syntheticOnly:true,results},null,2))}
assert.equal(results.length,6);console.log(JSON.stringify({passed:results.length,results}));
