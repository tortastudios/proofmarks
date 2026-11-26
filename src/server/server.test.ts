import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProofmarksRoutes } from './index';
import { fixture } from './fixture';
test('framework-neutral session and review fixture smoke', async () => {
  const root = await fixture();
  try {
    const api = createProofmarksRoutes({ projectRoot: root });
    const session = await api.GET(
      new Request('http://localhost:4848/__proofmarks/session', { headers: { origin: 'http://localhost:3000' } }),
    );
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal((await session.json()).token.length, 64);
    const review = await api.GET(new Request('http://localhost:4848/__proofmarks/review?reviewId=custom'));
    assert.equal(review.status, 200);
    assert.equal((await review.json()).findings[0].match, 'A sentence.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('the change stream says ready, then pings when the review or its source changes, and closes with the page', async () => {
  const root = await fixture();
  const controller = new AbortController();
  try {
    const api = createProofmarksRoutes({ projectRoot: root });
    const response = await api.GET(
      new Request('http://localhost:4848/__proofmarks/changes?reviewId=custom', {
        headers: { origin: 'http://localhost:3000' },
        signal: controller.signal,
      }),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let text = '';
    const until = async (pattern: RegExp) => {
      const deadline = Date.now() + 5000;
      while (!pattern.test(text)) {
        if (Date.now() > deadline) throw new Error(`No ${pattern} in ${JSON.stringify(text)}`);
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await until(/event: ready/);
    assert.match(text, /retry: 3000/);
    assert.doesNotMatch(text, /event: review/);
    await writeFile(path.join(root, 'drafts/proofmarks-fixture.mdx'), 'A sentence. Another sentence.');
    await until(/event: review/);
    text = '';
    await writeFile(
      path.join(root, 'reviews/custom.json'),
      JSON.stringify({ source: 'drafts/proofmarks-fixture.mdx', rules: [], findings: [] }),
    );
    await until(/event: review/);
    controller.abort();
    const deadline = Date.now() + 5000;
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
      if (Date.now() > deadline) throw new Error('The stream stayed open after the page left');
    }
  } finally {
    controller.abort();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } // A check already under way may still be reading state.
});
