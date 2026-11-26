import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { eventFixture } from '../events/fixture';
import { updateRequest, type ProofmarksEvent } from '../events/index';
import { connect } from './extension';

// pi's user-level mcp.json is read on connect; keep this machine's out of the tests.
process.env.PI_CODING_AGENT_DIR = await mkdtemp(path.join(os.tmpdir(), 'proofmarks-pi-agent-'));

type Host = Parameters<typeof connect>[1];
function fakePi() {
  const servers = new Map<string, Parameters<Host['registerMcpServer']>[1]>(),
    sent: Parameters<Host['sendMessage']>[] = [];
  const pi = {
    registerMcpServer(name, config) {
      servers.set(name, config);
    },
    unregisterMcpServer(name) {
      servers.delete(name);
    },
    sendMessage(message, options) {
      sent.push([message, options]);
    },
  } satisfies Host;
  return { pi, servers, sent };
}
async function nth(sent: unknown[], count: number) {
  for (let i = 0; i < 300 && sent.length < count; i++) await delay(10);
  assert.equal(sent.length, count);
}
const request = (store: Awaited<ReturnType<typeof eventFixture>>['store'], target: string) =>
  updateRequest(
    store,
    'fixture',
    'F1',
    f => ({ ...f, rewriteRequest: { status: 'pending', target, requestedAt: new Date().toISOString() } }),
    'rewrite.requested',
  );

test('pi gets the requests aimed at its session as follow-ups that start a turn, and decisions as information only', async () => {
  const f = await eventFixture(),
    host = fakePi(),
    session = await connect(f.base, host.pi, text => assert.fail(text));
  try {
    assert.ok(session);
    const server = host.servers.get('proofmarks');
    assert.ok(server && 'command' in server);
    assert.equal(server.command, process.execPath);
    assert.match(server.args?.[0] ?? '', /companion[/\\]bin\.mjs$/);
    assert.deepEqual(server.args?.slice(-2), ['--agent', session.agent]);
    await request(f.store, '6b1f2c3d-0000-4000-8000-000000000000');
    await delay(400);
    assert.equal(host.sent.length, 0, 'a request for another agent never reaches this session');
    await request(f.store, session.agent);
    await nth(host.sent, 1);
    const [message, options] = host.sent[0]!;
    assert.deepEqual(options, { deliverAs: 'followUp', triggerTurn: true });
    assert.equal(message.customType, 'proofmarks');
    assert.equal((message.details as ProofmarksEvent).type, 'rewrite.requested');
    assert.match(String(message.content), /proof F1 \(contrast\) in review fixture/);
    assert.match(String(message.content), /"It is not a tool, but a revolution\."/);
    assert.match(String(message.content), /mcp__proofmarks__proofmarks_pending_rewrites \(no arguments\)/);
    assert.match(String(message.content), /mcp__proofmarks__proofmarks_claim \(reviewId "fixture", findingId "F1"\)/);
    const { applySourceAction, readReview } = await import('../next/source');
    await applySourceAction(
      f.base,
      'F1',
      'dismiss',
      (await readReview(f.base, 'fixture')).revision,
      undefined,
      undefined,
      undefined,
      'fixture',
    );
    await nth(host.sent, 2);
    const [decision, decisionOptions] = host.sent[1]!;
    assert.deepEqual(decisionOptions, { deliverAs: 'nextTurn' });
    assert.match(String(decision.content), /dismissed proof F1 .*information only/);
    session.close();
    assert.equal(host.servers.has('proofmarks'), false);
  } finally {
    session?.close();
    await f.close();
  }
});

test('outside a Proofmarks project the extension stays out of the session', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'proofmarks-pi-none-')),
    host = fakePi();
  try {
    assert.equal(await connect(dir, host.pi, text => assert.fail(text)), undefined);
    assert.equal(host.servers.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a proofmarks entry in mcp.json is named, with the command that fixes it, instead of push silently not arriving', async () => {
  const f = await eventFixture(),
    host = fakePi(),
    warnings: string[] = [];
  try {
    await mkdir(path.join(f.base, '.pi'));
    await writeFile(
      path.join(f.base, '.pi', 'mcp.json'),
      JSON.stringify({ mcpServers: { proofmarks: { command: 'npx', args: ['proofmarks', 'mcp'] } } }),
    );
    assert.equal(await connect(f.base, host.pi, text => warnings.push(text)), undefined);
    assert.equal(host.servers.size, 0);
    assert.match(
      warnings[0] ?? '',
      /\.pi[/\\]mcp\.json has a proofmarks server\. Remove it with: pi mcp remove proofmarks --local$/,
    );
  } finally {
    await f.close();
  }
});
