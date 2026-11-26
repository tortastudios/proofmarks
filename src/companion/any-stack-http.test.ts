import { createProofmarksForwarders } from '../server/forward';
import { get } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { eventFixture } from '../events/fixture';
import { serve } from './server';
import { fakeProvider } from './fake';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('actual helper HTTP session → Ask → fake headless proposal → Accept → Undo, with identity-only refresh', async () => {
  const f = await eventFixture();
  const previousPath = process.env.PATH;
  let calls = 0;
  const bin = path.join(f.base, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nexit 97\n', { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + (previousPath ?? '');
  const server = await serve({
    provider: fakeProvider,
    roots: [f.root],
    projectRoot: f.base,
    port: 0,
    cacheDir: path.join(f.base, 'cache'),
    headlessRun: async () => {
      calls++;
      return 'It compiles the sales records.';
    },
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/__proofmarks/`;
  try {
    await writeFile(
      path.join(f.base, '.proofmarks/companion.json'),
      JSON.stringify({
        port: (server.address() as { port: number }).port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
    const forwarder = createProofmarksForwarders({ projectRoot: f.base });
    const forwarded = await forwarder.GET(new Request('http://localhost:3000/__proofmarks/session'));
    assert.equal(forwarded.status, 200);
    const forwardedSession = await forwarded.json();
    assert.equal(
      (
        await forwarder.GET(
          new Request('http://localhost:3000/__proofmarks/session', { headers: { host: 'evil.example' } }),
        )
      ).status,
      403,
    );
    const session = await (await fetch(base + 'session', { headers: { origin: 'http://localhost:3210' } })).json();
    assert.equal(session.project, f.base);
    assert.equal(forwardedSession.token, session.token);
    const headers = { 'content-type': 'application/json', 'x-proofmarks-token': session.token };
    const post = async (endpoint: string, body: unknown) =>
      fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const review = async () => await (await fetch(base + 'review?reviewId=fixture')).json();
    assert.equal((await post('target', { target: 'headless:codex' })).status, 200);
    assert.equal(
      (await post('request-rewrite', { reviewId: 'fixture', id: 'F1', revision: (await review()).revision })).status,
      200,
    );
    let proposed = await review();
    for (let i = 0; i < 100 && proposed.findings[0].rewriteRequest.status !== 'proposed'; i++) {
      await pause(20);
      proposed = await review();
    }
    assert.equal(proposed.findings[0].rewriteRequest.status, 'proposed');
    assert.equal(calls, 1);
    assert.equal(proposed.findings[0].proposed, 'It compiles the sales records.');
    const accepted = await post('decision', {
      action: 'accept',
      reviewId: 'fixture',
      id: 'F1',
      revision: proposed.revision,
    });
    const acceptedText = await accepted.text();
    assert.equal(accepted.status, 200, acceptedText);
    const acceptedReview = JSON.parse(acceptedText).review;
    assert.equal(
      (await post('decision', { action: 'revert', reviewId: 'fixture', id: 'F1', revision: acceptedReview.revision }))
        .status,
      200,
    );
    assert.equal(await readFile(path.join(f.root, 'proofmarks-fixture.mdx'), 'utf8'), f.text);
    assert.equal((await post('review', { reviewId: 'fixture', path: 'forbidden' })).status, 400);
    assert.equal((await post('review', { reviewId: 'fixture' })).status, 200);
    const hostile = await new Promise<number | undefined>((resolve, reject) => {
      get(base + 'session', { headers: { host: 'evil.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(hostile, 403);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    await f.close();
  }
});
