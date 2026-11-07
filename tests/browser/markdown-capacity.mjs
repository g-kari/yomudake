import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Real shipped editor, synthetic API responses and explicit synthetic downloads.
export async function markdownCapacityChecks(browser,out,results){
 const origin='http://127.0.0.1:4179';
 const samples=[['ASCII',n=>'a'.repeat(n)],['Japanese',n=>'あ'.repeat(Math.floor(n/3))+'a'.repeat(n%3)],['emoji',n=>'🦊'.repeat(Math.floor(n/4))+'a'.repeat(n%4)]];
 for(const width of [320,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true,serviceWorkers:'block'});
  const page=await context.newPage(),requests=[],errors=[];let writes=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname,method:request.method()});
   assert.equal(url.origin,origin,'No external request');
   if(url.pathname==='/api/articles'){assert.equal(request.method(),'GET');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({articles:[]})});}
   if(url.pathname==='/api/editor/articles'){
    if(request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({protocol:'compare-v1'})});
    assert.equal(request.method(),'POST');writes++;const input=request.postDataJSON();
    assert.ok(Buffer.byteLength(input.markdown,'utf8')<=200000,'Oversized body was sent');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({protocol:'compare-v1',revision:'a'.repeat(64),id:input.id,published:input.published,url:'/p/'+input.id})});
   }
   assert.equal(request.method(),'GET');await route.continue();
  });
  try{
   await page.goto(origin+'/admin');await page.getByText('保存したすべての記事',{exact:true}).waitFor();
   await page.getByRole('button',{name:'＋ 新しい下書き',exact:true}).click();await page.locator('input[name="title"]').fill('合成容量確認');
   const body=page.locator('#markdown-body'),save=page.getByRole('button',{name:'下書き保存',exact:true});
   for(const [encoding,make] of samples)for(const bytes of [199999,200000,200001]){
    const value=make(bytes);assert.equal(Buffer.byteLength(value,'utf8'),bytes);await body.fill(value);
    if(bytes>200000){
     await page.locator('.rights-check input').check();const before=requests.length,previous=writes;
     await save.click();await page.getByRole('button',{name:'公開する',exact:true}).click();
     await page.waitForTimeout(80);
     assert.equal(writes,previous,'Oversized draft/public save emitted POST');assert.equal(requests.length,before,'Oversized save fetched capability');
     assert.equal(await body.inputValue(),value);assert.equal(await body.getAttribute('aria-invalid'),'true');
     assert.ok((await body.getAttribute('aria-describedby')).split(/\s+/).includes('markdown-capacity-guidance'));
     assert.ok((await page.locator('#markdown-capacity-guidance').textContent()).includes('1 bytes'));
     assert.equal(await page.locator('.rights-check input').isChecked(),true,'Rejected save changed confirmation');
     assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented;}),true);
     if(encoding==='emoji'){
      const exportButton=page.getByRole('button',{name:'Markdown本文を端末に書き出す',exact:true});await exportButton.focus();
      const next=page.waitForEvent('download');await page.keyboard.press('Enter');const download=await next;
      assert.deepEqual(readFileSync(await download.path()),Buffer.from(value));assert.equal(requests.length,before);
      await page.locator('#markdown-capacity-guidance').scrollIntoViewIfNeeded();await page.screenshot({path:out+`markdown-capacity-${width}.png`,fullPage:false});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
     }
    }else{
     const previous=writes;await save.click();await page.waitForFunction(()=>!document.querySelector('#markdown-body').disabled);
     await page.getByText('下書きに保存しました。公開ページには表示されません。',{exact:true}).waitFor();
     assert.equal(writes,previous+1);assert.notEqual(await body.getAttribute('aria-invalid'),'true');
     assert.equal(await body.inputValue(),value);
    }
    results.push({name:`Markdown UTF8 ${encoding} ${bytes} bytes ${width}px no truncation and guarded save`,ok:true});
   }
   await body.fill('修正済み 🦊');assert.equal(await page.locator('.rights-check input').isChecked(),false);
   assert.equal(await page.getByRole('button',{name:'公開する',exact:true}).isDisabled(),true);
   await page.locator('.rights-check input').check();const before=writes;await page.getByRole('button',{name:'公開する',exact:true}).click();
   await page.getByText('公開しました。共有URLから、サインインなしで読めます。',{exact:true}).waitFor();assert.equal(writes,before+1);
   assert.deepEqual(errors,[]);results.push({name:`Markdown capacity correction requires explicit publication confirmation ${width}px`,ok:true});
  }finally{await context.close();}
 }
}
