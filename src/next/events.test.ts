import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProofmarksRoutes } from './index';
import { eventFixture } from '../events/fixture';
import { registerAgent } from '../agents/index';
import { eventFeed } from '../events/index';
test('fixture route smoke: live agents, validated target, request journal and cancellation', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const f = await eventFixture(),
    registration = await registerAgent(f.base, { name: 'codex', version: 'test' });
  const routes = createProofmarksRoutes({ projectRoot: f.base, token: 'fixture-token', defaultReviewId: 'fixture' }),
    get = (action: string) => routes.GET(new Request('http://127.0.0.1:3731/dev/proofmarks?action=' + action)),
    post = (body: unknown) =>
      routes.POST(
        new Request('http://127.0.0.1:3731/dev/proofmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Proofmarks-Token': 'fixture-token' },
          body: JSON.stringify(body),
        }),
      );
  try {
    const agents = await (await get('agents')).json();
    assert.equal(agents.agents[0].label, 'Codex');
    assert.equal(agents.resolvedTarget, registration.agent.id);
    assert.equal((await post({ action: 'target', target: 'not-live' })).status, 409);
    assert.equal((await post({ action: 'target', target: registration.agent.id })).status, 200);
    const initial = await (await get('')).json();
    const requested = await (
      await post({ action: 'request-rewrite', reviewId: 'fixture', id: 'F1', revision: initial.revision })
    ).json();
    assert.equal(requested.ok, true);
    assert.equal(requested.review.findings[0].rewriteRequest.target, registration.agent.id);
    const feed = await eventFeed(f.store);
    assert.equal(feed.events[0]?.type, 'rewrite.requested');
    assert.equal(feed.events[0]?.original, 'It is not a tool, but a revolution.');
    const cancelled = await (await post({ action: 'cancel-rewrite', reviewId: 'fixture', id: 'F1' })).json();
    assert.equal(cancelled.review.findings[0].rewriteRequest.status, 'failed');
    assert.equal(cancelled.review.findings[0].rewriteRequest.error, 'Cancelled');
  } finally {
    await registration.close();
    await f.close();
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
test('headless fixture flows through guarded routes and companion HTTP, then the scored proposal reaches GET', async () => {
  const previous = process.env.NODE_ENV,
    oldPath = process.env.PATH;
  process.env.NODE_ENV = 'development';
  const f = await eventFixture();
  const { mkdir, writeFile, readFile } = await import('node:fs/promises'),
    { serve } = await import('../companion/server'),
    { fakeProvider } = await import('../companion/fake'),
    { setTimeout: delay } = await import('node:timers/promises');
  await mkdir(f.base + '/bin');
  await writeFile(f.base + '/bin/claude', '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  process.env.PATH = f.base + '/bin:' + (oldPath ?? '');
  const server = await serve({
    provider: fakeProvider,
    roots: [f.root],
    port: 0,
    sessionDir: f.base + '/session',
    cacheDir: f.base + '/cache',
    headlessRun: async () => 'It produces a report.',
  });
  const session = JSON.parse(await readFile(f.base + '/session/session.json', 'utf8'));
  const get = () => fetch(`http://127.0.0.1:${session.port}/__proofmarks/review?reviewId=fixture`),
    post = (body: { action: string; [key: string]: unknown }) =>
      fetch(`http://127.0.0.1:${session.port}/__proofmarks/${body.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proofmarks-Token': session.token },
        body: JSON.stringify(body),
      });
  try {
    await post({ action: 'target', target: 'headless:claude' });
    const initial = await (await get()).json();
    assert.equal(
      (
        await (
          await post({ action: 'request-rewrite', reviewId: 'fixture', id: 'F1', revision: initial.revision })
        ).json()
      ).ok,
      true,
    );
    let review;
    for (let i = 0; i < 100; i++) {
      review = await (await get()).json();
      if (review.findings[0].rewriteRequest.status === 'proposed') break;
      await delay(20);
    }
    assert.equal(review.findings[0].rewriteRequest.status, 'proposed');
    assert.equal(review.findings[0].judge.after.provider, 'fake');
    assert.equal(review.findings[0].proposed, 'It produces a report.');
    assert.equal(await readFile(f.root + '/proofmarks-fixture.mdx', 'utf8'), f.text);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await f.close();
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});
test('offline companion produces a persisted plain error without generating prompt input from the page', async () => {
  const previous = process.env.NODE_ENV,
    oldPath = process.env.PATH;
  process.env.NODE_ENV = 'development';
  const f = await eventFixture();
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(f.base + '/bin');
  await writeFile(f.base + '/bin/claude', '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  process.env.PATH = f.base + '/bin:' + (oldPath ?? '');
  const { selectTarget } = await import('../agents/index');
  try {
    await selectTarget(f.base, 'headless:claude');
    const routes = createProofmarksRoutes({
      projectRoot: f.base,
      token: 'fixture-token',
      defaultReviewId: 'fixture',
      companionRequest: async () => ({
        ok: false,
        connected: false,
        reason: 'Proofmarks companion is not running. Start proofmarks serve.',
      }),
    });
    const initial = await (await routes.GET(new Request('http://127.0.0.1:3731/dev/proofmarks'))).json();
    const send = (body: unknown) =>
      routes.POST(
        new Request('http://127.0.0.1:3731/dev/proofmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Proofmarks-Token': 'fixture-token' },
          body: JSON.stringify(body),
        }),
      );
    assert.equal(
      (
        await send({
          action: 'request-rewrite',
          reviewId: 'fixture',
          id: 'F1',
          revision: initial.revision,
          prompt: 'UNTRUSTED PAGE PROMPT MUST NOT BE USED',
        })
      ).status,
      400,
    );
    const response = await send({
      action: 'request-rewrite',
      reviewId: 'fixture',
      id: 'F1',
      revision: initial.revision,
    });
    const result = await response.json();
    assert.equal(result.review.findings[0].rewriteRequest.status, 'failed');
    assert.match(result.review.findings[0].rewriteRequest.error, /companion is not running/);
    assert.ok(!JSON.stringify(await eventFeed(f.store)).includes('UNTRUSTED PAGE PROMPT'));
  } finally {
    await f.close();
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});
