import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { eventFixture } from './fixture';
import { eventFeed, projectEvent, updateRequest, expireClaims } from './index';
import { createMcpServer } from '../companion/mcp';
import { fakeProvider } from '../companion/fake';
import { agentStatus } from '../agents/index';
import { childEnv } from '../companion/keys';
import { setTimeout as delay } from 'node:timers/promises';
async function until(check: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error('Condition did not appear');
}
async function registered(base: string, count: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = await agentStatus(base);
    if (status.agents.length === count) return status;
    await delay(10);
  }
  throw new Error('Registration did not appear');
}
async function request(store: Awaited<ReturnType<typeof eventFixture>>['store'], target?: string) {
  return updateRequest(
    store,
    'fixture',
    'F1',
    f => ({ ...f, rewriteRequest: { status: 'pending', target, requestedAt: new Date().toISOString() } }),
    'rewrite.requested',
  );
}
test('catalog projects rewrite lifecycle and informational decisions with durable cursors', async () => {
  const f = await eventFixture();
  try {
    await request(f.store, 'agent-1');
    const first = await eventFeed(f.store);
    assert.equal(first.events[0]?.v, 1);
    assert.equal(first.events[0]?.type, 'rewrite.requested');
    assert.match(first.events[0]?.why ?? '', /./);
    assert.equal(first.events[0]?.target, 'agent-1');
    assert.equal((await eventFeed(f.store, first.cursor)).events.length, 0);
    const finding = (await f.store.read('fixture')).review!.findings[0]!;
    for (const [action, type] of [
      ['accept', 'decision.accepted'],
      ['dismiss', 'decision.dismissed'],
      ['revert', 'decision.undone'],
      ['restore', 'decision.undone'],
    ])
      assert.equal(
        projectEvent({ action, eventId: action, timestamp: 'November 6, 2026', after: { finding } }, 'fixture')?.type,
        type,
      );
  } finally {
    await f.close();
  }
});
test('two concurrent MCP processes compete under one review lock: exactly one claim wins', async () => {
  const f = await eventFixture(),
    clients: Client[] = [];
  try {
    await request(f.store);
    for (let i = 0; i < 2; i++) {
      const client = new Client({ name: 'codex', version: 'test' }),
        transport = new StdioClientTransport({
          command: process.execPath,
          args: [
            new URL('../companion/bin.mjs', import.meta.url).pathname,
            'mcp',
            '--project',
            f.base,
            '--judge',
            'fake',
          ],
          cwd: f.base,
          env: Object.fromEntries(Object.entries(childEnv()).filter((e): e is [string, string] => e[1] !== undefined)),
          stderr: 'pipe',
        });
      await client.connect(transport);
      clients.push(client);
    }
    await registered(f.base, 2);
    const results = await Promise.all(
      clients.map(c => c.callTool({ name: 'proofmarks_claim', arguments: { reviewId: 'fixture', findingId: 'F1' } })),
    );
    assert.equal(results.filter(r => !r.isError).length, 1);
    assert.equal(results.filter(r => r.isError).length, 1);
    const saved = (await f.store.read('fixture')).review!.findings[0]!;
    assert.equal(saved.rewriteRequest?.status, 'claimed');
    const loser = results[0]!.isError ? clients[0]! : clients[1]!;
    assert.equal(
      (
        await loser.callTool({
          name: 'proofmarks_propose_rewrite',
          arguments: { reviewId: 'fixture', findingId: 'F1', text: 'It produces a report.' },
        })
      ).isError,
      true,
    );
    await expireClaims(f.store, Date.now() + 121000);
    assert.equal((await f.store.read('fixture')).review!.findings[0]!.rewriteRequest?.status, 'pending');
  } finally {
    await Promise.all(clients.map(c => c.close()));
    await f.close();
  }
});
test('watch returns targeted work, claim/propose succeeds, decisions return once and timeout is explicit', async () => {
  const f = await eventFixture(),
    { server } = await createMcpServer({ root: f.root, provider: fakeProvider, cacheDir: f.base + '/cache' }),
    client = new Client({ name: 'codex', version: 'test' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const agent = (await registered(f.base, 1)).agents[0]!;
    // Wait for the states themselves, not fixed short timers: a busy machine can take longer than 30 ms to register the watch
    // or notice a change. Generous timeouts cost nothing here, since watch returns as soon as work arrives.
    const watch = client.callTool({ name: 'proofmarks_watch', arguments: { timeoutSeconds: 15 } });
    await until(async () => (await agentStatus(f.base)).agents[0]?.delivery === 'watch');
    await request(f.store, agent.id);
    const result = await watch;
    assert.equal((result.structuredContent as { pending: unknown[] }).pending.length, 1);
    assert.equal(
      (await client.callTool({ name: 'proofmarks_claim', arguments: { reviewId: 'fixture', findingId: 'F1' } }))
        .isError,
      undefined,
    );
    assert.equal(
      (
        await client.callTool({
          name: 'proofmarks_propose_rewrite',
          arguments: { reviewId: 'fixture', findingId: 'F1', text: 'It produces a report.' },
        })
      ).isError,
      undefined,
    );
    assert.equal((await f.store.read('fixture')).review!.findings[0]?.rewriteRequest?.status, 'proposed');
    assert.equal(
      (
        (await client.callTool({ name: 'proofmarks_watch', arguments: { timeoutSeconds: 0.01 } }))
          .structuredContent as { timeout?: boolean }
      )?.timeout,
      true,
    );
    await updateRequest(f.store, 'fixture', 'F1', f => ({ ...f, status: 'dismissed' }), 'decision.dismissed');
    const decision = await client.callTool({ name: 'proofmarks_watch', arguments: { timeoutSeconds: 15 } });
    assert.equal((decision.structuredContent as { events: { type: string }[] }).events[0]?.type, 'decision.dismissed');
    assert.equal(
      (
        (await client.callTool({ name: 'proofmarks_watch', arguments: { timeoutSeconds: 0.01 } }))
          .structuredContent as { timeout?: boolean }
      )?.timeout,
      true,
    );
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
test('Claude stub receives channel notification with identifier-only metadata and no permission relay', async () => {
  const f = await eventFixture(),
    { server } = await createMcpServer({ root: f.root, provider: fakeProvider }),
    client = new Client({ name: 'claude-code', version: '2.1.319' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  let event: Record<string, unknown> | undefined;
  client.setNotificationHandler(
    z.object({ method: z.literal('notifications/claude/channel'), params: z.record(z.string(), z.unknown()) }),
    notification => {
      event = notification.params;
    },
  );
  await server.connect(b);
  await client.connect(a);
  try {
    const capabilities = client.getServerCapabilities();
    assert.deepEqual(capabilities?.experimental?.['claude/channel'], {});
    assert.equal(capabilities?.experimental?.['claude/channel/permission'], undefined);
    const agent = (await registered(f.base, 1)).agents[0]!;
    assert.equal(agent.delivery, 'push');
    await request(f.store, agent.id);
    await until(async () => event !== undefined);
    assert.ok(event);
    assert.equal(JSON.parse(String(event.content)).type, 'rewrite.requested');
    for (const key of Object.keys(event.meta as object)) assert.match(key, /^[a-zA-Z0-9_]+$/);
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
test('with --agent (the pi extension), pi registers as push under that id, gets no channel notification and claims as that agent', async () => {
  const f = await eventFixture(),
    pushAgent = '0f6a1a52-7f4e-4c1d-9b0e-1c2d3e4f5a6b',
    { server } = await createMcpServer({ root: f.root, provider: fakeProvider, pushAgent }),
    client = new Client({ name: 'pi', version: '1.5.2' }),
    [a, b] = InMemoryTransport.createLinkedPair(),
    notifications: unknown[] = [];
  client.setNotificationHandler(
    z.object({ method: z.literal('notifications/claude/channel'), params: z.record(z.string(), z.unknown()) }),
    notification => {
      notifications.push(notification.params);
    },
  );
  await server.connect(b);
  await client.connect(a);
  try {
    const agent = (await registered(f.base, 1)).agents[0]!;
    assert.deepEqual([agent.id, agent.host, agent.delivery], [pushAgent, 'pi', 'push']);
    await request(f.store, pushAgent);
    await delay(400);
    assert.equal(notifications.length, 0);
    const claimed = await client.callTool({
      name: 'proofmarks_claim',
      arguments: { reviewId: 'fixture', findingId: 'F1' },
    });
    assert.equal(claimed.isError, undefined);
    assert.equal((await f.store.read('fixture')).review!.findings[0]!.rewriteRequest?.claimedBy, pushAgent);
    // Watching and returning leaves the agent as push, the way it registered.
    await client.callTool({ name: 'proofmarks_watch', arguments: { timeoutSeconds: 0 } });
    assert.equal((await registered(f.base, 1)).agents[0]!.delivery, 'push');
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
test('an agent id that is not a UUID is refused before anything is written', async () => {
  const f = await eventFixture(),
    { registerAgent } = await import('../agents/index');
  try {
    await assert.rejects(registerAgent(f.base, { name: 'pi', version: 'test' }, 'push', '../../escape'), /UUID/);
    assert.equal((await agentStatus(f.base)).agents.length, 0);
  } finally {
    await f.close();
  }
});
test('journal remains authoritative after an interrupted review projection rename', async () => {
  const f = await eventFixture();
  try {
    const { readFile, writeFile } = await import('node:fs/promises');
    const snapshot = await f.store.read('fixture'),
      before = await readFile(snapshot.file, 'utf8');
    await request(f.store, 'recovery-agent');
    await writeFile(snapshot.file, before);
    assert.equal((await f.store.read('fixture')).review!.findings[0]?.rewriteRequest?.target, 'recovery-agent');
    const { readReview } = await import('../next/source');
    assert.equal((await readReview(f.base, 'fixture')).review.findings[0]?.rewriteRequest?.status, 'pending');
  } finally {
    await f.close();
  }
});
test('pending/watch skip one stale proof without hiding valid requests; only the claimer can report failure', async () => {
  const f = await eventFixture(),
    { server } = await createMcpServer({ root: f.root, provider: fakeProvider }),
    client = new Client({ name: 'codex', version: 'test' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const agent = (await registered(f.base, 1)).agents[0]!;
    const { writeFile } = await import('node:fs/promises');
    const snapshot = await f.store.read('fixture'),
      good = {
        ...snapshot.review!.findings[0]!,
        rewriteRequest: { status: 'pending', target: agent.id, requestedAt: new Date().toISOString() },
      };
    await writeFile(
      snapshot.file,
      JSON.stringify({
        ...snapshot.review,
        findings: [{ ...good, id: 'bad', match: 'This sentence is absent.' }, good],
      }),
    );
    for (const name of ['proofmarks_pending_rewrites', 'proofmarks_watch']) {
      const result = await client.callTool({
        name,
        arguments: name === 'proofmarks_watch' ? { timeoutSeconds: 0.01 } : {},
      });
      assert.equal(result.isError, undefined);
      const content = result.structuredContent as {
        pending: { findingId: string }[];
        skipped: { findingId: string; reason: string }[];
      };
      assert.deepEqual(
        content.pending.map(f => f.findingId),
        ['F1'],
      );
      assert.equal(content.skipped[0]?.findingId, 'bad');
      assert.match(content.skipped[0]?.reason ?? '', /source match/);
    }
    // The tool refuses an unclaimed request without changing its projection or journal.
    assert.equal(
      (
        await client.callTool({
          name: 'proofmarks_report_failure',
          arguments: { reviewId: 'fixture', findingId: 'F1', reason: 'The source changed.' },
        })
      ).isError,
      true,
    );
    await client.callTool({ name: 'proofmarks_claim', arguments: { reviewId: 'fixture', findingId: 'F1' } });
    const { ReviewService } = await import('../companion/service');
    const intruder = await ReviewService.create({ root: f.root, provider: fakeProvider, agent: 'different-agent' });
    await assert.rejects(
      intruder.reportFailure({ reviewId: 'fixture', findingId: 'F1', reason: 'Wrong claimant.' }),
      /holding this claim/,
    );
    const result = await client.callTool({
      name: 'proofmarks_report_failure',
      arguments: { reviewId: 'fixture', findingId: 'F1', reason: 'The source changed; please retry.' },
    });
    assert.equal(result.isError, undefined);
    const saved = (await f.store.read('fixture')).review!.findings.find(f => f.id === 'F1')!;
    assert.equal(saved.rewriteRequest?.status, 'failed');
    assert.equal(saved.rewriteRequest?.error, 'The source changed; please retry.');
    assert.equal((await eventFeed(f.store)).events.at(-1)?.type, 'rewrite.failed');
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
test('Accept emits no event or Claude push for its superseded pending sibling', async () => {
  const f = await eventFixture(),
    { server } = await createMcpServer({ root: f.root, provider: fakeProvider }),
    client = new Client({ name: 'claude-code', version: 'test' }),
    [a, b] = InMemoryTransport.createLinkedPair(),
    notifications: { findingId: string }[] = [];
  client.setNotificationHandler(
    z.object({ method: z.literal('notifications/claude/channel'), params: z.record(z.string(), z.unknown()) }),
    notification => {
      notifications.push(JSON.parse(String(notification.params.content)));
    },
  );
  await server.connect(b);
  await client.connect(a);
  try {
    const agent = (await registered(f.base, 1)).agents[0]!,
      snapshot = await f.store.read('fixture'),
      { writeFile } = await import('node:fs/promises');
    await writeFile(
      snapshot.file,
      JSON.stringify({
        ...snapshot.review,
        findings: [
          { ...snapshot.review!.findings[0]!, proposed: 'The report explains the result.' },
          {
            ...snapshot.review!.findings[0]!,
            id: 'overlap',
            rule: 'puffery',
            rewriteRequest: { status: 'pending', target: agent.id },
          },
        ],
      }),
    );
    const { applySourceAction, readReview } = await import('../next/source');
    const initial = await readReview(f.base, 'fixture');
    await applySourceAction(f.base, 'F1', 'accept', initial.revision, undefined, undefined, undefined, 'fixture');
    await delay(350);
    assert.equal((await f.store.read('fixture')).review!.findings.find(f => f.id === 'overlap')?.status, 'superseded');
    assert.equal(
      notifications.some(event => event.findingId === 'overlap'),
      false,
    );
    assert.equal(
      (await eventFeed(f.store)).events.some(event => event.findingId === 'overlap'),
      false,
    );
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
test('a writer waits for the review lock instead of failing while another write finishes', async () => {
  const f = await eventFixture();
  const { writeFile, unlink } = await import('node:fs/promises');
  try {
    const lock = (await f.store.read('fixture')).log + '.lock';
    await writeFile(lock, '', { flag: 'wx' });
    setTimeout(() => void unlink(lock), 60);
    const started = Date.now();
    await updateRequest(
      f.store,
      'fixture',
      'F1',
      x => ({ ...x, rewriteRequest: { status: 'pending', target: 'headless:claude' } }),
      'rewrite.requested',
    );
    assert.ok(Date.now() - started >= 50);
    assert.equal((await f.store.read('fixture')).review!.findings[0]!.rewriteRequest?.status, 'pending');
  } finally {
    await f.close();
  }
});

test("an agent's own rewrite requests aren't pushed back to it, while the writer's still are", async () => {
  const { store, close } = await eventFixture(['It is fast, simple, and powerful.']);
  try {
    const { ReviewService } = await import('../companion/service');
    const { targetedEvents } = await import('./index');
    const agent = '11111111-1111-4111-8111-111111111111';
    const start = (await eventFeed(store)).cursor;
    // Self-driving: the agent asks for F1's rewrite itself.
    const service = new ReviewService(store, { root: store.root, provider: fakeProvider, agent });
    assert.deepEqual((await service.requestRewrites({ reviewId: 'fixture', findingIds: ['F1'] })).requested, ['F1']);
    // The writer asks for F2's on the page, aimed at the same agent.
    await updateRequest(
      store,
      'fixture',
      'F2',
      f => ({ ...f, rewriteRequest: { status: 'pending', target: agent, requestedAt: new Date().toISOString() } }),
      'rewrite.requested',
    );
    const feed = await eventFeed(store, start);
    const pushed = await targetedEvents(store, feed.events, agent);
    assert.deepEqual(
      pushed.filter(e => e.type === 'rewrite.requested').map(e => e.findingId),
      ['F2'],
    );
  } finally {
    await close();
  }
});
