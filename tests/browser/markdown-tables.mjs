import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {ready,close} from './fixture-server.mjs';

// Built renderer + editor, synthetic loopback SQLite only. No owner login,
// conversion API, production host, external resource or publishing real content.
const origin='http://127.0.0.1:4179';
const output=new URL('../../.sites-runtime/browser/markdown-tables/',import.meta.url);
mkdirSync(output,{recursive:true});
const articleId='59438c59-8e88-4a2d-823a-5d01d73c2d11';
const wideId='59438c59-8e88-4a2d-823a-5d01d73c2d12';
const long='長い合成の説明'.repeat(40);
const markdown=['## 合成の比較表','| 項目 | 状態 | 数量 | 備考 |','| :--- | :---: | ---: | --- |','| **合成A** | `ready` | 12 | '+long+' |','| 合成B | 待機 | 3 | [架空の参考](https://example.org/table-reference) |','| A\\|B | `x\\|y` | | ![画像は読み込まない](https://example.org/pixel) |','## 表の後','本文はそのままです。'].join('\n\n').replaceAll('\n\n|','\n|');
const longCode='synthetic_long_code_'.repeat(20),longUrl='https://example.org/'+ 'a'.repeat(300);
const wideMarkdown='|'+Array.from({length:32},(_,index)=>'項目'+(index+1)).join('|')+'|\n|'+Array(32).fill('---').join('|')+'|\n|'+['`'+longCode+'`','['+longUrl+'](https://example.org/long-label)',...Array(30).fill('合成値')].join('|')+'|';
const results=[],externalRequests=[],mutations=[],pageErrors=[];
let browser,status='running',scenario='launch pinned Chromium',downloaded='';
const executablePath=chromium.executablePath();
function report(error){writeFileSync(new URL('results.json',output),JSON.stringify({status,syntheticOnly:true,pinnedChromiumVerified:status==='passed',executablePath,results,externalRequests,mutations,pageErrors,...(error?{failedScenario:scenario,error:error.stack||String(error)}:{})},null,2));}
async function api(path,options={}){assert.ok(path.startsWith('/')&&!path.startsWith('//'));const response=await fetch(origin+path,{redirect:'error',...options});assert.equal(response.status,200);return response;}
async function context(width,javaScriptEnabled){
 const value=await browser.newContext({viewport:{width,height:1000},javaScriptEnabled,serviceWorkers:'block',acceptDownloads:true,reducedMotion:'reduce'});
 await value.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){externalRequests.push({method:request.method(),origin:url.origin});return route.abort('blockedbyclient');}
  if(!['GET','HEAD'].includes(request.method())){mutations.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}
  if(url.pathname==='/__synthetic-download/table.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:downloaded});
  return route.continue();
 });
 value.on('page',page=>page.on('pageerror',error=>pageErrors.push(error.message)));
 return value;
}
async function noOverflow(page){const size=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));assert.ok(size.body<=size.width&&size.document<=size.width,JSON.stringify(size));}
async function tableShape(page){
 assert.equal(await page.locator('table').count(),1);assert.equal(await page.locator('th[scope="col"]').count(),4);assert.equal(await page.locator('tbody tr').count(),3);
 assert.deepEqual(await page.locator('tbody tr').last().locator('td').allTextContents(),['A|B','x|y','','［画像: 画像は読み込まない］']);
 assert.equal(await page.locator('.prose img,.prose script,.prose iframe').count(),0);
 assert.equal(await page.locator('th').nth(1).evaluate(element=>getComputedStyle(element).textAlign),'center');
 assert.equal(await page.locator('td').nth(2).evaluate(element=>getComputedStyle(element).textAlign),'right');
 // A long prose column must not squeeze short headings and code into vertical
 // one-character columns, even when the overall page passes overflow checks.
 assert.ok(await page.locator('th').first().evaluate(element=>element.getBoundingClientRect().width>=100),'Short columns retain readable width');
 assert.equal(await page.locator('tbody tr').first().locator('code').evaluate(element=>element.getClientRects().length),1,'The short ready code remains on one line beside a long prose cell');
}
async function until(check,message){const deadline=Date.now()+5000;while(!await check()){assert.ok(Date.now()<deadline,message);await delay(25);}}
async function tabToRegion(page){
 for(let i=0;i<15;i++){await page.keyboard.press('Tab');if(await page.locator('.table-scroll').evaluate(element=>document.activeElement===element))return;}
 assert.fail('The named table scroll region must be keyboard reachable');
}
async function snapshot(page){return page.evaluate(()=>({title:document.querySelector('input[name="title"]').value,markdown:document.querySelector('#markdown-body').value,source:document.querySelector('#source-url').value,rights:document.querySelector('.rights-check input').checked,status:document.querySelector('.document-status').textContent}));}
await ready;
const timeout=setTimeout(()=>{status='failed';report(new Error('Synthetic table browser QA exceeded 90 seconds'));process.exit(1);},90000);
try{
 assert.ok(existsSync(executablePath),'Repository-pinned Chromium must be installed; no substitute or sandbox workaround');
 browser=await chromium.launch({headless:true});
 scenario='seed one synthetic table article';
 await api('/api/articles',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({id:articleId,title:'合成の比較表記事',sourceUrl:'',markdown,published:true,rightsConfirmed:true})});
 await api('/api/articles',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({id:wideId,title:'合成の32列表',sourceUrl:'',markdown:wideMarkdown,published:true,rightsConfirmed:true})});
 const savedBefore=await (await api('/api/articles')).json();
 const publicHtml=await (await api('/p/'+articleId)).text();
 for(const width of [320,390,768,1440]){
  scenario=`script-free public table at ${width}px`;
  const ctx=await context(width,false),page=await ctx.newPage();await page.goto(origin+'/p/'+articleId,{waitUntil:'networkidle'});
  await tableShape(page);await noOverflow(page);
  assert.equal(await page.locator('script').count(),0);
  const region=page.getByRole('region',{name:'表 1（左右にスクロールできます）',exact:true});assert.equal(await region.count(),1);
  await tabToRegion(page);
  assert.equal(await region.evaluate(element=>element.matches(':focus-visible')&&getComputedStyle(element).outlineStyle!=='none'),true);
  const overflow=await region.evaluate(element=>element.scrollWidth>element.clientWidth);
  assert.equal(overflow,width<512,'Only the narrow table, not the whole page, should need horizontal scrolling');
  if(overflow){
   await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
   await until(()=>region.evaluate(element=>element.scrollLeft>0),'ArrowRight must scroll the focused table');await noOverflow(page);
  }
  const href=await page.locator('tbody a').getAttribute('href');assert.ok(new URL(href,origin).pathname==='/out/'+articleId+'/link-0');
  assert.equal(await page.locator('tbody a').getAttribute('target'),null,'Public cell links retain same-tab confirmation rather than direct external navigation');
  await page.screenshot({path:new URL(`public-${width}.png`,output).pathname,fullPage:true});
  if(width===390){
   scenario='actual HTML download and reopening exact bytes';
   const pending=page.waitForEvent('download');await page.getByRole('link',{name:'HTMLを保存 ↓',exact:true}).click();const file=await pending;assert.equal(await file.failure(),null);
   await file.saveAs(new URL('synthetic-table.html',output).pathname);downloaded=readFileSync(new URL('synthetic-table.html',output),'utf8');assert.equal(downloaded,publicHtml);
   const reopened=await ctx.newPage();await reopened.goto(origin+'/__synthetic-download/table.html',{waitUntil:'networkidle'});await tableShape(reopened);await noOverflow(reopened);
   results.push({name:'exact public HTML download reopens script-free with the same table',ok:true});
  }
  results.push({name:`public table ${width}px: semantics, alignment, keyboard, local scrolling and safe links`,ok:true});await ctx.close();
 }
 for(const width of [390,1440]){
  scenario=`32-column table with long code and URL label at ${width}px`;
  const ctx=await context(width,false),page=await ctx.newPage();await page.goto(origin+'/p/'+wideId,{waitUntil:'networkidle'});await noOverflow(page);
  assert.equal(await page.locator('th').count(),32);assert.equal(await page.locator('td').count(),32);
  assert.ok(await page.locator('th').first().evaluate(element=>element.getBoundingClientRect().width>=100));
  assert.deepEqual(await page.locator('td code,td a').evaluateAll(elements=>elements.flatMap(element=>{
   const cell=element.closest('td').getBoundingClientRect();return [...element.getClientRects()].filter(rect=>rect.left<cell.left-1||rect.right>cell.right+1).map(()=>element.tagName);
  })),[],'Long code and URL text wrap inside their own columns');
  const region=page.locator('.table-scroll');assert.ok(await region.evaluate(element=>element.scrollWidth>element.clientWidth));await tabToRegion(page);await page.keyboard.press('ArrowRight');await until(()=>region.evaluate(element=>element.scrollLeft>0),'The wide table remains keyboard-scrollable');await noOverflow(page);
  await page.screenshot({path:new URL(`wide-${width}.png`,output).pathname,fullPage:true});results.push({name:`32 columns at ${width}px: readable short cells and wrapped long code/URL, table-local scroll only`,ok:true});await ctx.close();
 }
 for(const width of [390,1280]){
  scenario=`actual editor preview with unsaved table at ${width}px`;
  const ctx=await context(width,true),page=await ctx.newPage();await page.goto(origin+'/admin',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:/合成の比較表記事/}).click();await tableShape(page);await noOverflow(page);
  await page.getByRole('button',{name:'Markdown',exact:true}).click();const changed=markdown+'\n\n合成の未保存追記。';await page.locator('#markdown-body').fill(changed);
  await page.locator('.rights-check input').check();await page.getByRole('button',{name:'プレビュー',exact:true}).click();const before=await snapshot(page);
  const link=page.locator('tbody button.external-link');assert.equal(await link.count(),1);assert.equal(await link.getAttribute('href'),null);await link.click();
  const dialog=page.getByRole('dialog');assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.locator('iframe').count(),0);assert.equal(await dialog.locator('a.button').getAttribute('href'),'https://example.org/table-reference');
  await dialog.getByRole('button',{name:'戻る',exact:true}).click();assert.deepEqual(await snapshot(page),before);assert.equal(await link.evaluate(element=>document.activeElement===element),true);
  await page.getByRole('button',{name:'Markdown',exact:true}).click();assert.equal(await page.locator('#markdown-body').inputValue(),changed);await page.getByRole('button',{name:'プレビュー',exact:true}).click();
  const guarded=page.waitForEvent('dialog'),opening=page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();await (await guarded).dismiss();await opening;assert.deepEqual(await snapshot(page),before);
  await tableShape(page);await noOverflow(page);await page.screenshot({path:new URL(`preview-${width}.png`,output).pathname,fullPage:true});
  results.push({name:`editor ${width}px: real preview, external warning/focus and full unsaved draft/rights preserved`,ok:true});await ctx.close();
 }
 scenario='stored data and network boundary unchanged';
 assert.deepEqual(await (await api('/api/articles')).json(),savedBefore);assert.deepEqual(externalRequests,[]);assert.deepEqual(mutations,[]);assert.deepEqual(pageErrors,[]);
 results.push({name:'all stored Markdown and timestamps unchanged; no browser writes, external requests or page errors',ok:true});
 status='passed';report();console.log(JSON.stringify({status,results},null,2));
}catch(error){status='failed';report(error);throw error;}
finally{clearTimeout(timeout);await browser?.close();await close();}
