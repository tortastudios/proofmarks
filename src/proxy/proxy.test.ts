import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { rm } from 'node:fs/promises';
import { fixture } from '../server/fixture';
import { devProxy } from './index';
const listen = (server: Server) =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
const close = (server: Server) =>
  new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
test('real proxy: compressed HTML, unchanged JSON, streaming, redirects, all methods, helper API, and websocket echo', async () => {
  const root = await fixture();
  const json = Buffer.from('{ "unchanged": [1, 2, 3] }\n');
  let websocketClosed: Promise<void> | undefined;
  const upstream = createServer((req, res) => {
    if (req.url === '/json') {
      res.setHeader('content-type', 'application/json');
      res.end(json);
      return;
    }
    if (req.url === '/stream') {
      res.setHeader('content-type', 'text/event-stream');
      res.write('first\n');
      const timer = setTimeout(() => res.end('last\n'), 300);
      res.once('close', () => clearTimeout(timer));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/destination` });
      res.end();
      return;
    }
    if (req.url === '/echo') {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('x-method', req.method!);
      req.pipe(res);
      return;
    }
    const html = Buffer.from('<!doctype html><body><p>Hello</p></body>');
    const encoding = req.url?.slice(1);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-security-policy', "script-src 'none'");
    if (encoding && ['gzip', 'br', 'deflate'].includes(encoding)) {
      res.setHeader('content-encoding', encoding);
      res.end(encoding === 'gzip' ? gzipSync(html) : encoding === 'br' ? brotliCompressSync(html) : deflateSync(html));
    } else res.end(html);
  });
  upstream.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    websocketClosed = new Promise(resolve => socket.once('close', () => resolve()));
    socket.on('data', bytes => {
      if (bytes[0] === 0x88) {
        socket.end(Buffer.from([0x88, 0]));
        return;
      }
      const length = bytes[1]! & 0x7f,
        mask = bytes.subarray(2, 6),
        data = bytes.subarray(6, 6 + length);
      for (let i = 0; i < data.length; i++) data[i] = data[i]! ^ mask[i % 4]!;
      socket.write(Buffer.concat([Buffer.from([0x81, data.length]), data]));
    });
  });
  const helper = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{"helper":true}');
  });
  const upstreamPort = await listen(upstream),
    helperPort = await listen(helper),
    proxy = await devProxy({ projectRoot: root, to: `http://127.0.0.1:${upstreamPort}`, helperPort, port: 0 });
  const port = (proxy.address() as { port: number }).port,
    base = `http://127.0.0.1:${port}`;
  try {
    for (const route of ['/', '/gzip', '/br', '/deflate']) {
      const response = await fetch(base + route);
      const text = await response.text();
      assert.match(text, /<script src="\/__proofmarks\/script.js" defer><\/script><\/body>/);
      assert.equal(response.headers.has('content-security-policy'), false);
      assert.equal(response.headers.has('content-encoding'), false);
    }
    assert.deepEqual(Buffer.from(await (await fetch(base + '/json')).arrayBuffer()), json);
    const streamed = await fetch(base + '/stream');
    const reader = streamed.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first\n');
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'last\n');
    await reader.cancel();
    assert.equal(
      (await fetch(base + '/redirect', { redirect: 'manual' })).headers.get('location'),
      base + '/destination',
    );
    const echo = await fetch(base + '/echo', { method: 'PATCH', body: 'streamed body' });
    assert.equal(echo.headers.get('x-method'), 'PATCH');
    assert.equal(await echo.text(), 'streamed body');
    assert.deepEqual(await (await fetch(base + '/__proofmarks/session')).json(), { helper: true });
    const socket = connect(port, '127.0.0.1');
    try {
      const echoed = new Promise<string>((resolve, reject) => {
        let upgraded = false,
          buffer = Buffer.alloc(0);
        socket.on('data', chunk => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!upgraded) {
            const end = buffer.indexOf('\r\n\r\n');
            if (end < 0) return;
            assert.match(buffer.subarray(0, end).toString(), /101 Switching Protocols/);
            buffer = buffer.subarray(end + 4);
            upgraded = true;
            const mask = randomBytes(4),
              payload = Buffer.from('hello');
            for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
            socket.write(Buffer.concat([Buffer.from([0x81, 0x85]), mask, payload]));
          }
          if (buffer.length >= 7) resolve(buffer.subarray(2, 7).toString());
        });
        socket.on('error', reject);
      });
      socket.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      assert.equal(await echoed, 'hello');
      socket.write(Buffer.from([0x88, 0]));
      await websocketClosed;
    } finally {
      socket.destroy();
    }
  } finally {
    await close(proxy);
    await close(helper);
    await close(upstream);
    await rm(root, { recursive: true, force: true });
  }
});
