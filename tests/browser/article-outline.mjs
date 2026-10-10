import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {ready, close} from './fixture-server.mjs';

// Only synthetic articles in the existing in-memory, exact-loopback fixture.
// No owner credentials, production bindings, conversion service or real article.
const origin = 'http://127.0.0.1:4179';
const output = new URL('../../.sites-runtime/browser/article-outline/', import.meta.url);
mkdirSync(output, {recursive: true});
const playwrightVersion = createRequire(import.meta.url)('playwright/package.json').version;
// An existing system binary can supply supplementary local evidence. CI uses
// the pinned Playwright Chromium by leaving this override unset.
const executableOverride = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '';
const executablePath = executableOverride || chromium.executablePath();
const longHeading = '長い日本語の見出しでも、目次から本文へ迷わず移動できます。'.repeat(6);
const paragraph = 'これはブラウザー検証だけに使う架空の本文です。実際の記事・人物・アカウントとは関係ありません。'.repeat(8);
const outlineMarkdown = [
  '# 合成の導入', paragraph,
  '### 同じ見出し', paragraph,
  `###### ${longHeading}`, paragraph,
  '## [架空の見出しリンク](https://example.org/outline-reference) と `コード` と **強調** と <script>合成</script> & "引用"', paragraph,
  '#### 同じ見出し', paragraph,
  '```markdown\n# フェンス内の偽の見出し\n## これも目次に入りません\n```',
  '> ## 引用内の偽の見出し', '- # 箇条書き内の偽の見出し',
  '##### 合成の第五階層', paragraph,
  '# 合成の結び', paragraph,
].join('\n\n');
const articles = [
  {id: '59438c59-8e88-4a2d-823a-5d01d73c2d01', title: '合成の目次と長い見出し', markdown: outlineMarkdown},
  {id: '59438c59-8e88-4a2d-823a-5d01d73c2d02', title: '合成の単一見出し', markdown: '# 単一の見出し\n\n本文は一つの節だけです。'},
  {id: '59438c59-8e88-4a2d-823a-5d01d73c2d03', title: '合成の見出しなし', markdown: '見出しのない架空の本文です。\n\n```markdown\n# コード内の偽の見出し\n```\n\n> ## 引用内の偽の見出し'},
];
const levels = [1, 3, 6, 2, 4, 5, 1];
const ids = levels.map((_, index) => `yomu-section-${index + 1}`);
const headingSelector = '.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6';
const publicUrl = `${origin}/p/${articles[0].id}`;
const downloadPath = '/__synthetic-download/article-outline.html';
const results = [];
const screenshots = [];
const requests = [];
const externalRequests = [];
const warningRequests = [];
const unexpectedMutations = [];
const pageErrors = [];
let browser;
let status = 'running';
let currentScenario = 'launch Chromium';
let downloadedHtml = '';
let chromiumVersion = null;

function report(error) {
  writeFileSync(new URL('results.json', output), JSON.stringify({
    status,
    browser: executableOverride
      ? 'supplementary local system Chromium driven by pinned Playwright'
      : 'repository-pinned Playwright Chromium',
    playwrightVersion, executablePath, chromiumVersion,
    pinnedChromiumVerified: !executableOverride && status === 'passed',
    syntheticOnly: true,
    networkBoundary: 'exact loopback origin only; every other origin is aborted',
    downloadedHtmlReopened: downloadedHtml.length > 0 && status === 'passed',
    downloadValidation: 'exact downloaded bytes are served by a synthetic loopback-only browser route',
    results, screenshots, requests, externalRequests, warningRequests,
    unexpectedMutations, pageErrors,
    ...(error ? {failedScenario: currentScenario, error: error.stack || String(error)} : {}),
  }, null, 2));
}

async function fixtureFetch(path, options = {}) {
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  const response = await fetch(`${origin}${path}`, {redirect: 'error', ...options});
  assert.equal(response.status, 200, `${options.method || 'GET'} ${path}: ${await response.clone().text()}`);
  return response;
}

async function fixtureContext(name, javaScriptEnabled = false) {
  const context = await browser.newContext({
    viewport: {width: 390, height: 1000},
    javaScriptEnabled, serviceWorkers: 'block', acceptDownloads: true,
    reducedMotion: 'reduce',
  });
  context.setDefaultTimeout(10000);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const record = {scenario: name, method: request.method(), url: url.href};
    requests.push(record);
    if (url.origin !== origin) {
      externalRequests.push(record);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/out/')) {
      warningRequests.push(record);
      return route.abort('blockedbyclient');
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      unexpectedMutations.push(record);
      return route.abort('blockedbyclient');
    }
    if (url.pathname === downloadPath) {
      assert.ok(downloadedHtml, 'Downloaded bytes must exist before opening the synthetic download route');
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        headers: {'Cache-Control': 'no-store'},
        body: downloadedHtml,
      });
    }
    return route.continue();
  });
  context.on('page', page => page.on('pageerror', error => pageErrors.push({scenario: name, error: error.message})));
  return context;
}

async function screenshot(page, name) {
  await page.screenshot({path: new URL(name, output).pathname, fullPage: true});
  screenshots.push({file: name, width: page.viewportSize().width, syntheticOnly: true});
}

async function assertNoOverflow(page, scenario) {
  const size = await page.evaluate(() => ({viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth}));
  assert.ok(size.body <= size.viewport && size.document <= size.viewport, `${scenario}: ${JSON.stringify(size)}`);
  const outside = await page.locator('.article-outline a').evaluateAll(links => links
    .map(link => ({text: link.textContent, left: link.getBoundingClientRect().left, right: link.getBoundingClientRect().right}))
    .filter(link => link.left < 0 || link.right > innerWidth));
  assert.deepEqual(outside, [], `${scenario}: outline links leave the viewport`);
}

async function assertVisibleFocus(locator) {
  const focus = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      active: element === document.activeElement,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor,
      visible: bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight,
    };
  });
  assert.equal(focus.active, true, JSON.stringify(focus));
  assert.equal(focus.focusVisible, true, JSON.stringify(focus));
  assert.equal(focus.visible, true, JSON.stringify(focus));
  assert.notEqual(focus.outlineStyle, 'none', JSON.stringify(focus));
  assert.ok(focus.outlineWidth >= 2, JSON.stringify(focus));
  assert.ok(!['transparent', 'rgba(0, 0, 0, 0)'].includes(focus.outlineColor), JSON.stringify(focus));
}

async function assertOutline(page) {
  assert.equal(await page.locator('script').count(), 0, 'Reading and export remain script-free');
  const headings = await page.locator(headingSelector).evaluateAll(elements => elements.map(element => ({
    id: element.id, level: Number(element.tagName.slice(1)), text: element.textContent,
    tabindex: element.getAttribute('tabindex'),
  })));
  assert.equal(headings.length, levels.length);
  assert.deepEqual(headings.map(heading => heading.id), ids);
  assert.deepEqual(headings.map(heading => heading.level), levels);
  assert.ok(headings.every(heading => heading.tabindex === '-1'));
  assert.equal(new Set(headings.map(heading => heading.id)).size, levels.length);
  assert.equal(headings[1].text, headings[4].text, 'Duplicate heading labels keep separate deterministic targets');
  assert.equal(headings[2].text, longHeading);
  assert.equal(headings[3].text, '架空の見出しリンク と コード と 強調 と <script>合成</script> & "引用"');
  assert.equal(await page.locator('.article-outline').count(), 1);
  assert.notEqual(await page.locator('.article-outline').getAttribute('open'), null);
  assert.equal(await page.locator('.article-outline summary').textContent(), '目次');
  const navigation = page.getByRole('navigation', {name: '記事の目次', exact: true});
  assert.equal(await navigation.isVisible(), true);
  const links = navigation.getByRole('link');
  assert.equal(await links.count(), headings.length);
  assert.deepEqual(await links.allTextContents(), headings.map(heading => heading.text));
  for (const [index, heading] of headings.entries()) {
    const link = links.nth(index);
    assert.equal(await link.getAttribute('href'), `#${heading.id}`);
    assert.equal(await link.evaluate(element => element.childElementCount), 0, 'TOC labels use only safe text, without nested links or formatted markup');
    assert.equal(await link.evaluate((element, level) => Boolean(element.closest(`.outline-level-${level}`)), heading.level), true);
    assert.equal(await page.locator(`[id="${heading.id}"]`).count(), 1, 'Every fragment resolves to exactly one target');
  }
  const outlineText = await navigation.textContent();
  for (const excluded of ['フェンス内の偽の見出し', 'これも目次に入りません', '引用内の偽の見出し', '箇条書き内の偽の見出し']) {
    assert.ok(!outlineText.includes(excluded), `${excluded} must not become an outline section`);
  }
  assert.equal(await page.locator('.prose script, .prose iframe, .prose img, .prose form').count(), 0);
}

async function assertFragment(page, id, expectedBase = publicUrl, focused = false, restoredScrollY = null) {
  await page.waitForURL(`${expectedBase}#${id}`);
  const target = page.locator(`[id="${id}"]`);
  assert.equal(await target.count(), 1);
  // Native history restores the user's last scroll position in an entry. That
  // may be the TOC they scrolled back to, rather than the entry's heading.
  // New activation/deep links still must bring their actual target into view.
  if (restoredScrollY === null) {
    await page.waitForFunction(({id, focused}) => {
      const element = document.getElementById(id);
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      return bounds.top < innerHeight && bounds.bottom > 0 && (!focused || element === document.activeElement);
    }, {id, focused}, {timeout: 10000});
    const bounds = await target.boundingBox();
    assert.ok(bounds && bounds.y < page.viewportSize().height && bounds.y + bounds.height > 0,
      `${id}: fragment target is outside the viewport: ${JSON.stringify(bounds)}`);
  } else {
    await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 2, restoredScrollY, {timeout: 10000});
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - restoredScrollY) <= 2, 'Native history restores the last reading position');
  }
  if (focused) assert.equal(await target.evaluate(element => element === document.activeElement), true, 'Native fragment navigation focuses the non-tabbable heading');
  assert.equal(new URL(page.url()).pathname, new URL(expectedBase).pathname);
  assert.equal(await page.getByRole('heading', {name: '外部サイトです', exact: true}).count(), 0);
}

async function editorSnapshot(page) {
  return page.evaluate(() => ({
    title: document.querySelector('input[name="title"]').value,
    markdown: document.querySelector('#markdown-body').value,
    sourceUrl: document.querySelector('#source-url').value,
    rights: document.querySelector('.rights-check input').checked,
    status: document.querySelector('.document-status').textContent,
    shareUrl: document.querySelector('#share-url')?.value || '',
    surface: document.querySelector('.writing-surface').className,
    selectedTitle: document.querySelector('.draft-row.selected')?.textContent || '',
  }));
}

await ready;
const timeout = setTimeout(() => {
  status = 'failed';
  const error = new Error('Synthetic article outline browser QA exceeded 120 seconds.');
  report(error);
  console.error(error.message);
  process.exit(1);
}, 120000);
try {
  assert.equal(playwrightVersion, '1.62.1', 'Browser QA must use the repository-pinned Playwright version');
  if (!existsSync(executablePath)) {
    const error = new Error(`Playwright Chromium executable is not installed: ${executablePath}`);
    error.code = 'PLAYWRIGHT_CHROMIUM_MISSING';
    throw error;
  }
  browser = await chromium.launch({headless: true, ...(executableOverride ? {executablePath} : {})});
  chromiumVersion = browser.version();

  currentScenario = 'seed synthetic articles through the loopback-only fixture API';
  for (const article of articles) {
    const response = await fixtureFetch('/api/articles', {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin},
      body: JSON.stringify({...article, sourceUrl: '', published: true, rightsConfirmed: true}),
    });
    assert.deepEqual(await response.json(), {id: article.id, published: true, url: `/p/${article.id}`});
  }
  const savedBefore = await (await fixtureFetch('/api/articles')).json();
  const publicHtml = await (await fixtureFetch(`/p/${articles[0].id}`)).text();

  currentScenario = 'editor remains free of a TOC and preserves an unsaved synthetic draft';
  const editorContext = await fixtureContext('unchanged editor', true);
  const editor = await editorContext.newPage();
  await editor.goto(`${origin}/admin`, {waitUntil: 'networkidle'});
  await editor.getByRole('button', {name: new RegExp(articles[0].title)}).click();
  assert.equal(await editor.locator('.article-outline').count(), 0);
  assert.equal(await editor.locator('#markdown-body').inputValue(), outlineMarkdown);
  await editor.getByRole('button', {name: 'Markdown', exact: true}).click();
  await editor.locator('#markdown-body').fill(`${outlineMarkdown}\n\n## 合成の未保存追記\n\nこの編集は保存しません。`);
  await editor.locator('input[name="title"]').fill('合成の未保存タイトル');
  await editor.locator('.rights-check input').check();
  await editor.getByRole('button', {name: 'プレビュー', exact: true}).click();
  assert.equal(await editor.locator('.article-outline').count(), 0);
  const editorBefore = await editorSnapshot(editor);

  const context = await fixtureContext('script-free public article');
  const page = await context.newPage();
  for (const width of [320, 390, 768, 1440]) {
    currentScenario = `native keyboard details, visible focus and no overflow at ${width}px with JavaScript disabled`;
    await page.setViewportSize({width, height: 1000});
    await page.goto(publicUrl, {waitUntil: 'networkidle'});
    await assertOutline(page);
    await assertNoOverflow(page, currentScenario);
    await screenshot(page, `reading-open-${width}.png`);
    const summary = page.locator('.article-outline summary');
    assert.ok((await summary.boundingBox()).height >= 44, 'The native disclosure has a 44px touch target');
    assert.ok((await page.locator('.article-outline a').evaluateAll(links => links.map(link => link.getBoundingClientRect().height)))
      .every(height => height >= 44), 'Outline links retain 44px touch targets at every tested width');
    await summary.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await assertVisibleFocus(summary);
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.article-outline').getAttribute('open'), null);
    assert.equal(await page.locator('.article-outline a').first().isVisible(), false);
    await screenshot(page, `reading-closed-focus-${width}.png`);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.article-outline'))), false, 'Closed native details must skip hidden outline links');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.notEqual(await page.locator('.article-outline').getAttribute('open'), null);
    await page.keyboard.press('Tab');
    const firstLink = page.getByRole('navigation', {name: '記事の目次', exact: true}).getByRole('link').first();
    await assertVisibleFocus(firstLink);
    await screenshot(page, `reading-link-focus-${width}.png`);
    const requestsBeforeFragment = requests.length;
    await page.keyboard.press('Enter');
    await assertFragment(page, ids[0], publicUrl, true);
    assert.equal(requests.length, requestsBeforeFragment, 'An internal fragment must not perform a network request');
    results.push({name: `script-free semantic outline, safe long Japanese labels, native details and focused fragment at ${width}px`, ok: true});
  }

  currentScenario = 'fragment deep links, reload and native back/forward with JavaScript disabled';
  await page.setViewportSize({width: 390, height: 1000});
  await page.goto(`${publicUrl}#${ids[2]}`, {waitUntil: 'networkidle'});
  await assertFragment(page, ids[2]);
  await page.reload({waitUntil: 'networkidle'});
  await assertOutline(page);
  await assertFragment(page, ids[2]);
  const navigation = page.getByRole('navigation', {name: '記事の目次', exact: true});
  const requestsBeforeHistory = requests.length;
  await navigation.getByRole('link').nth(1).click();
  await assertFragment(page, ids[1], publicUrl, true);
  // A reader scrolls back to the TOC to choose the next section. Preserve that
  // real prior-entry position in history instead of requiring a new anchor jump.
  await navigation.getByRole('link').nth(4).scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const beforeNextFragment = await page.evaluate(() => scrollY);
  await navigation.getByRole('link').nth(4).click();
  await assertFragment(page, ids[4], publicUrl, true);
  const beforeBack = await page.evaluate(() => scrollY);
  await page.goBack();
  await assertFragment(page, ids[1], publicUrl, false, beforeNextFragment);
  await page.goForward();
  await assertFragment(page, ids[4], publicUrl, false, beforeBack);
  assert.equal(requests.length, requestsBeforeHistory, 'Fragment click/back/forward stays within the existing document');
  await screenshot(page, 'fragment-history-390.png');
  results.push({name: 'duplicate heading direct links and reload jump to their targets; native back/forward restores the saved reading position without JavaScript or requests', ok: true});

  currentScenario = 'single or absent headings have no redundant outline';
  for (const [article, count] of [[articles[1], 1], [articles[2], 0]]) {
    await page.goto(`${origin}/p/${article.id}`, {waitUntil: 'networkidle'});
    assert.equal(await page.locator('.article-outline').count(), 0);
    assert.equal(await page.getByRole('navigation', {name: '記事の目次', exact: true}).count(), 0);
    assert.equal(await page.locator(headingSelector).count(), count);
    assert.equal(await page.locator('script').count(), 0);
    if (count) {
      assert.equal(await page.locator(headingSelector).getAttribute('id'), ids[0]);
      assert.equal(await page.locator(headingSelector).getAttribute('tabindex'), '-1');
    }
  }
  results.push({name: 'zero/one body heading omit the outline, fenced and quoted pseudo-headings do not count', ok: true});

  currentScenario = 'actual HTML download is byte-identical and its fragment targets resolve';
  await page.goto(publicUrl, {waitUntil: 'networkidle'});
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('link', {name: 'HTMLを保存 ↓', exact: true}).click();
  const download = await pendingDownload;
  assert.equal(download.suggestedFilename(), `article-${articles[0].id}.html`);
  assert.equal(await download.failure(), null);
  await download.saveAs(new URL('synthetic-article.html', output).pathname);
  downloadedHtml = readFileSync(new URL('synthetic-article.html', output), 'utf8');
  assert.equal(downloadedHtml, publicHtml, 'Public reading and the actual HTML download share exactly the same script-free document');
  const downloadedPage = await context.newPage();
  const downloadedUrl = `${origin}${downloadPath}`;
  await downloadedPage.goto(downloadedUrl, {waitUntil: 'networkidle'});
  await assertOutline(downloadedPage);
  await assertNoOverflow(downloadedPage, currentScenario);
  const downloadedNavigation = downloadedPage.getByRole('navigation', {name: '記事の目次', exact: true});
  const requestsBeforeDownloadFragments = requests.length;
  for (const [index, id] of ids.entries()) {
    await downloadedNavigation.getByRole('link').nth(index).click();
    await assertFragment(downloadedPage, id, downloadedUrl, true);
  }
  assert.equal(requests.length, requestsBeforeDownloadFragments, 'Every downloaded outline target is local to the downloaded document');
  await downloadedPage.reload({waitUntil: 'networkidle'});
  await assertFragment(downloadedPage, ids.at(-1), downloadedUrl);
  await screenshot(downloadedPage, 'downloaded-outline-fragment-390.png');
  results.push({name: 'actual synthetic HTML download equals public HTML byte-for-byte; every local target and reload work with JavaScript disabled', ok: true});

  currentScenario = 'saved Markdown and complete unsaved editor state remain unchanged';
  assert.deepEqual(await editorSnapshot(editor), editorBefore);
  assert.equal(await editor.locator('.article-outline').count(), 0);
  const savedAfter = await (await fixtureFetch('/api/articles')).json();
  assert.deepEqual(savedAfter, savedBefore, 'All saved Markdown, publication and timestamps remain unchanged by outline interactions');
  assert.equal(savedAfter.articles.find(article => article.id === articles[0].id).markdown, outlineMarkdown);
  await screenshot(editor, 'editor-unchanged-390.png');
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(warningRequests, []);
  assert.deepEqual(unexpectedMutations, []);
  assert.deepEqual(pageErrors, []);
  results.push({name: 'public/download TOC leaves saved articles and full unsaved editor state unchanged, with no external/warning-route requests, API mutations or page errors', ok: true});
  status = 'passed';
  report();
  console.log(JSON.stringify({status, results, output: output.pathname, pinnedChromiumVerified: !executableOverride}, null, 2));
} catch (error) {
  status = 'failed';
  report(error);
  throw error;
} finally {
  clearTimeout(timeout);
  await browser?.close();
  await close();
}
