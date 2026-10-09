import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import verifyOwnerRequest, { createAccessGuard } from '../src/access.mjs';

// All identities, configuration and keys below are synthetic test fixtures.
// No real Access account or network request is used by these tests.
const TEAM = 'https://synthetic-owner-tests.cloudflareaccess.com';
const AUD = 'synthetic-app-audience';
const OWNER = 'owner@example.test';
const ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER };
const KID = 'synthetic-trusted-key';
const [trusted, attacker] = await Promise.all([
  generateKeyPair('RS256', { extractable: true }),
  generateKeyPair('RS256', { extractable: true }),
]);
const trustedJwk = { ...(await exportJWK(trusted.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
const attackerJwk = { ...(await exportJWK(attacker.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
const JWKS = { keys: [trustedJwk] };

function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: TEAM, aud: [AUD], exp: now + 300, nbf: now - 60, sub: 'synthetic-owner-subject', email: OWNER, ...overrides };
}

async function sign(overrides = {}, { key = trusted.privateKey, header = {} } = {}) {
  const payload = claims(overrides);
  for (const name of Object.keys(payload)) {
    if (payload[name] === undefined) delete payload[name];
  }
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: KID, ...header }).sign(key);
}

function request(token, additionalHeaders = {}) {
  const headers = new Headers(additionalHeaders);
  if (token !== undefined) headers.set('Cf-Access-Jwt-Assertion', token);
  return new Request('https://reader.example.test/admin', { headers });
}

function localGuard() {
  return createAccessGuard({ jwks: JWKS, fetch: async () => { throw new Error('Unexpected network request'); } });
}

function assertDenied(result, status = 401) {
  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  assert.equal(result.identity, undefined);
  assert.ok(typeof result.error === 'string');
  assert.ok(!result.error.includes(OWNER));
}

test('exports the production guard and accepts a signed owner identity', async () => {
  assert.equal(typeof verifyOwnerRequest, 'function');
  const result = await localGuard()(request(await sign(), {
    'Cf-Access-Authenticated-User-Email': 'unsigned-other@example.test',
    'X-Owner-Email': 'unsigned-other@example.test',
  }), ENV);
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    identity: { sub: 'synthetic-owner-subject', email: OWNER },
  });
});

test('accepts the exact configured audience as a string or standard Access array', async () => {
  for (const aud of [AUD, [AUD], ['another-signed-audience', AUD]]) {
    assert.equal((await localGuard()(request(await sign({ aud })), ENV)).ok, true);
  }
});

test('does not use unsigned identity headers, Authorization, or cookies', async () => {
  const token = await sign();
  for (const headers of [
    {},
    { 'Cf-Access-Authenticated-User-Email': OWNER, 'X-Owner-Email': OWNER },
    { Authorization: `Bearer ${token}` },
    { Cookie: `CF_Authorization=${token}` },
  ]) {
    assertDenied(await localGuard()(request(undefined, headers), ENV));
  }
});

test('missing, empty, malformed, duplicated, and oversized assertions fail closed', async () => {
  const token = await sign();
  for (const assertion of ['', 'not-a-jwt', 'a.b.c', `${token}, ${token}`, 'a'.repeat(16_385)]) {
    assertDenied(await localGuard()(request(assertion), ENV));
  }
});

test('missing or invalid configuration fails closed before fetching keys', async () => {
  let fetches = 0;
  const guard = createAccessGuard({ fetch: async () => { fetches += 1; throw new Error('Unexpected request'); } });
  const token = await sign();
  const configurations = [undefined, {}, { ...ENV, ACCESS_TEAM_DOMAIN: undefined }, { ...ENV, ACCESS_AUD: undefined }, { ...ENV, OWNER_EMAIL: undefined }];
  for (const field of Object.keys(ENV)) {
    configurations.push({ ...ENV, [field]: '' }, { ...ENV, [field]: ' ' }, { ...ENV, [field]: [] });
  }
  for (const ACCESS_TEAM_DOMAIN of [
    'http://synthetic-owner-tests.cloudflareaccess.com',
    'https://attacker.example.test',
    'https://synthetic-owner-tests.cloudflareaccess.com.attacker.example.test',
    'https://nested.synthetic-owner-tests.cloudflareaccess.com',
    'https://user:pass@synthetic-owner-tests.cloudflareaccess.com',
    `${TEAM}:443`, `${TEAM}:8443`, `${TEAM}/elsewhere`, `${TEAM}?keys=attacker`, `${TEAM}#fragment`,
  ]) configurations.push({ ...ENV, ACCESS_TEAM_DOMAIN });
  configurations.push({ ...ENV, ACCESS_AUD: 'aud with spaces' }, { ...ENV, OWNER_EMAIL: 'not-an-email' });
  for (const env of configurations) assertDenied(await guard(request(token), env), 503);
  assert.equal(fetches, 0);
});

test('allows an optional trailing slash only in the configured team origin', async () => {
  assert.equal((await localGuard()(request(await sign()), { ...ENV, ACCESS_TEAM_DOMAIN: `${TEAM}/` })).ok, true);
});

test('a modified payload or an attacker signature is rejected', async () => {
  const valid = await sign();
  const parts = valid.split('.');
  parts[1] = Buffer.from(JSON.stringify(claims({ sub: 'forged-subject' }))).toString('base64url');
  assertDenied(await localGuard()(request(parts.join('.')), ENV));
  assertDenied(await localGuard()(request(await sign({}, { key: attacker.privateKey })), ENV));
});

test('alg none and symmetric-algorithm confusion are rejected', async () => {
  const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', kid: KID })).toString('base64url')}.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.`;
  assertDenied(await localGuard()(request(unsigned), ENV));
  assertDenied(await localGuard()(request(`${unsigned}AA`), ENV));
  const symmetric = await new SignJWT(claims()).setProtectedHeader({ alg: 'HS256', kid: KID }).sign(new Uint8Array(32).fill(42));
  assertDenied(await localGuard()(request(symmetric), ENV));
});

test('missing or unknown key ids are rejected', async () => {
  for (const kid of [undefined, '', 'untrusted-key-id']) {
    assertDenied(await localGuard()(request(await sign({}, { header: { kid } })), ENV));
  }
});

test('token-supplied key material and URLs never become trusted or get fetched', async () => {
  let fetches = 0;
  const guard = createAccessGuard({ fetch: async () => { fetches += 1; throw new Error('Unexpected request'); } });
  for (const header of [
    { jku: 'https://attacker.example.test/keys' },
    { jwk: attackerJwk },
    { x5u: 'https://attacker.example.test/cert' },
    { x5c: ['attacker-certificate'] },
  ]) {
    assertDenied(await guard(request(await sign({}, { key: attacker.privateKey, header })), ENV));
  }
  assert.equal(fetches, 0);
});

test('issuer and application audience are verified exactly', async () => {
  for (const overrides of [
    { iss: 'https://another-team.cloudflareaccess.com' },
    { iss: `${TEAM}/` }, { iss: undefined },
    { aud: 'another-app' }, { aud: `${AUD}-suffix` }, { aud: [`${AUD}-suffix`] }, { aud: undefined },
  ]) assertDenied(await localGuard()(request(await sign(overrides)), ENV));
});

test('requires expiration and enforces expiration and future not-before claims', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const overrides of [
    { exp: now - 60 }, { exp: now }, { exp: undefined }, { exp: 'not-a-date' },
    { nbf: now + 300 }, { nbf: 'not-a-date' },
  ]) assertDenied(await localGuard()(request(await sign(overrides)), ENV));
  assert.equal((await localGuard()(request(await sign({ nbf: undefined })), ENV)).ok, true);
});

test('requires a nonempty signed subject and email', async () => {
  for (const sub of [undefined, '', ' ', 123]) {
    assertDenied(await localGuard()(request(await sign({ sub })), ENV));
  }
  for (const email of [undefined, '', ' ', 123]) {
    assertDenied(await localGuard()(request(await sign({ email })), ENV));
  }
});

test('a different signed email cannot become the owner through spoofed headers', async () => {
  for (const email of ['another@example.test', 'OWNER@example.test']) {
    assertDenied(await localGuard()(request(await sign({ email }), {
      'Cf-Access-Authenticated-User-Email': OWNER, 'X-Owner-Email': OWNER,
    }), ENV), 403);
  }
});

test('fetches and caches only the configured team certs endpoint', async () => {
  const calls = [];
  const guard = createAccessGuard({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json(JWKS);
    },
  });
  const token = await sign();
  assert.equal((await guard(request(token), ENV)).ok, true);
  assert.equal((await guard(request(token), ENV)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url), `${TEAM}/cdn-cgi/access/certs`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers.has('cf-access-jwt-assertion'), false);
  assert.equal(calls[0].options.headers.has('authorization'), false);
});

test('the untrusted issuer cannot change the key retrieval URL', async () => {
  const urls = [];
  const guard = createAccessGuard({ fetch: async (url) => { urls.push(String(url)); return Response.json(JWKS); } });
  assertDenied(await guard(request(await sign({ iss: 'https://attacker.example.test' })), ENV));
  assert.deepEqual(urls, [`${TEAM}/cdn-cgi/access/certs`]);
});

test('JWKS network errors, malformed keys, wrong keys, and redirects fail closed', async () => {
  const token = await sign();
  for (const fetch of [
    async () => { throw new Error('Network unavailable'); },
    async () => new Response('unavailable', { status: 500 }),
    async () => new Response('not-json'),
    async () => Response.json({ keys: [] }),
    async () => Response.json({ keys: [attackerJwk] }),
    async () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example.test/keys' } }),
  ]) assertDenied(await createAccessGuard({ fetch })(request(token), ENV));
});
