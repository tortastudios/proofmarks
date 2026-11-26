import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setOwnersOff } from '../judge/relay';
import { decisionCount, sendDecisionCount } from './decision-counts';
import type { ProofmarksFinding } from '../overlay/types';

const finding = (status?: ProofmarksFinding['status']): ProofmarksFinding => ({
  id: 'D001',
  rule: 'generic-voice',
  match: 'A passage nobody should see.',
  status,
  judge: { model: 'jev-1.14.0', probability: 0.7499, threshold: 0.7, rulesVersion: '3' },
});

test('a call on a mark counts as its rule, what was done, the score band and the line, and nothing else', () => {
  assert.deepEqual(decisionCount('accept', finding('open')), {
    rule: 'generic-voice',
    action: 'kept',
    score: 0.7,
    line: 0.7,
    model: 'jev-1.14.0',
    rulesVersion: '3',
  });
  assert.equal(decisionCount('dismiss', finding('open'))?.action, 'dismissed');
  assert.equal(decisionCount('revert', finding('accepted'))?.action, 'undone');
  assert.equal(decisionCount('revert', finding('dismissed'))?.action, 'restored');
  assert.equal(decisionCount('restore', finding('dismissed'))?.action, 'restored');
  assert.equal(decisionCount('accept', { id: 'D2', rule: 'em-dash', match: '—' }), undefined, 'no score, no count');
});

test('counts go to the relay with the install token once the person turns them on, and not at all when off', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'proofmarks-counts-'));
  const previous = process.env.PROOFMARKS_TELEMETRY,
    home = process.env.HOME;
  // No saved choice from the machine running the tests.
  process.env.HOME = dir;
  try {
    const sent: { url: string; body: string; authorization?: string }[] = [];
    const request = (async (url: string | URL, init: RequestInit = {}) => {
      sent.push({
        url: String(url),
        body: String(init.body),
        authorization: new Headers(init.headers).get('authorization') ?? undefined,
      });
      return String(url).endsWith('/v1/install')
        ? Response.json({ token: 'install-token' })
        : Response.json({ ok: true });
    }) as typeof fetch;
    const install = {
      relay: 'https://relay.test',
      version: '0.1.0',
      route: 'npm',
      file: path.join(dir, 'install.json'),
      request,
      telemetry: true,
    };
    process.env.PROOFMARKS_TELEMETRY = '1';
    await sendDecisionCount(decisionCount('dismiss', finding('open'))!, install);
    const count = sent.find(call => call.url === 'https://relay.test/v1/decisions')!;
    assert.equal(count.authorization, 'Bearer install-token');
    assert.deepEqual(Object.keys(JSON.parse(count.body)).sort(), [
      'action',
      'line',
      'model',
      'rule',
      'rulesVersion',
      'score',
    ]);
    assert.ok(!count.body.includes('nobody should see'));
    process.env.PROOFMARKS_TELEMETRY = '0';
    sent.length = 0;
    await sendDecisionCount(decisionCount('accept', finding('open'))!, install);
    assert.deepEqual(sent, []);
  } finally {
    if (previous === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous;
    process.env.HOME = home;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a count is dropped when counts go off while its token is on its way', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'proofmarks-counts-'));
  const previous = process.env.PROOFMARKS_TELEMETRY,
    home = process.env.HOME;
  process.env.HOME = dir;
  let off = false;
  try {
    const sent: string[] = [];
    const request = (async (url: string | URL) => {
      sent.push(String(url));
      if (String(url).endsWith('/v1/install')) {
        off = true;
        return Response.json({ token: 'install-token' });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    process.env.PROOFMARKS_TELEMETRY = '1';
    setOwnersOff(() => off);
    await sendDecisionCount(decisionCount('dismiss', finding('open'))!, {
      relay: 'https://relay.test',
      version: '0.1.0',
      route: 'npm',
      file: path.join(dir, 'install.json'),
      request,
    });
    assert.deepEqual(sent, ['https://relay.test/v1/install'], 'no count after the choice changed');
  } finally {
    setOwnersOff(() => false);
    if (previous === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous;
    process.env.HOME = home;
    await rm(dir, { recursive: true, force: true });
  }
});

test("the helper reports each person's call with the mark as it was, and Reset forgets a rule's calls", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const base = await mkdtemp(path.join(tmpdir(), 'proofmarks-decide-'));
  try {
    await mkdir(path.join(base, 'drafts'));
    await mkdir(path.join(base, 'reviews'));
    await writeFile(path.join(base, 'drafts/draft.md'), 'A sentence.');
    await writeFile(
      path.join(base, 'reviews/draft.json'),
      JSON.stringify({
        source: 'drafts/draft.md',
        rules: [],
        findings: [{ ...finding(), match: 'A sentence.', proposed: 'A better sentence.' }],
      }),
    );
    await writeFile(
      path.join(base, 'proofmarks.config.json'),
      JSON.stringify({
        version: 1,
        documents: [{ id: 'draft', source: 'drafts/draft.md', review: 'reviews/draft.json', write: true }],
        roots: ['drafts'],
        judge: { provider: 'fake', model: 'fixture' },
      }),
    );
    const { createProofmarksRoutes } = await import('../next/index'),
      { createProofmarksTransport } = await import('../overlay/transport');
    const calls: [string, string | undefined][] = [];
    const routes = createProofmarksRoutes({
      projectRoot: base,
      onDecision: (action, before) => calls.push([action, decisionCount(action, before)?.action]),
    });
    const transport = createProofmarksTransport(
      '',
      (async (url, init) => {
        const request = new Request(new URL(String(url), 'http://localhost:3000'), init);
        return request.method === 'POST' ? routes.POST(request) : routes.GET(request);
      }) as typeof fetch,
      '/dev/proofmarks',
    );
    const review = await transport.review('draft');
    const accepted = await transport.decision('accept', 'draft', review, review.findings[0]);
    await transport.decision('revert', 'draft', accepted.review!, accepted.review!.findings[0]);
    assert.deepEqual(calls, [
      ['accept', 'kept'],
      ['revert', 'undone'],
    ]);
    assert.equal((await transport.resetStrictness('generic-voice')).ok, true);
    const saved = JSON.parse(await readFile(path.join(base, 'drafts/.proofmarks/strictness.json'), 'utf8'));
    assert.ok(Date.parse(saved.resets['generic-voice']) > 0);
    await assert.rejects(transport.resetStrictness('Not a rule!'), /Invalid rule/);
  } finally {
    await rm(base, { recursive: true, force: true });
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
