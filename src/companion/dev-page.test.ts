import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from '../server/fixture';
import { fakeProvider } from './fake';
import { clearDevPage, devPage, pagePath, recordDevPage, runningDev } from './dev-page';
import { ReviewService } from './service';

test('an agent opens the page through the running dev proxy, and is told how to start it otherwise', async () => {
  const root = await fixture(),
    opened: string[] = [];
  try {
    const service = await ReviewService.create({
      root: path.join(root, 'drafts'),
      provider: fakeProvider,
      openUrl: url => opened.push(url),
    });
    const stopped = await service.openPage('custom');
    assert.equal(stopped.opened, false);
    assert.match(stopped.reason!, /proofmarks dev/);

    await recordDevPage(root, { port: 4321, pid: process.pid, to: 'http://localhost:3000' });
    assert.equal(await devPage(root), 'http://127.0.0.1:4321');
    assert.deepEqual(await runningDev(root), { address: 'http://127.0.0.1:4321', pid: process.pid });
    assert.deepEqual(await service.openPage('custom'), { opened: true, url: 'http://127.0.0.1:4321/essay?proof=1' });
    assert.deepEqual(opened, ['http://127.0.0.1:4321/essay?proof=1']);

    // A record left by a dev command that's gone counts as not running.
    await recordDevPage(root, { port: 4321, pid: 2147483647, to: 'http://localhost:3000' });
    assert.equal(await devPage(root), undefined);
    await writeFile(path.join(root, '.proofmarks/dev.json'), 'not json');
    assert.equal(await devPage(root), undefined);
    await clearDevPage(root);
    assert.equal(await devPage(root), undefined);
    await assert.rejects(service.openPage('missing'), /not in this project/);
    assert.equal(opened.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a pattern url finds the real page: a path its source suggests, served with the post in it', async () => {
  const post = "---\ntitle: Faster CI\n---\n\nIn today's fast-paced software landscape, every minute matters.";
  const asked: string[] = [];
  // Like Vite in single-page mode: every path answers 200 with the home page, except the post's own path.
  const site = (async (url: string | URL) => {
    const at = new URL(url).pathname;
    asked.push(at);
    return new Response(
      at === '/blog/faster-ci/'
        ? '<main><p>In today&#39;s <em>fast-paced</em> software landscape, every minute matters.</p></main>'
        : '<main><h1>Home</h1><p>Welcome to the blog.</p></main>',
      { headers: { 'content-type': 'text/html' } },
    );
  }) as typeof fetch;
  const base = 'http://127.0.0.1:4850';
  assert.equal(await pagePath('/*/faster-ci*', 'src/content/blog/faster-ci.md', post, base, site), '/blog/faster-ci/');
  assert.ok(!asked.includes('/faster-ci/'), 'paths the pattern rules out are never asked');
  assert.equal(await pagePath('/essay', 'drafts/essay.md', post, base, site), '/essay', 'a plain url is used as is');
  assert.equal(await pagePath(undefined, 'index.html', post, base, site), '/');
  // With no run of plain words to look for, a page that is just the home page doesn't count.
  assert.equal(await pagePath('/*/faster-ci*', 'src/content/blog/faster-ci.md', 'Hi.', base, site), '/blog/faster-ci/');
  const gone = (async () => new Response('Not found', { status: 404 })) as typeof fetch;
  assert.equal(await pagePath('/*/faster-ci*', 'src/content/blog/faster-ci.md', post, base, gone), undefined);
});
