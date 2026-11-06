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

test('direct and Wrangler Miniflare resolve the patched undici without changing workerd', () => {
  for (const parent of [direct, viaWrangler]) {
    assert.equal(parent('undici/package.json').version, '7.30.2');
    assert.equal(parent('workerd/package.json').version, '1.20261006.1');
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
