import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const direct = createRequire(require.resolve('miniflare'));
const wrangler = createRequire(require.resolve('wrangler/package.json'));
const viaWrangler = createRequire(wrangler.resolve('miniflare'));
const childFixture = fileURLToPath(new URL('./fixtures/undici-response-child.cjs', import.meta.url));

test('direct and Wrangler Miniflare resolve patched undici with their intended workerd versions', () => {
  assert.equal(require('miniflare/package.json').version, '5.20261006.1-alpha');
  assert.equal(wrangler('miniflare/package.json').version, '5.20261104.0-beta');
  assert.equal(wrangler('wrangler/package.json').version, '4.158.0');
  for (const [parent, workerdVersion] of [
    [direct, '1.20261006.1'],
    [viaWrangler, '1.20261104.1'],
  ]) {
    assert.equal(parent('undici/package.json').version, '7.30.2');
    assert.equal(parent('workerd/package.json').version, workerdVersion);
  }
});

test('Wrangler Miniflare starts its pinned native workerd without external services', {timeout: 10000}, async () => {
  const {Miniflare} = wrangler('miniflare');
  let externalCalls = 0;
  const runtime = new Miniflare({
    cf: false,
    enableDevRegistry: false,
    workers: [{
      config: {
        name: 'synthetic-wrangler-runtime',
        compatibilityDate: '2026-10-09',
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        manifest: {
          mainModule: 'fixture.mjs',
          modules: {
            'fixture.mjs': {
              type: 'esm',
              contents: "export default {fetch() {return new Response('synthetic-wrangler-runtime');}};",
            },
          },
        },
      },
      dev: {
        outboundService: {
          type: 'fetcher',
          handler: async () => {
            externalCalls++;
            throw new Error('No external network permitted');
          },
        },
      },
    }],
  });
  try {
    const response = await runtime.dispatchFetch('https://fixture.invalid/');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'synthetic-wrangler-runtime');
    assert.equal(externalCalls, 0);
  } finally {
    await runtime.dispose();
  }
});

test('Miniflare undici verifies SRI metadata separated by ASCII whitespace', () => {
  const paths = new Set([direct.resolve('undici'), viaWrangler.resolve('undici')]);
  const fixture = fileURLToPath(new URL('./fixtures/undici-integrity-child.cjs', import.meta.url));
  for (const path of paths) {
    const child = spawnSync(process.execPath, [fixture, path], {encoding: 'utf8', timeout: 5000});
    assert.equal(child.error, undefined, 'Synthetic SRI child must finish within its bound');
    assert.equal(child.signal, null, 'Synthetic SRI child must not be terminated');
    assert.equal(child.status, 0, 'SRI must reject wrong digests and accept matching digests');
    assert.match(child.stdout, /integrity-cases-passed: 11/);
  }
});

test('Miniflare undici survives a rejected excessive-encoding response and truncated body', () => {
  const paths = new Set([direct.resolve('undici'), viaWrangler.resolve('undici')]);
  for (const path of paths) {
    const child = spawnSync(process.execPath, [childFixture, path], {encoding: 'utf8', timeout: 5000});
    assert.equal(child.error, undefined, 'Synthetic HTTP child must finish within its bound');
    assert.equal(child.signal, null, 'Synthetic HTTP child must not be terminated');
    assert.equal(child.status, 0, 'A rejected fetch must not crash the child process');
    assert.match(child.stdout, /fetch-rejection-caught/);
    assert.match(child.stdout, /process-survived/);
  }
});
