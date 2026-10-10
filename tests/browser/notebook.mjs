import {chromium} from 'playwright';
import {ready,close} from './fixture-server.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
await ready;
const out=new URL('../../.sites-runtime/browser/screenshots/',import.meta.url).pathname;mkdirSync(out,{recursive:true});
let browser;
const timeout=setTimeout(()=>{console.error('Synthetic browser QA exceeded 90 seconds.');process.exit(1);},90000);
const results=[];
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
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
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();assert.ok((await page.locator('#markdown-body').inputValue()).includes('新しい本文'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();assert.equal(await page.locator('#markdown-body').inputValue(),'');assert.equal(await page.locator('#markdown-panel').isVisible(),true);
 await page.locator('#source-url').fill('https://example.org/new');await page.getByRole('button',{name:'URLから変換',exact:true}).click();await page.getByRole('status').filter({hasText:'Markdownに変換しました'}).waitFor();assert.equal(await page.locator('#preview-panel').isVisible(),true);
 let postCount=0;page.on('request',r=>{if(r.url().endsWith('/api/articles')&&r.method()==='POST')postCount++;});
 await page.getByRole('button',{name:'下書き保存',exact:true}).evaluate(b=>{b.click();b.click();});await page.getByRole('status').filter({hasText:'下書きに保存しました'}).waitFor();assert.equal(postCount,1);
 await page.locator('.rights-check input').check();await page.getByRole('button',{name:'公開する',exact:true}).click();await page.getByRole('status').filter({hasText:'公開しました'}).waitFor();
 assert.equal(await page.locator('.document-status').textContent(),'公開中');assert.equal(await page.getByRole('button',{name:'非公開で保存',exact:true}).isEnabled(),true);
 const publicUrl=await page.locator('#share-url').inputValue();await page.goto(publicUrl);assert.ok((await page.locator('.prose').textContent()).includes('変換した架空記事'));assert.equal(await page.locator('script').count(),0);
 await page.screenshot({path:out+'public-reading.png',fullPage:true});
 await page.goto('http://127.0.0.1:4179/');await page.setViewportSize({width:390,height:900});await page.screenshot({path:out+'public-home-mobile.png',fullPage:true});
 results.push({name:'real Chromium tab/edit/cancel/new/convert/repeated save/publish/public-reading flows with isolated synthetic backend',ok:true});
 assert.deepEqual(errors,[]);results.push({name:'no browser page errors',ok:true});
 const keyboard=await browser.newPage({viewport:{width:390,height:900}});await keyboard.goto('http://127.0.0.1:4179/admin');await keyboard.getByRole('button',{name:/余白をつくる、小さな習慣/}).click();
 await keyboard.getByRole('button',{name:'Markdown',exact:true}).focus();await keyboard.keyboard.press('Tab');assert.equal(await keyboard.getByRole('button',{name:'プレビュー',exact:true}).evaluate(el=>el===document.activeElement),true);await keyboard.keyboard.press('Tab');assert.equal(await keyboard.locator('.rights-check input').evaluate(el=>el===document.activeElement),true);
 const target=await keyboard.locator('.rights-check').boundingBox();assert.ok(target.height>=44);results.push({name:'keyboard skips hidden source pane and reaches a 44px rights target',ok:true});
 await keyboard.emulateMedia({reducedMotion:'reduce'});assert.equal(await keyboard.locator('button').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');results.push({name:'reduced motion respected',ok:true});
 writeFileSync(new URL('../../.sites-runtime/browser/results.json',import.meta.url),JSON.stringify({browser:'pinned Playwright Chromium on isolated CI loopback',syntheticOnly:true,results},null,2));console.log(JSON.stringify(results,null,2));
} catch(error) {
 writeFileSync(new URL('../../.sites-runtime/browser/results.json',import.meta.url),JSON.stringify({syntheticOnly:true,results,error:error.stack||String(error)},null,2));
 throw error;
} finally {clearTimeout(timeout);await browser?.close();await close();}
