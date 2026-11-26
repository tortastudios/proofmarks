import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { serve } from './server';
import { fakeProvider } from './fake';
const work = new URL('../../.test-work/', import.meta.url);
test('loopback token, session permissions, status, origin and realpath guards', async () => {
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(new URL('server-', work).pathname);
  const root = path.join(dir, 'documents');
  await mkdir(root);
  const sessionDir = path.join(dir, 'session');
  const outside = path.join(dir, 'outside.mdx');
  await writeFile(outside, 'Outside');
  await symlink(outside, path.join(root, 'escape.mdx'));
  const server = await serve({
    provider: fakeProvider,
    roots: [root],
    port: 0,
    sessionDir,
    cacheDir: path.join(dir, 'cache'),
  });
  try {
    const session = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
    const url = `http://127.0.0.1:${session.port}`;
    const headers = { authorization: `Bearer ${session.token}` };
    assert.equal((await stat(path.join(sessionDir, 'session.json'))).mode & 0o777, 0o600);
    assert.equal((await fetch(url + '/status')).status, 403);
    const status = await fetch(url + '/status', { headers });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).connected, true);
    assert.equal(
      (await fetch(url + '/status', { headers: { ...headers, origin: 'https://evil.example' } })).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + '/review', {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ path: path.join(root, 'escape.mdx') }),
        })
      ).status,
      403,
    );
    assert.equal((await fetch(url + '/status', { headers: { authorization: 'é'.repeat(71) } })).status, 403);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true });
  }
});
