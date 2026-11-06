// One loopback-only malformed response. Never contacts an external service.
const net = require('node:net');
const {fetch} = require(process.argv[2]);
const timer = setTimeout(() => process.exit(2), 3000);
const server = net.createServer(socket => {
  socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\r\nContent-Length: 1\r\nConnection: close\r\n\r\n'));
});
server.on('error', () => process.exit(2));
server.listen(0, '127.0.0.1', async () => {
  try {
    await fetch(`http://127.0.0.1:${server.address().port}/synthetic`);
    process.exitCode = 3;
  } catch {
    console.log('fetch-rejection-caught');
  }
  // The old dependency rejects fetch, then emits an unhandled stream error.
  setTimeout(() => server.close(() => {
    clearTimeout(timer);
    console.log('process-survived');
  }), 100);
});
