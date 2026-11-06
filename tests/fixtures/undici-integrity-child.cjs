// Synthetic constant response on loopback only. No user data or external service.
const assert = require('node:assert/strict');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {fetch, Agent} = require(process.argv[2]);
const body = 'synthetic-integrity-fixture';
const digest = (value, algorithm = 'sha256') => `${algorithm}-${createHash(algorithm).update(value).digest('base64')}`;
const timer = setTimeout(() => process.exit(2), 3000);
const agent = new Agent();
const server = http.createServer((_request, response) => {
  response.writeHead(200, {'Content-Type': 'text/plain', 'Connection': 'close'});
  response.end(body);
});
server.on('error', () => process.exit(2));
server.listen(0, '127.0.0.1', async () => {
  let cases = 0;
  try {
    const url = `http://127.0.0.1:${server.address().port}/synthetic`;
    for (const whitespace of [' ', '\t', '\n', '\f', '\r']) {
      const matching = await fetch(url, {dispatcher: agent, integrity: whitespace + digest(body) + whitespace});
      assert.equal(await matching.text(), body);
      cases++;
      await assert.rejects(fetch(url, {dispatcher: agent, integrity: whitespace + digest('wrong-synthetic-body') + whitespace}), error => error.cause?.message === 'integrity mismatch');
      cases++;
    }
    await assert.rejects(fetch(url, {dispatcher: agent, integrity: digest(body) + '\t' + digest('wrong-synthetic-body', 'sha512')}), error => error.cause?.message === 'integrity mismatch');
    cases++;
    console.log(`integrity-cases-passed: ${cases}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await agent.close();
    server.close(() => clearTimeout(timer));
  }
});
