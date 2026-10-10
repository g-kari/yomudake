import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {ready, close} from './fixture-server.mjs';

// No owner account, production bindings, real articles, or external navigation.
// The existing fixture serves the built application and one synthetic save.
const origin = 'http://127.0.0.1:4179';
const output = new URL('../../.sites-runtime/browser/list-recovery/', import.meta.url);
mkdirSync(output, {recursive: true});
const playwrightVersion = createRequire(import.meta.url)('playwright/package.json').version;
// Optional existing local Chromium provides supplementary evidence only. CI
// leaves this unset and uses the repository-pinned Playwright browser binary.
const executableOverride = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '';
const executablePath = executableOverride || chromium.executablePath();
const retryName = '記事一覧を再読み込み';
const loadingText = '記事一覧を読み込んでいます…';
const errorText = '記事一覧を読み込めませんでした。編集中の内容は残っています。';
const syntheticArticle = {
  id: '3a68fb6a-c5f0-4842-93d8-13d09541d05c',
  title: '合成の保存済み記事',
  source_url: 'https://example.org/synthetic-note',
  markdown: '# 合成の保存済み記事\n\nブラウザー検証専用の架空本文です。',
  published: 0,
  created_at: '2026-10-09T10:24:00Z',
  updated_at: '2026-10-10T10:24:00Z',
  published_at: null,
};
const results = [];
const screenshots = [];
const requests = [];
const externalRequests = [];
const unexpectedRequests = [];
const pageErrors = [];
let browser;
let currentScenario = 'launch Chromium';
let status = 'running';

function report(error) {
  writeFileSync(new URL('results.json', output), JSON.stringify({
    status,
    browser: executableOverride
      ? 'supplementary local system Chromium driven by pinned Playwright'
      : 'repository-pinned Playwright Chromium',
    playwrightVersion,
    executablePath,
    pinnedChromiumVerified: !executableOverride && status === 'passed',
    chromiumVersion: browser?.version() || null,
    syntheticOnly: true,
    networkBoundary: 'exact loopback origin only; every other origin is aborted',
    baselineCommit: '51e7f0fa3e5eedcdd4c80501ead49ad8a50e90e0',
    results, screenshots, requests, externalRequests, unexpectedRequests, pageErrors,
    ...(error ? {failedScenario: currentScenario, error: error.stack || String(error)} : {}),
  }, null, 2));
}

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

async function fixturePage(name) {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  const plans = [];
  let listGets = 0;
  let mutationCount = 0;
  let allowedSave = null;
  page.on('pageerror', error => pageErrors.push({scenario: name, error: error.message}));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const record = {scenario: name, method: request.method(), url: url.href};
    requests.push(record);
    if (url.origin !== origin) {
      externalRequests.push(record);
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/api/articles' && request.method() === 'GET') {
      listGets++;
      const plan = plans.shift();
      if (!plan) {
        unexpectedRequests.push({...record, reason: 'unplanned list GET'});
        return route.abort('blockedbyclient');
      }
      plan.started.resolve();
      if (plan.gate) await plan.gate.promise;
      return route.fulfill({
        status: plan.status,
        contentType: 'application/json',
        headers: {'Cache-Control': 'no-store'},
        body: JSON.stringify(plan.body),
      });
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      mutationCount++;
      if (url.pathname === '/api/articles' && request.method() === 'POST' && allowedSave) {
        const payload = request.postDataJSON();
        assert.equal(payload.id, syntheticArticle.id);
        assert.equal(payload.title, allowedSave.title);
        assert.equal(payload.markdown, allowedSave.markdown);
        assert.equal(payload.sourceUrl, allowedSave.sourceUrl);
        assert.equal(payload.published, false);
        assert.equal(payload.rightsConfirmed, true);
        allowedSave = null;
        return route.continue();
      }
      unexpectedRequests.push({...record, reason: 'unexpected mutation'});
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  return {
    page, context,
    plan(status = 200, body = {articles: [syntheticArticle]}, gated = false) {
      const item = {status, body, started: deferred(), gate: gated ? deferred() : null};
      plans.push(item);
      return {started: item.started.promise, release: () => item.gate?.resolve()};
    },
    allowSave(payload) {allowedSave = payload;},
    get listGets() {return listGets;},
    get mutationCount() {return mutationCount;},
    assertSettled(expectedGets, expectedMutations = 0) {
      assert.equal(listGets, expectedGets, `${name}: list request count`);
      assert.equal(mutationCount, expectedMutations, `${name}: mutation request count`);
      assert.equal(plans.length, 0, `${name}: unconsumed list responses`);
      assert.equal(allowedSave, null, `${name}: authorized save was not observed`);
    },
  };
}

async function snapshot(page) {
  return page.evaluate(() => ({
    title: document.querySelector('input[name="title"]').value,
    markdown: document.querySelector('#markdown-body').value,
    sourceUrl: document.querySelector('#source-url').value,
    rights: document.querySelector('.rights-check input').checked,
    markdownHidden: document.querySelector('#markdown-panel').hidden,
    previewHidden: document.querySelector('#preview-panel').hidden,
    markdownPressed: document.querySelector('[aria-controls="markdown-panel"]').getAttribute('aria-pressed'),
    previewPressed: document.querySelector('[aria-controls="preview-panel"]').getAttribute('aria-pressed'),
    published: document.querySelector('.document-status').textContent,
    shareUrl: document.querySelector('#share-url')?.value || '',
    notice: document.querySelector('.notice')?.textContent || '',
  }));
}

async function waitListIdle(page) {
  await page.waitForFunction(() => document.querySelector('.draft-list')?.getAttribute('aria-busy') === 'false');
}

async function assertLoading(page, hasError = false) {
  await page.waitForFunction(() => document.querySelector('.draft-list')?.getAttribute('aria-busy') === 'true');
  await page.locator('.sidebar').getByRole('status').waitFor({state: 'visible'});
  assert.equal(await page.locator('.draft-list').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('.sidebar').getByRole('status').textContent(), loadingText);
  assert.equal(await page.locator('.empty-list').count(), 0);
  if (hasError) {
    assert.ok((await page.locator('.sidebar').getByRole('alert').textContent()).includes(errorText));
    assert.equal(await page.getByRole('button', {name: retryName, exact: true}).isDisabled(), true);
  }
  // List loading must leave unrelated draft editing and actions available.
  assert.equal(await page.locator('#markdown-body').isEnabled(), true);
  assert.equal(await page.locator('input[name="title"]').isEnabled(), true);
  assert.equal(await page.getByRole('button', {name: '下書き保存', exact: true}).isEnabled(), true);
}

async function assertListFailure(page) {
  await waitListIdle(page);
  await page.getByRole('button', {name: retryName, exact: true}).waitFor({state: 'visible'});
  await page.waitForFunction(name => [...document.querySelectorAll('.sidebar button')]
    .some(button => button.textContent === name && !button.disabled), retryName);
  assert.ok((await page.locator('.sidebar').getByRole('alert').textContent()).includes(errorText));
  assert.equal(await page.getByRole('button', {name: retryName, exact: true}).isEnabled(), true);
  assert.equal(await page.locator('.empty-list').count(), 0);
  assert.equal(await page.locator('.sidebar').getByRole('status').count(), 0);
}

async function assertRecovery(page, articleCount = 1) {
  await waitListIdle(page);
  assert.equal(await page.locator('.draft-row').count(), articleCount);
  assert.equal(await page.locator('.sidebar').getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', {name: retryName, exact: true}).count(), 0);
  assert.equal(await page.locator('.sidebar').getByRole('status').count(), 0);
  assert.equal(await page.locator('.empty-list').count(), 0);
}

async function captureWidths(page, stage) {
  for (const width of [320, 1440]) {
    await page.setViewportSize({width, height: 1000});
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.body <= width && dimensions.document <= width,
      `${stage}: horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
    assert.equal(await page.getByRole('link', {name: 'サインアウト', exact: true}).isVisible(), true);
    const filename = `${stage}-${width}.png`;
    await page.screenshot({path: new URL(filename, output).pathname, fullPage: true});
    screenshots.push({stage, width, file: filename, syntheticOnly: true});
  }
}

async function checkDirtyGuards(page, before) {
  for (const target of [
    page.getByRole('button', {name: '＋ 新しい下書き', exact: true}),
    page.getByRole('button', {name: /合成の保存済み記事/}),
  ]) {
    const pendingDialog = page.waitForEvent('dialog');
    const click = target.click();
    const dialog = await pendingDialog;
    assert.equal(dialog.type(), 'confirm');
    assert.ok(dialog.message().includes('保存していない変更'));
    await dialog.dismiss();
    await click;
    assert.deepEqual(await snapshot(page), before);
  }
  // Exercise Chromium's actual native unload confirmation, then cancel it.
  const pendingDialog = page.waitForEvent('dialog');
  const reload = page.reload({waitUntil: 'domcontentloaded'}).catch(error => error);
  const dialog = await pendingDialog;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.dismiss();
  const aborted = await reload;
  assert.ok(aborted instanceof Error, 'Canceled native unload unexpectedly navigated');
  assert.equal(page.url(), `${origin}/admin`);
  assert.deepEqual(await snapshot(page), before);
}

await ready;
const timeout = setTimeout(() => {
  status = 'failed';
  const error = new Error('Synthetic list recovery browser QA exceeded 90 seconds.');
  report(error);
  console.error(error.message);
  process.exit(1);
}, 90000);
try {
  assert.equal(playwrightVersion, '1.62.1', 'Browser QA must use the repository-pinned Playwright version');
  if (!existsSync(executablePath)) {
    const error = new Error(`Playwright Chromium executable is not installed: ${executablePath}`);
    error.code = 'PLAYWRIGHT_CHROMIUM_MISSING';
    throw error;
  }
  browser = await chromium.launch({headless: true, ...(executableOverride ? {executablePath} : {})});

  currentScenario = 'initial failure, repeated retry, keyboard recovery and dirty draft';
  const first = await fixturePage(currentScenario);
  const initialFailure = first.plan(503, {error: '合成の初回HTTP障害'}, true);
  await first.page.goto(`${origin}/admin`);
  await initialFailure.started;
  await assertLoading(first.page);
  await first.page.getByRole('button', {name: '＋ 新しい下書き', exact: true}).click();
  await first.page.locator('input[name="title"]').fill('未保存の合成タイトル');
  await first.page.locator('#source-url').fill('https://example.org/synthetic-draft');
  await first.page.locator('#markdown-body').fill('# 未保存の合成本文\n\n一覧の復旧でも残る架空テキストです。');
  await first.page.locator('.rights-check input').check();
  await first.page.getByRole('button', {name: 'プレビュー', exact: true}).click();
  const initialDraft = await snapshot(first.page);
  initialFailure.release();
  await assertListFailure(first.page);
  assert.deepEqual(await snapshot(first.page), initialDraft);
  await captureWidths(first.page, 'initial-error');
  results.push({name: 'initial HTTP failure has persistent sidebar error, live loading status and no false empty list; unsaved draft and preview survive', ok: true});

  const retryFailure = first.plan(503, {error: '合成の再試行HTTP障害'}, true);
  await first.page.getByRole('button', {name: retryName, exact: true}).evaluate(button => {
    button.focus();
    button.click(); button.click(); button.click();
  });
  await retryFailure.started;
  await assertLoading(first.page, true);
  assert.equal(first.listGets, 2, 'Rapid same-stack clicks must issue only one retry GET');
  assert.deepEqual(await snapshot(first.page), initialDraft);
  retryFailure.release();
  await assertListFailure(first.page);
  assert.deepEqual(await snapshot(first.page), initialDraft);
  results.push({name: 'three rapid retry clicks issue one GET; retry failure keeps error, draft and tab without mutations', ok: true});

  const retrySuccess = first.plan(200, {articles: [syntheticArticle]}, true);
  const retry = first.page.getByRole('button', {name: retryName, exact: true});
  await retry.focus();
  await first.page.keyboard.press('Space');
  await retrySuccess.started;
  await assertLoading(first.page, true);
  await first.page.getByRole('button', {name: 'Markdown', exact: true}).click();
  await first.page.locator('#markdown-body').fill('# 復旧待ちの合成本文\n\n再試行中の新しい入力も残ります。');
  await first.page.locator('#markdown-body').focus();
  const editedWhileLoading = await snapshot(first.page);
  retrySuccess.release();
  await assertRecovery(first.page);
  assert.deepEqual(await snapshot(first.page), editedWhileLoading);
  assert.equal(await first.page.locator('#markdown-body').evaluate(element => element === document.activeElement), true);
  assert.equal(await first.page.locator('.draft-row.selected').count(), 0);
  await captureWidths(first.page, 'recovered-edited-draft');
  await checkDirtyGuards(first.page, editedWhileLoading);
  first.assertSettled(3);
  results.push({name: 'Space recovers the list while preserving newer unsaved fields, rights, edit tab and body focus; canceled switch/new/unload guards remain active', ok: true});
  results.push({name: 'initial error and recovery have no body/document horizontal overflow at 320px and 1440px', ok: true});
  await first.context.close();

  currentScenario = 'Enter retry restores focus after successful recovery';
  const keyboard = await fixturePage(currentScenario);
  keyboard.plan(503, {error: '合成のキーボード検証HTTP障害'});
  await keyboard.page.goto(`${origin}/admin`);
  await assertListFailure(keyboard.page);
  const keyboardBefore = await snapshot(keyboard.page);
  const keyboardSuccess = keyboard.plan(200, {articles: [syntheticArticle]}, true);
  await keyboard.page.getByRole('button', {name: retryName, exact: true}).focus();
  await keyboard.page.keyboard.press('Enter');
  await keyboardSuccess.started;
  await assertLoading(keyboard.page, true);
  keyboardSuccess.release();
  await assertRecovery(keyboard.page);
  await keyboard.page.waitForFunction(() => document.activeElement === document.querySelector('.draft-list'));
  assert.equal(await keyboard.page.locator('.draft-list').getAttribute('tabindex'), '-1');
  assert.deepEqual(await snapshot(keyboard.page), keyboardBefore);
  keyboard.assertSettled(2);
  results.push({name: 'Enter activates retry and successful removal of focused retry button moves focus to the accessible article-list nav', ok: true});
  await keyboard.context.close();

  currentScenario = 'empty list appears only after successful empty response';
  const empty = await fixturePage(currentScenario);
  const emptySuccess = empty.plan(200, {articles: []}, true);
  await empty.page.goto(`${origin}/admin`);
  await emptySuccess.started;
  await assertLoading(empty.page);
  emptySuccess.release();
  await waitListIdle(empty.page);
  await empty.page.locator('.empty-list').waitFor({state: 'visible'});
  assert.equal(await empty.page.locator('.draft-row').count(), 0);
  assert.equal(await empty.page.locator('.sidebar').getByRole('alert').count(), 0);
  assert.equal(await empty.page.getByRole('button', {name: retryName, exact: true}).count(), 0);
  empty.assertSettled(1);
  results.push({name: 'real empty success shows the empty-state guidance only after the loading response completes', ok: true});
  await empty.context.close();

  currentScenario = 'save acknowledgement survives failed list refresh and independent retries';
  const saved = await fixturePage(currentScenario);
  saved.plan();
  await saved.page.goto(`${origin}/admin`);
  await assertRecovery(saved.page);
  await saved.page.getByRole('button', {name: /合成の保存済み記事/}).click();
  await saved.page.getByRole('button', {name: 'Markdown', exact: true}).click();
  const savedPayload = {
    title: '合成の保存確認タイトル',
    markdown: '# 合成の保存確認本文\n\nこれは検証用の架空保存です。',
    sourceUrl: 'https://example.org/synthetic-saved-draft',
  };
  await saved.page.locator('input[name="title"]').fill(savedPayload.title);
  await saved.page.locator('#markdown-body').fill(savedPayload.markdown);
  await saved.page.locator('#source-url').fill(savedPayload.sourceUrl);
  await saved.page.locator('.rights-check input').check();
  saved.allowSave(savedPayload);
  const savedListFailure = saved.plan(503, {error: '合成の保存後一覧HTTP障害'}, true);
  await saved.page.getByRole('button', {name: '下書き保存', exact: true}).evaluate(button => {button.click(); button.click();});
  await savedListFailure.started;
  assert.equal(saved.mutationCount, 1);
  await saved.page.locator('.notice').filter({hasText: '下書きに保存しました'}).waitFor();
  savedListFailure.release();
  await assertListFailure(saved.page);
  await saved.page.getByRole('button', {name: '下書き保存', exact: true}).waitFor({state: 'visible'});
  await saved.page.waitForFunction(() => !document.querySelector('input[name="title"]').disabled);
  assert.equal(await saved.page.locator('.draft-row.selected').getAttribute('aria-current'), 'true');
  const acknowledgement = await saved.page.locator('.notice').textContent();
  assert.ok(acknowledgement.startsWith('下書きに保存しました。'));
  assert.equal(await saved.page.evaluate(() => {
    const event = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }), false, 'Confirmed save should leave the saved draft clean');
  await saved.page.locator('#markdown-body').fill('# 保存後の未保存合成本文\n\n再読み込みでもこの入力を保持します。');
  const saveBeforeRetry = await snapshot(saved.page);
  const savedRetryFailure = saved.plan(503, {error: '合成の保存後再試行HTTP障害'}, true);
  await saved.page.getByRole('button', {name: retryName, exact: true}).focus();
  await saved.page.keyboard.press('Enter');
  await savedRetryFailure.started;
  await assertLoading(saved.page, true);
  assert.deepEqual(await snapshot(saved.page), saveBeforeRetry);
  savedRetryFailure.release();
  await assertListFailure(saved.page);
  assert.deepEqual(await snapshot(saved.page), saveBeforeRetry);
  await captureWidths(saved.page, 'saved-refresh-error');

  const savedRetrySuccess = saved.plan(200, {articles: [{
    ...syntheticArticle,
    title: savedPayload.title,
    markdown: savedPayload.markdown,
    source_url: savedPayload.sourceUrl,
  }]}, true);
  await saved.page.getByRole('button', {name: retryName, exact: true}).focus();
  await saved.page.keyboard.press('Space');
  await savedRetrySuccess.started;
  await saved.page.locator('#markdown-body').focus();
  savedRetrySuccess.release();
  await assertRecovery(saved.page);
  assert.deepEqual(await snapshot(saved.page), saveBeforeRetry);
  assert.equal(await saved.page.locator('.notice').textContent(), acknowledgement);
  assert.equal(await saved.page.locator('#markdown-body').evaluate(element => element === document.activeElement), true);
  assert.equal(await saved.page.locator('.draft-row.selected').getAttribute('aria-current'), 'true');
  assert.equal(await saved.page.evaluate(() => {
    const event = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }), true, 'Newer post-save edits must remain dirty after list recovery');
  await captureWidths(saved.page, 'saved-refresh-recovered');
  saved.assertSettled(4, 1);
  results.push({name: 'one synthetic save succeeds; failed post-save refresh and failed/successful retries keep save acknowledgement, selected draft, newer edits, rights, tab and dirty guard without extra writes', ok: true});
  await saved.context.close();

  assert.deepEqual(externalRequests, [], 'Unexpected external-origin requests');
  assert.deepEqual(unexpectedRequests, [], 'Unexpected fixture mutations or list GETs');
  assert.deepEqual(pageErrors, [], 'Unexpected browser page errors');
  results.push({name: 'all requests stay on exact loopback; no conversion, publication, external calls, unexpected mutations or browser page errors', ok: true});
  status = 'passed';
  report();
  console.log(JSON.stringify({status, results, screenshots}, null, 2));
} catch (error) {
  status = currentScenario === 'launch Chromium' ? 'blocked' : 'failed';
  results.push({name: currentScenario, ok: false, error: error.message});
  report(error);
  throw error;
} finally {
  clearTimeout(timeout);
  await browser?.close();
  await close();
}
