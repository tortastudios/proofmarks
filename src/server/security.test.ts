import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture';
import { createProofmarksRoutes } from './index';
const url = 'http://localhost:4848/__proofmarks/';
test('Host, origin, CORS preflight, token, body size, identity injection and tailnet guards', async () => {
  const root = await fixture();
  try {
    const api = createProofmarksRoutes({ projectRoot: root });
    const get = (headers: Record<string, string>) => api.handle(new Request(url + 'session', { headers }));
    for (const headers of [
      { host: 'evil.example' },
      { host: 'localhost.evil.example' },
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { origin: 'ftp://localhost' },
    ] as Record<string, string>[]) {
      const response = await get(headers);
      assert.equal(response.status, 403);
      assert.equal(response.headers.has('access-control-allow-origin'), false);
    }
    for (const origin of ['http://localhost:3000', 'https://127.0.0.1:9999', 'http://[::1]:3000'])
      assert.equal((await get({ origin })).status, 200);
    const preflight = await api.handle(
      new Request(url + 'decision', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-proofmarks-token,content-type',
        },
      }),
    );
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-headers')!, /X-Proofmarks-Token/);
    const token = (await (await get({})).json()).token;
    const post = (body: unknown, extra: Record<string, string> = {}) =>
      api.handle(
        new Request(url + 'decision', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-proofmarks-token': token, ...extra },
          body: JSON.stringify(body),
        }),
      );
    assert.equal((await post({}, { 'x-proofmarks-token': 'wrong' })).status, 403);
    assert.equal((await post({}, { 'x-proofmarks-token': 'é'.repeat(64) })).status, 403);
    assert.equal((await post({}, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post({ unexpected: 'x'.repeat(65536) })).status, 413);
    for (const field of ['path', 'prompt', 'text', 'command'])
      assert.equal(
        (await post({ action: 'dismiss', id: 'F', reviewId: 'custom', revision: 'stale', [field]: 'injection' }))
          .status,
        400,
      );
    const config = JSON.parse(await readFile(path.join(root, 'proofmarks.config.json'), 'utf8'));
    config.tailnetHosts = ['machine.tail.ts.net'];
    config.tailscaleUsers = ['allowed@example.com'];
    config.origins = ['https://preview.example.com'];
    await writeFile(path.join(root, 'proofmarks.config.json'), JSON.stringify(config));
    assert.equal((await get({ origin: 'https://preview.example.com' })).status, 200);
    for (const login of ['', 'denied@example.com'])
      assert.equal((await get({ host: 'machine.tail.ts.net', 'tailscale-user-login': login })).status, 403);
    assert.equal(
      (
        await get({
          host: 'machine.tail.ts.net',
          'tailscale-user-login': 'allowed@example.com',
          origin: 'https://machine.tail.ts.net',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await get({
          host: 'machine.tail.ts.net',
          'tailscale-user-login': 'allowed@example.com',
          origin: 'https://evil.example',
        })
      ).status,
      403,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
