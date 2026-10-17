import assert from 'node:assert/strict';
import http from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {createWorker} from '../../dist/worker.js';
import {encodeArticleCursor} from '../../src/article-pages.mjs';

// Actual built Worker/editor, synthetic SQLite, exact loopback only. No Access,
// production D1, AI, owner credentials, external articles or external navigation.
const origin='http://127.0.0.1:4179';
const root=new URL('../../',import.meta.url);
const output=new URL('.sites-runtime/browser/article-pagination/',root);
const planned=[
 ...[320,390,768,1440].map(width=>`${width}px: 205 tied records, oldest article, back navigation, keyboard and layout`),
 'failed older page: unchanged dirty draft, exact retry and repeated-click single-flight',
 'malformed page metadata: retained rows and recovery without partial commit',
 'save while older page is pending: newest-page acknowledgement wins over stale reply',
];
if(process.argv.includes('--list')){
 console.log(JSON.stringify({syntheticOnly:true,planned,executed:0},null,2));
}else{
 mkdirSync(output,{recursive:true});
 const executablePath=chromium.executablePath();
 const playwrightVersion=createRequire(import.meta.url)('playwright/package.json').version;
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('migrations/0001_articles.sql',root),'utf8'));
 const stamp='2026-10-09T10:24:00.000Z';
 const article=index=>({id:`59438c59-8e88-4a2d-823a-${String(index).padStart(12,'0')}`,title:`合成の保存記事${String(index).padStart(3,'0')}`,source_url:'',markdown:`# 合成の保存記事${index}\n\nブラウザー検証だけの架空本文です。`,published:index%3===1?1:0,created_at:stamp,updated_at:stamp,published_at:index%3===1?stamp:null});
 function reset(){
  db.exec('DELETE FROM articles');
  const insert=db.prepare('INSERT INTO articles (id,title,source_url,markdown,published,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?)');
  for(let i=1;i<=205;i++){const a=article(i);insert.run(a.id,a.title,a.source_url,a.markdown,a.published,a.created_at,a.updated_at,a.published_at);}
 }
 function prepare(sql,args=[]){return {bind(...a){return prepare(sql,a);},async all(){return {success:true,results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){db.prepare(sql).run(...args);return {success:true};}};}
 const env={DB:{prepare},ASSETS:{async fetch(request){const path=new URL(request.url).pathname;const type=path.endsWith('.css')?'text/css':path.endsWith('.js')?'application/javascript':'image/svg+xml';return new Response(readFileSync(new URL('public'+path,root)),{headers:{'Content-Type':type}});}}};
 const worker=createWorker({verifyOwner:async()=>({ok:true,status:200}),convert:async()=>{throw new Error('Unexpected synthetic conversion');}});
 const server=http.createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end('Synthetic fixture failure');}});
 const results=[],screenshots=[],requests=[],externalRequests=[],unexpectedMutations=[],pageErrors=[];
 let browser,status='running',scenario='launch Chromium';
 function report(error){writeFileSync(new URL('results.json',output),JSON.stringify({status,planned,results,screenshots,requests,externalRequests,unexpectedMutations,pageErrors,syntheticOnly:true,browser:'repository-pinned Playwright Chromium',playwrightVersion,executablePath,chromiumVersion:browser?.version()||null,pinnedChromiumVerified:status==='passed',networkBoundary:'exact loopback origin only; every other origin is aborted',...(error?{failedScenario:scenario,error:String(error.stack||error)}:{})},null,2));}
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
 const older=page=>page.getByRole('button',{name:'以前の記事のページ',exact:true});
 const newer=page=>page.getByRole('button',{name:'新しい記事のページ',exact:true});
 async function settled(page,index,count){
  await page.waitForFunction(({index,count})=>document.querySelector('.draft-list')?.getAttribute('aria-busy')==='false'&&document.querySelector('.page-summary')?.textContent===`${index}ページ目 · ${count}件`,{index,count});
  assert.equal(await page.locator('.draft-row').count(),count);
 }
 const snapshot=page=>page.evaluate(()=>({title:document.querySelector('input[name="title"]').value,body:document.querySelector('#markdown-body').value,source:document.querySelector('#source-url').value,rights:document.querySelector('.rights-check input').checked,tab:document.querySelector('.writing-surface').className,status:document.querySelector('.document-status').textContent,share:document.querySelector('#share-url')?.value||'',metadata:document.querySelector('.document-meta').textContent,notice:document.querySelector('.notice')?.textContent||''}));
 const dirty=page=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
 async function contextFor(name,width=1440){
  reset();
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
  context.setDefaultTimeout(10000);
  const page=await context.newPage(),plans=[],gets=[];let saves=0,allowSave=false;
  page.on('pageerror',error=>pageErrors.push({scenario:name,error:error.message}));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   const record={scenario:name,url:url.href,method:request.method()};requests.push(record);
   if(url.origin!==origin){externalRequests.push(record);return route.abort('blockedbyclient');}
   if(url.pathname==='/api/articles'&&request.method()==='GET'){
    gets.push(url.pathname+url.search);const plan=plans.shift();
    if(plan){assert.equal(url.pathname+url.search,plan.path);plan.started.resolve();await plan.gate.promise;await route.fulfill({status:plan.status,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(plan.body)});plan.finished.resolve();return;}
   }
   if(!['GET','HEAD'].includes(request.method())){
    if(url.pathname==='/api/articles'&&request.method()==='POST'&&allowSave){allowSave=false;saves++;return route.continue();}
    unexpectedMutations.push(record);return route.abort('blockedbyclient');
   }
   return route.continue();
  });
  return {context,page,gets,get saves(){return saves;},allowSave(){allowSave=true;},plan(path,status,body){const item={path,status,body,started:deferred(),gate:deferred(),finished:deferred()};plans.push(item);return {started:item.started.promise,finished:item.finished.promise,release:()=>item.gate.resolve()};}};
 }
 const path=cursor=>'/api/articles?'+new URLSearchParams({cursor});
 async function actualPage(cursor=null){const response=await fetch(origin+(cursor?path(cursor):'/api/articles'),{redirect:'error'});assert.equal(response.status,200);return response.json();}
 try{
  assert.ok(existsSync(executablePath),'Pinned Chromium is not installed; browser bodies are unverified.');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4179,'127.0.0.1',resolve);});
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,768,1440]){
   scenario=planned[results.length];const fixture=await contextFor(scenario,width),{page}=fixture;
   await page.goto(origin+'/admin');await settled(page,1,100);
   assert.equal(await newer(page).isDisabled(),true);assert.equal(await older(page).isEnabled(),true);
   const seen=[...await page.locator('.draft-row').allTextContents()];
   await older(page).focus();await page.keyboard.press('Enter');await settled(page,2,100);
   assert.equal(await page.locator('.draft-list').evaluate(element=>element===document.activeElement),true);
   seen.push(...await page.locator('.draft-row').allTextContents());
   await older(page).focus();await page.keyboard.press('Space');await settled(page,3,5);
   seen.push(...await page.locator('.draft-row').allTextContents());assert.equal(new Set(seen).size,205);
   assert.equal(await older(page).isDisabled(),true);
   await page.getByRole('button',{name:/^合成の保存記事001/}).click();
   assert.equal(await page.locator('input[name="title"]').inputValue(),article(1).title);
   assert.equal(await page.locator('.document-status').textContent(),'公開中');
   const before=await snapshot(page);
   await newer(page).click();await settled(page,2,100);assert.deepEqual(await snapshot(page),before);
   await newer(page).click();await settled(page,1,100);assert.deepEqual(await snapshot(page),before);
   assert.ok((await page.locator('.page-selection').textContent()).includes('編集中の内容はそのまま'));
   const bounds=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
   assert.ok(bounds.body<=bounds.width&&bounds.document<=bounds.width,JSON.stringify(bounds));
   for(const button of [older(page),newer(page)]){const box=await button.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44);}
   if(width>720)assert.ok(await page.locator('.draft-list').evaluate(element=>element.clientHeight<=520&&element.scrollHeight>element.clientHeight));
   await page.locator('.list-pagination').scrollIntoViewIfNeeded();
   const file=`pages-${width}.png`;await page.screenshot({path:new URL(file,output).pathname,fullPage:true});screenshots.push({file,width,syntheticOnly:true});
   assert.equal(fixture.gets.length,5);assert.equal(fixture.saves,0);
   results.push({name:scenario,ok:true});await fixture.context.close();
  }
  scenario=planned[4];{
   const fixture=await contextFor(scenario),{page}=fixture;
   await page.goto(origin+'/admin');await settled(page,1,100);
   await page.locator('.draft-row').first().click();await page.getByRole('button',{name:'Markdown',exact:true}).click();
   await page.locator('input[name="title"]').fill('合成の未保存タイトル');await page.locator('#markdown-body').fill('# 合成の未保存本文');await page.locator('#source-url').fill('https://example.org/synthetic-draft');await page.locator('.rights-check input').check();
   const before=await snapshot(page),first=await actualPage(),target=path(first.nextCursor);
   const failure=fixture.plan(target,503,{error:'Synthetic page unavailable'});
   await older(page).evaluate(button=>{button.click();button.click();button.click();});await failure.started;
   assert.equal(fixture.gets.length,2);assert.deepEqual(await snapshot(page),before);assert.equal(await page.locator('.draft-row').count(),100);
   failure.release();await page.getByRole('alert').waitFor();assert.equal(await dirty(page),true);
   const success=fixture.plan(target,200,await actualPage(first.nextCursor));
   const retry=page.getByRole('button',{name:'記事一覧を再読み込み',exact:true});await retry.focus();await page.keyboard.press('Enter');await success.started;
   await page.locator('input[name="title"]').focus();success.release();await settled(page,2,100);
   assert.deepEqual(await snapshot(page),before);assert.equal(await dirty(page),true);assert.equal(await page.locator('input[name="title"]').evaluate(element=>element===document.activeElement),true);
   page.once('dialog',dialog=>dialog.dismiss());await page.locator('.draft-row').first().click();assert.deepEqual(await snapshot(page),before);
   assert.deepEqual(fixture.gets.slice(1),[target,target]);assert.equal(fixture.saves,0);
   results.push({name:scenario,ok:true});await fixture.context.close();
  }
  scenario=planned[5];{
   const fixture=await contextFor(scenario),{page}=fixture;await page.goto(origin+'/admin');await settled(page,1,100);
   const first=await actualPage(),target=path(first.nextCursor),second=await actualPage(first.nextCursor),rows=await page.locator('.draft-row').allTextContents();
   const invalid=fixture.plan(target,200,{...second,nextCursor:encodeArticleCursor(article(205))});
   await older(page).click();await invalid.started;invalid.release();await page.getByRole('alert').waitFor();
   assert.deepEqual(await page.locator('.draft-row').allTextContents(),rows);assert.equal(await page.locator('.page-summary').textContent(),'1ページ目 · 100件');
   const valid=fixture.plan(target,200,second);await page.getByRole('button',{name:'記事一覧を再読み込み',exact:true}).click();await valid.started;valid.release();await settled(page,2,100);
   assert.deepEqual(fixture.gets.slice(1),[target,target]);results.push({name:scenario,ok:true});await fixture.context.close();
  }
  scenario=planned[6];{
   const fixture=await contextFor(scenario),{page}=fixture;await page.goto(origin+'/admin');await settled(page,1,100);await page.locator('.draft-row').nth(1).click();await page.getByRole('button',{name:'Markdown',exact:true}).click();
   const first=await actualPage(),target=path(first.nextCursor),old=fixture.plan(target,200,await actualPage(first.nextCursor));
   await older(page).click();await old.started;
   // The replacement refresh now aborts the obsolete GET before it responds.
   const staleFailure=page.waitForEvent('requestfailed',request=>request.method()==='GET'&&new URL(request.url()).pathname+new URL(request.url()).search===target);
   await page.locator('#markdown-body').fill('# 合成の保存する本文');fixture.allowSave();await page.getByRole('button',{name:'下書き保存',exact:true}).click();
   await page.locator('.notice').filter({hasText:'下書きに保存しました。'}).waitFor();await settled(page,1,100);
   assert.equal(fixture.saves,1);assert.equal(await dirty(page),false);const before=await snapshot(page);
   await page.locator('#markdown-body').fill('# 保存後の新しい未保存本文');const newerDraft=await snapshot(page);
   old.release();await old.finished;
   assert.equal((await staleFailure).failure()?.errorText,'net::ERR_ABORTED');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.deepEqual(await snapshot(page),newerDraft);assert.equal(await dirty(page),true);assert.equal(await page.locator('.page-summary').textContent(),'1ページ目 · 100件');assert.equal(await newer(page).isDisabled(),true);
   assert.ok(before.notice.includes('下書きに保存しました。'));assert.equal(fixture.gets.length,3);
   results.push({name:scenario,ok:true});await fixture.context.close();
  }
  assert.deepEqual(externalRequests,[]);assert.deepEqual(unexpectedMutations,[]);assert.deepEqual(pageErrors,[]);
  status='passed';report();console.log(JSON.stringify({status,results,screenshots},null,2));
 }catch(error){status=scenario==='launch Chromium'?'blocked':'failed';report(error);throw error;}
 finally{await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));db.close();}
}
