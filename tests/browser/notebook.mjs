import {chromium} from 'playwright';
import {ready,close} from './fixture-server.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
await ready;
const out=new URL('../../.sites-runtime/browser/screenshots/',import.meta.url).pathname;mkdirSync(out,{recursive:true});
let browser;
const timeout=setTimeout(()=>{console.error('Synthetic browser QA exceeded 90 seconds.');process.exit(1);},90000);
const results=[];
const conversionDeadlineEvidence=[];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

// Exercise the shipped editor bundle, without owner credentials, real URLs, AI,
// D1 or article writes. Native withheld headers are covered separately from the
// deliberately abort-ignoring synthetic Response stream used for body coverage.
async function conversionDeadlineChecks(browser){
 const origin='http://127.0.0.1:4179';
 const sourceUrl='https://example.org/synthetic-conversion';
 const retryUrl='https://example.org/synthetic-conversion-retry';
 const article={id:'3a68fb6a-c5f0-4842-93d8-13d09541d05c',title:'合成の公開済み記事',source_url:sourceUrl,markdown:'# 合成の公開済み本文\n\nブラウザー検証専用です。',published:1,created_at:'2026-10-09T10:24:00Z',updated_at:'2026-10-10T10:24:00Z',published_at:'2026-10-10T10:24:00Z'};
 const staleReply={title:'遅れて届く古い変換',sourceUrl,markdown:'# この古い変換は反映しない'};
 const retryReply={title:'再試行した合成記事',sourceUrl:retryUrl,markdown:'# 再試行した合成本文\n\n明示的な再試行だけで復旧しました。'};
 const snapshot=page=>page.evaluate(()=>{
  const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);
  return {
   title:document.querySelector('input[name="title"]').value,
   markdown:document.querySelector('#markdown-body').value,
   sourceUrl:document.querySelector('#source-url').value,
   rights:document.querySelector('.rights-check input').checked,
   published:document.querySelector('.document-status').textContent,
   shareUrl:document.querySelector('#share-url')?.value||'',
   metadata:document.querySelector('.document-meta').textContent,
   selected:document.querySelector('.draft-row[aria-current="true"]')?.textContent||'',
   surface:document.querySelector('.writing-surface').className,
   markdownHidden:document.querySelector('#markdown-panel').hidden,
   previewHidden:document.querySelector('#preview-panel').hidden,
   markdownPressed:document.querySelector('[aria-controls="markdown-panel"]').getAttribute('aria-pressed'),
   previewPressed:document.querySelector('[aria-controls="preview-panel"]').getAttribute('aria-pressed'),
   dirty:unload.defaultPrevented,
  };
 });
 for(const transport of ['headers','body'])for(const width of [320,1440]){
  const evidence={scenario:`conversion ${transport} deadline at ${width}px`,transport:transport==='headers'?'native fetch with withheld response headers':'first exact-path fetch only: synthetic native Response/ReadableStream with headers at 30s and abort-ignoring body at 120s',width,requests:[],syntheticEvents:[],externalRequests:[],unexpectedRequests:[],routeFailures:[],pageErrors:[],screenshots:[]};
  conversionDeadlineEvidence.push(evidence);
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
  context.setDefaultTimeout(5000);
  const page=await context.newPage();
  page.on('pageerror',error=>evidence.pageErrors.push(error.message));
  page.on('console',message=>{
   const prefix='synthetic-conversion-deadline:';
   if(message.text().startsWith(prefix))evidence.syntheticEvents.push(JSON.parse(message.text().slice(prefix.length)));
  });
  const plans=[],allPlans=[];let listGets=0,conversionPosts=0,articleWrites=0;
  function plan(body,url){
   const item={body,url,started:deferred(),gate:deferred(),finished:deferred()};plans.push(item);allPlans.push(item);
   return {started:item.started.promise,finished:item.finished.promise,release:()=>item.gate.resolve()};
  }
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   const record={method:request.method(),url:url.href};evidence.requests.push(record);
   if(url.origin!==origin){evidence.externalRequests.push(record);return route.abort('blockedbyclient');}
   if(['/api/articles','/api/editor/articles'].includes(url.pathname)&&!['GET','HEAD'].includes(request.method()))articleWrites++;
   if(url.pathname==='/api/articles'&&!url.search&&request.method()==='GET'){
    listGets++;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({articles:[article]})});
   }
   if(url.pathname==='/api/convert'&&!url.search&&request.method()==='POST'){
    conversionPosts++;
    const item=plans.shift();
    if(!item){evidence.unexpectedRequests.push({...record,reason:'unplanned conversion'});return route.abort('blockedbyclient');}
    record.body=request.postDataJSON();
    if(JSON.stringify(record.body)!==JSON.stringify({url:item.url}))evidence.unexpectedRequests.push({...record,reason:'unexpected conversion payload'});
    item.started.resolve();await item.gate.promise;
    try{await route.fulfill({contentType:'application/json',body:JSON.stringify(item.body)});}
    catch(error){
     // A browser-aborted request may no longer accept its delayed fixture reply.
     if(!request.failure()?.errorText.includes('ERR_ABORTED'))evidence.routeFailures.push(String(error));
    }finally{item.finished.resolve();}
    return;
   }
   if(['GET','HEAD'].includes(request.method())&&!url.search&&['/admin','/editor.js','/styles.css','/favicon.svg'].includes(url.pathname))return route.continue();
   evidence.unexpectedRequests.push({...record,reason:'unplanned request or mutation'});
   return route.abort('blockedbyclient');
  });
  if(transport==='body')await page.addInitScript(({origin,reply})=>{
   const originalFetch=window.fetch.bind(window);let intercepted=false;
   const report=event=>console.info('synthetic-conversion-deadline:'+JSON.stringify(event));
   window.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    const method=init?.method||(input instanceof Request?input.method:'GET');
    if(intercepted||url.href!==origin+'/api/convert'||method!=='POST')return originalFetch(input,init);
    intercepted=true;
    const signal=init?.signal||(input instanceof Request?input.signal:null);
    report({type:'request',method,url:url.href,body:JSON.parse(init.body),hasSignal:signal instanceof AbortSignal});
    signal?.addEventListener('abort',()=>report({type:'aborted'}),{once:true});
    await new Promise(resolve=>setTimeout(resolve,30000));
    const serialized=JSON.stringify(reply),encoder=new TextEncoder();
    const body=new ReadableStream({start(controller){
     controller.enqueue(encoder.encode(serialized.slice(0,9)));
     // Intentionally ignore abort: no real request or service keeps running.
     // This tests late body completion against the editor's current-request guard.
     setTimeout(()=>{controller.enqueue(encoder.encode(serialized.slice(9)));controller.close();report({type:'body-complete'});},90000);
    }});
    report({type:'headers'});
    return new Response(body,{status:200,headers:{'Content-Type':'application/json'}});
   };
  },{origin,reply:staleReply});
  let first;
  try{
   await page.clock.install({time:new Date('2026-10-17T12:00:00Z')});
   await page.goto(origin+'/admin');
   await page.getByRole('button',{name:/合成の公開済み記事/}).click();
   await page.clock.pauseAt(new Date('2026-10-17T13:00:00Z'));
   if(transport==='headers'){
    await page.getByRole('button',{name:'Markdown',exact:true}).click();
    await page.locator('input[name="title"]').fill('変換前の未保存タイトル');
    await page.locator('#markdown-body').fill('# 変換前の未保存本文\n\n期限を過ぎても残ります。');
   }
   await page.locator('.rights-check input').check();
   if(width===1440)await page.getByRole('button',{name:'プレビュー',exact:true}).click();
   else await page.getByRole('button',{name:'Markdown',exact:true}).click();
   const before=await snapshot(page);
   assert.equal(before.dirty,transport==='headers');
   assert.equal(before.published,'公開中');assert.equal(before.shareUrl,origin+'/p/'+article.id);assert.equal(before.rights,true);
   if(transport==='headers')first=plan(staleReply,sourceUrl);
   const retry=plan(retryReply,retryUrl);
   const failedRequest=transport==='headers'?page.waitForEvent('requestfailed',{predicate:request=>request.url()===origin+'/api/convert'}):null;
   // Observe this immediately so a setup failure cannot create an unhandled rejection.
   failedRequest?.catch(()=>{});
   if(before.dirty)page.once('dialog',dialog=>dialog.accept());
   await page.getByRole('button',{name:'URLから変換',exact:true}).click();
   if(first)await first.started;
   else{
    assert.equal(evidence.syntheticEvents.filter(event=>event.type==='request').length,1);
    assert.equal(evidence.syntheticEvents.find(event=>event.type==='request').hasSignal,true);
    assert.deepEqual(evidence.syntheticEvents.find(event=>event.type==='request').body,{url:sourceUrl});
   }
   const totalAttempts=()=>conversionPosts+evidence.syntheticEvents.filter(event=>event.type==='request').length;
   await page.clock.fastForward(30000);
   if(transport==='body')assert.equal(evidence.syntheticEvents.filter(event=>event.type==='headers').length,1);
   await page.clock.fastForward(29999);
   assert.equal(await page.locator('#source-url').isDisabled(),true,'Conversion ended before the 60-second total deadline');
   assert.deepEqual(await snapshot(page),before);
   await page.clock.fastForward(1);
   await page.locator('.notice').filter({hasText:'60秒'}).waitFor();
   const timeoutNotice=await page.locator('.notice').textContent();
   assert.ok(timeoutNotice.includes('入力は残っています'));assert.ok(timeoutNotice.includes('再試行'));
   assert.deepEqual(await snapshot(page),before);
   for(const selector of ['#source-url','input[name="title"]','#markdown-body','.rights-check input'])assert.equal(await page.locator(selector).isEnabled(),true);
   assert.equal(await page.getByRole('button',{name:'非公開で保存',exact:true}).isEnabled(),true);
   assert.equal(await page.getByRole('button',{name:'公開内容を更新',exact:true}).isEnabled(),true);
   assert.equal(await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).isEnabled(),true);
   const dimensions=await page.evaluate(()=>({body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
   assert.ok(dimensions.body<=width&&dimensions.document<=width,JSON.stringify(dimensions));
   const filename=`conversion-deadline-${transport}-${width}.png`;
   await page.screenshot({path:out+filename,fullPage:true});evidence.screenshots.push(filename);
   await page.clock.fastForward(30000);
   assert.equal(totalAttempts(),1,'A timeout must not retry automatically');assert.equal(articleWrites,0);
   assert.deepEqual(await snapshot(page),before);assert.equal(await page.locator('.notice').textContent(),timeoutNotice);
   if(transport==='body')assert.equal(evidence.syntheticEvents.filter(event=>event.type==='aborted').length,1);
   await page.getByRole('button',{name:'Markdown',exact:true}).click();
   await page.locator('input[name="title"]').fill('期限後に編集できるタイトル');
   await page.locator('#markdown-body').fill('# 期限後の新しい本文\n\n遅延した応答で上書きしない。');
   await page.locator('#source-url').fill(retryUrl);
   const edited=await snapshot(page);assert.equal(edited.dirty,true);
   page.once('dialog',dialog=>dialog.dismiss());
   await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();
   assert.deepEqual(await snapshot(page),edited,'The unsaved-draft guard must remain active after timeout');
   page.once('dialog',dialog=>dialog.accept());
   await page.getByRole('button',{name:'URLから変換',exact:true}).click();await retry.started;
   assert.equal(totalAttempts(),2);
   if(first){first.release();await first.finished;assert.ok((await failedRequest).failure().errorText.includes('ERR_ABORTED'));}
   else{await page.clock.fastForward(30000);assert.equal(evidence.syntheticEvents.filter(event=>event.type==='body-complete').length,1);}
   // The stale first reply must neither overwrite edits nor release the busy
   // state owned by the explicit second request, even when abort is ignored.
   assert.deepEqual(await snapshot(page),edited);
   assert.equal(await page.locator('#source-url').isDisabled(),true);
   assert.equal(await page.locator('.notice').count(),0);
   retry.release();await retry.finished;
   await page.locator('.notice').filter({hasText:'Markdownに変換しました'}).waitFor();
   const recovered=await snapshot(page);
   assert.equal(recovered.title,retryReply.title);assert.equal(recovered.markdown,retryReply.markdown);assert.equal(recovered.sourceUrl,retryUrl);
   assert.equal(recovered.rights,false);assert.equal(recovered.dirty,true);assert.equal(recovered.surface,'writing-surface preview');
   assert.equal(recovered.markdownHidden,true);assert.equal(recovered.previewHidden,false);
   assert.equal(recovered.markdownPressed,'false');assert.equal(recovered.previewPressed,'true');
   for(const key of ['published','shareUrl','selected'])assert.equal(recovered[key],before[key]);
   assert.equal(await page.locator('#source-url').isEnabled(),true);
   const successNotice=await page.locator('.notice').textContent();
   await page.clock.fastForward(60000);
   assert.deepEqual(await snapshot(page),recovered);assert.equal(await page.locator('.notice').textContent(),successNotice);
   assert.equal(totalAttempts(),2);assert.equal(articleWrites,0);assert.equal(listGets,1);assert.equal(plans.length,0);
   assert.deepEqual(evidence.externalRequests,[]);assert.deepEqual(evidence.unexpectedRequests,[]);assert.deepEqual(evidence.routeFailures,[]);assert.deepEqual(evidence.pageErrors,[]);
   results.push({name:`60-second total ${transport} deadline at ${width}px retains ${before.dirty?'dirty':'clean'} published draft, rights and tab; unlocks editing, ignores stale completion, explicitly retries once without article writes`,ok:true});
  }finally{for(const item of allPlans)item.gate.resolve();await context.close();}
 }
}
try {
 browser=await chromium.launch({headless:true});
 await conversionDeadlineChecks(browser);
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 let blockEmbed=false;const outgoing=[];
 await page.context().route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='127.0.0.1')return route.continue();
  outgoing.push(url.href);
  if(url.hostname==='embed.pixiv.net')return blockEmbed?route.abort('failed'):route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ja"><meta charset="utf-8"><body><p>合成の埋め込み表示。実作品の画像検証ではありません。</p></body></html>'});
  return route.abort('blockedbyclient');
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4179/admin');
 await page.getByRole('button',{name:/余白をつくる、小さな習慣/}).click();
 assert.equal(await page.locator('#preview-panel').isVisible(),true);assert.equal(await page.locator('#markdown-panel').isVisible(),false);
 const selectedColor=await page.locator('.draft-row.selected').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(selectedColor,'rgb(255, 251, 230)');
 const saveColor=await page.getByRole('button',{name:'下書き保存',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(saveColor,'rgb(23, 107, 115)');
 results.push({name:'yellow selected index survives hover and draft saving has the selected teal primary style',ok:true});
 await page.screenshot({path:out+'desktop-preview.png',fullPage:true});
 for (const width of [320,390,768,1440]) {
  await page.setViewportSize({width,height:1000});
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
  assert.ok(dimensions.body<=width&&dimensions.document<=width,JSON.stringify(dimensions));
  assert.equal(await page.getByRole('link',{name:'サインアウト'}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'公開する',exact:true}).isDisabled(),true);
  await page.screenshot({path:out+`preview-${width}.png`,fullPage:true});results.push({name:`no horizontal body overflow and owner navigation at ${width}px`,ok:true});
 }
 await page.getByRole('button',{name:'Markdown',exact:true}).click();
 assert.equal(await page.locator('#markdown-panel').isVisible(),true);assert.equal(await page.locator('#preview-panel').isVisible(),false);
 await page.locator('#markdown-body').fill('# 新しい本文\n\n編集のあとも残る。');
 await page.getByRole('button',{name:'プレビュー',exact:true}).click();assert.ok((await page.locator('#preview-panel').textContent()).includes('新しい本文'));
 await page.screenshot({path:out+'desktop-edited-preview.png',fullPage:true});
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:1000});
  for(const [selector,value] of [['input[name="title"]','確認後の合成タイトル '+width],['#markdown-body','# 確認後の合成本文 '+width],['#source-url','https://example.org/confirmation-'+width]]){
   await page.locator('.rights-check input').check();await page.getByRole('button',{name:'Markdown',exact:true}).click();await page.locator(selector).fill(value);
   assert.equal(await page.locator('.rights-check input').isChecked(),false);assert.equal(await page.getByRole('button',{name:'公開する',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'下書き保存',exact:true}).isEnabled(),true);
   assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
  }
  await page.locator('.rights-check input').check();await page.getByRole('button',{name:'プレビュー',exact:true}).click();await page.getByRole('button',{name:'Markdown',exact:true}).click();await page.locator('input[name="title"]').focus();await page.locator('input[name="title"]').fill(await page.locator('input[name="title"]').inputValue());
  assert.equal(await page.locator('.rights-check input').isChecked(),true);assert.equal(await page.getByRole('button',{name:'公開する',exact:true}).isEnabled(),true);
  await page.screenshot({path:out+`publication-confirmation-${width}.png`,fullPage:true});results.push({name:`content edits invalidate publication confirmation; no-op/focus/tabs preserve it and private save remains usable at ${width}px`,ok:true});
 }
 await page.locator('#markdown-body').fill('# 新しい本文\n\n編集のあとも残る。');
 await page.getByRole('button',{name:'プレビュー',exact:true}).click();
 await page.setViewportSize({width:1440,height:1100});
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();assert.ok((await page.locator('#markdown-body').inputValue()).includes('新しい本文'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();assert.equal(await page.locator('#markdown-body').inputValue(),'');assert.equal(await page.locator('#markdown-panel').isVisible(),true);
 const failedSource='https://x.com/synthetic/status/123?s=20';
 const failures=[
  {code:'SOURCE_CONNECTION_ERROR',error:'取得元との通信に失敗しました。ログインやブラウザー描画が必要なページは、この変換では取得できません。元ページを確認するか、本文を直接編集してください。'},
  {code:'CONVERSION_SERVICE_ERROR',error:'CloudflareのMarkdown変換サービスで処理に失敗しました。入力は残っています。時間を置いて再試行してください。'}
 ];
 await page.locator('input[name="title"]').fill('合成の未保存タイトル');await page.locator('#markdown-body').fill('# 合成の未保存本文\n\n失敗しても残る。');await page.locator('#source-url').fill(failedSource);await page.locator('.rights-check input').check();
 const snapshot=()=>page.evaluate(()=>({title:document.querySelector('input[name="title"]').value,body:document.querySelector('#markdown-body').value,source:document.querySelector('#source-url').value,rights:document.querySelector('.rights-check input').checked,status:document.querySelector('.document-status').textContent,share:document.querySelector('#share-url')?.value||'',surface:document.querySelector('.writing-surface').className}));
 const beforeFailure=await snapshot();let failureCalls=0;
 for(const width of [320,1440])for(const failure of failures){
  await page.setViewportSize({width,height:1000});
  const handler=async route=>{assert.equal(route.request().method(),'POST');assert.deepEqual(route.request().postDataJSON(),{url:failedSource});failureCalls++;await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify(failure)});};
  await page.route('**/api/convert',handler);const beforeCalls=failureCalls;
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'URLから変換',exact:true}).click();await page.getByRole('status').filter({hasText:failure.error}).waitFor();
  assert.deepEqual(await snapshot(),beforeFailure);assert.equal(failureCalls,beforeCalls+1);assert.equal(await page.locator('#source-url').isEnabled(),true);
  const size=await page.evaluate(()=>({body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));assert.ok(size.body<=width&&size.document<=width,JSON.stringify(size));
  await page.screenshot({path:out+`conversion-failure-${failure.code}-${width}.png`,fullPage:true});results.push({name:`classified ${failure.code} retains full unsaved draft at ${width}px`,ok:true});await page.unroute('**/api/convert',handler);
 }
 await page.setViewportSize({width:1440,height:1100});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();
 await page.locator('#source-url').fill('https://example.org/new');await page.getByRole('button',{name:'URLから変換',exact:true}).click();await page.getByRole('status').filter({hasText:'Markdownに変換しました'}).waitFor();assert.equal(await page.locator('#preview-panel').isVisible(),true);
 let postCount=0;page.on('request',r=>{if(r.url().endsWith('/api/editor/articles')&&r.method()==='POST')postCount++;});
 await page.getByRole('button',{name:'下書き保存',exact:true}).evaluate(b=>{b.click();b.click();});await page.getByRole('status').filter({hasText:'下書きに保存しました'}).waitFor();assert.equal(postCount,1);
 await page.locator('.rights-check input').check();await page.getByRole('button',{name:'公開する',exact:true}).click();await page.getByRole('status').filter({hasText:'公開しました'}).waitFor();
 assert.equal(await page.locator('.document-status').textContent(),'公開中');assert.equal(await page.getByRole('button',{name:'非公開で保存',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'Markdown',exact:true}).click();await page.locator('#markdown-body').fill('# 未保存の架空本文\n\n[架空の参考リンク](https://example.org/reference) [サイト内の記事](/p/sample-safe-reading)');await page.getByRole('button',{name:'プレビュー',exact:true}).click();
 assert.equal(await page.locator('.rights-check input').isChecked(),false);assert.equal(await page.getByRole('button',{name:'公開内容を更新',exact:true}).isDisabled(),true);
 const draftBefore=await page.evaluate(()=>({title:document.querySelector('input[name="title"]').value,body:document.querySelector('#markdown-body').value,source:document.querySelector('#source-url').value,rights:document.querySelector('.rights-check input').checked,status:document.querySelector('.document-status').textContent}));
 const sourceButton=page.locator('.document-source button');assert.equal(await sourceButton.getAttribute('href'),null);
 await sourceButton.click();const dialog=page.getByRole('dialog');await dialog.waitFor({state:'visible'});
 assert.ok((await dialog.textContent()).includes('https://example.org/new'));assert.equal(await dialog.locator('iframe').count(),0);assert.equal(await dialog.getByRole('link',{name:'外部サイトへ進む'}).getAttribute('href'),'https://example.org/new');
 await page.screenshot({path:out+'editor-external-warning.png',fullPage:true});
 await dialog.getByRole('button',{name:'戻る',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await sourceButton.evaluate(el=>el===document.activeElement),true);
 await sourceButton.click();await dialog.waitFor({state:'visible'});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await sourceButton.evaluate(el=>el===document.activeElement),true);
 const bodyButton=page.getByRole('button',{name:'架空の参考リンク',exact:true});await bodyButton.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'visible'});assert.equal(await dialog.getByRole('link',{name:'外部サイトへ進む'}).getAttribute('href'),'https://example.org/reference');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await bodyButton.evaluate(el=>el===document.activeElement),true);
 assert.deepEqual(await page.evaluate(()=>({title:document.querySelector('input[name="title"]').value,body:document.querySelector('#markdown-body').value,source:document.querySelector('#source-url').value,rights:document.querySelector('.rights-check input').checked,status:document.querySelector('.document-status').textContent})),draftBefore);assert.equal(postCount,2);
 results.push({name:'editor source/body confirmation Cancel and Escape restore focus and preserve complete draft with no API writes',ok:true});
 const publicUrl=await page.locator('#share-url').inputValue();page.once('dialog',d=>d.accept());await page.goto(publicUrl);assert.ok((await page.locator('.prose').textContent()).includes('変換した架空記事'));assert.equal(await page.locator('script').count(),0);
 await page.screenshot({path:out+'public-reading.png',fullPage:true});
 const sourceHref=await page.locator('.article-source a').getAttribute('href');assert.equal(new URL(sourceHref).pathname.startsWith('/out/'),true);assert.deepEqual([...new URL(sourceHref).searchParams.keys()],['rev']);
 await page.locator('.article-source a').click();await page.getByRole('heading',{name:'外部サイトです',exact:true}).waitFor();assert.equal(await page.locator('script').count(),0);assert.equal(await page.getByRole('link',{name:'外部サイトへ進む'}).getAttribute('href'),'https://example.org/new');assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'),'no-referrer');
 assert.equal(await page.getByRole('link',{name:'やばいこれ毒かも！',exact:true}).isVisible(),true);assert.equal(await page.getByRole('link',{name:'ジセイノク',exact:true}).isVisible(),true);
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+`public-warning-${width}.png`,fullPage:true});}
 await page.getByRole('link',{name:'戻る',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('link',{name:'外部サイトへ進む'}).evaluate(el=>el===document.activeElement),true);
 await page.goBack();assert.equal(await page.locator('.article-source a').isVisible(),true);await page.goForward();assert.equal(await page.getByRole('heading',{name:'外部サイトです',exact:true}).isVisible(),true);
 await page.getByRole('link',{name:'戻る',exact:true}).click();await page.getByRole('link',{name:'架空の参考リンク',exact:true}).click();assert.equal(await page.getByRole('link',{name:'外部サイトへ進む'}).getAttribute('href'),'https://example.org/reference');
 blockEmbed=true;await page.reload();assert.equal(await page.getByRole('link',{name:'やばいこれ毒かも！',exact:true}).isVisible(),true);assert.ok((await page.locator('figcaption').textContent()).includes('表示されない場合'));await page.screenshot({path:out+'public-warning-unavailable-embed.png',fullPage:true});
 assert.ok(outgoing.every(url=>new URL(url).hostname==='embed.pixiv.net'));results.push({name:'public revision-bound source/body warning, fixed sandboxed synthetic embed, mobile/keyboard/history and unavailable-embed attribution fallback without target navigation',ok:true});
 await page.goto('http://127.0.0.1:4179/');await page.setViewportSize({width:390,height:900});await page.screenshot({path:out+'public-home-mobile.png',fullPage:true});
 results.push({name:'real Chromium tab/edit/cancel/new/convert/repeated save/publish/public-reading flows with isolated synthetic backend',ok:true});
 assert.deepEqual(errors,[]);results.push({name:'no browser page errors',ok:true});
 const keyboard=await browser.newPage({viewport:{width:390,height:900}});await keyboard.goto('http://127.0.0.1:4179/admin');await keyboard.getByRole('button',{name:/余白をつくる、小さな習慣/}).click();
 await keyboard.getByRole('button',{name:'Markdown',exact:true}).focus();await keyboard.keyboard.press('Tab');assert.equal(await keyboard.getByRole('button',{name:'プレビュー',exact:true}).evaluate(el=>el===document.activeElement),true);await keyboard.keyboard.press('Tab');assert.equal(await keyboard.locator('.rights-check input').evaluate(el=>el===document.activeElement),true);
 const target=await keyboard.locator('.rights-check').boundingBox();assert.ok(target.height>=44);results.push({name:'keyboard skips hidden source pane and reaches a 44px rights target',ok:true});
 await keyboard.emulateMedia({reducedMotion:'reduce'});assert.equal(await keyboard.locator('button').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');results.push({name:'reduced motion respected',ok:true});
 writeFileSync(new URL('../../.sites-runtime/browser/results.json',import.meta.url),JSON.stringify({browser:'pinned Playwright Chromium on isolated CI loopback',syntheticOnly:true,results,conversionDeadlineEvidence},null,2));console.log(JSON.stringify(results,null,2));
} catch(error) {
 writeFileSync(new URL('../../.sites-runtime/browser/results.json',import.meta.url),JSON.stringify({syntheticOnly:true,results,conversionDeadlineEvidence,error:error.stack||String(error)},null,2));
 throw error;
} finally {clearTimeout(timeout);await browser?.close();await close();}
