import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm, open, symlink } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, createSetupServer } from './mcp';
import { ReviewStore, type ReviewDocument } from './state';
import type { JudgeProvider } from '../judge/types';
const source = 'It is not a tool, but a revolution. A specific observation belongs in this paragraph.';
const finding = {
  id: 'D001',
  rule: 'contrast',
  match: 'It is not a tool, but a revolution.',
  level: 'sentence',
  edit: 'replace',
  status: 'open',
  judge: { probability: 0.95, threshold: 0.8 },
  rewriteRequest: { status: 'pending', requestedAt: 'November 5, 2026' },
};
async function fixture(score = 0.1, fail = false) {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const base = await mkdtemp(new URL('mcp-', work).pathname);
  const root = path.join(base, 'content/essays');
  await mkdir(root, { recursive: true });
  const reviews = path.join(base, 'content/reviews');
  await mkdir(reviews);
  const file = path.join(root, 'proofmarks-fixture.mdx'),
    reviewFile = path.join(reviews, 'proofmarks-fixture.json'),
    log = path.join(reviews, 'proofmarks-fixture.log.jsonl');
  await writeFile(file, source);
  const review: ReviewDocument = {
    source: 'content/essays/proofmarks-fixture.mdx',
    rules: [],
    findings: [structuredClone(finding)] as ReviewDocument['findings'],
  };
  await writeFile(reviewFile, JSON.stringify(review));
  let calls = 0;
  const secret = 'FAKE-S3-KEY-NEVER-LEAK';
  const provider: JudgeProvider = {
    id: 'fake',
    model: 'fixture-1',
    capabilities: { maxQuestionsPerCall: 32, pricing: 'per-call' },
    async judge(_input, questions) {
      calls++;
      if (fail) throw Object.assign(new Error(secret), { status: 401, name: secret });
      return {
        answers: questions.map(q => ({ id: q.id, probability: score })),
        provider: 'fake',
        model: 'fixture-1',
        latencyMs: 0,
        cached: false,
        usage: { calls: 1, dollars: 0 },
      };
    },
  };
  const { server, service } = await createMcpServer({ root, provider, cacheDir: path.join(base, 'cache') });
  const client = new Client({ name: 'proofmarks-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const saved = async () => JSON.parse(await readFile(reviewFile, 'utf8')) as ReviewDocument;
  const close = async () => {
    await client.close();
    await server.close();
    // The server can still be finishing a write as it closes; removing the folder then fails with ENOTEMPTY once in a while.
    await rm(base, { recursive: true, maxRetries: 5, retryDelay: 50 });
  };
  return {
    base,
    root,
    file,
    reviewFile,
    log,
    provider,
    server,
    service,
    client,
    call,
    saved,
    close,
    calls: () => calls,
    secret,
  };
}
test('every MCP tool exposes annotations, pending context, proposals and decisions', async () => {
  const f = await fixture();
  try {
    const tools = await f.client.listTools();
    assert.equal(tools.tools.length, 12);
    assert.deepEqual(
      tools.tools.filter(t => !t.title).map(t => t.name),
      [],
      'every tool has a title, as directories ask',
    );
    assert.equal(tools.tools.find(t => t.name === 'proofmarks_list_reviews')?.annotations?.readOnlyHint, true);
    assert.equal(tools.tools.find(t => t.name === 'proofmarks_propose_rewrite')?.annotations?.destructiveHint, false);
    const prompts = await f.client.listPrompts();
    assert.deepEqual(
      prompts.prompts.map(p => p.name),
      ['watch', 'proof'],
    );
    const watch = await f.client.getPrompt({ name: 'watch' });
    const message = watch.messages[0]!.content;
    assert.equal(message.type, 'text');
    assert.match(
      message.type === 'text' ? message.text : '',
      /^Watch Proofmarks: call proofmarks_watch\..*until I say stop\.$/,
    );
    const list = await f.call('proofmarks_list_reviews');
    assert.equal(
      (list.structuredContent as { reviews: { counts: Record<string, number> }[] }).reviews[0]?.counts.open,
      1,
    );
    const pending = await f.call('proofmarks_pending_rewrites');
    const request = (
      pending.structuredContent as { pending: { paragraph: string; match: string; rule: { label: string } }[] }
    ).pending[0]!;
    assert.equal(request.paragraph, source);
    assert.equal(request.match, finding.match);
    assert.ok(request.rule.label);
    const proposal = await f.call('proofmarks_propose_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: 'The tool compiles a report.',
    });
    assert.equal(proposal.isError, undefined);
    assert.equal((proposal.structuredContent as { stillFlagged: boolean }).stillFlagged, false);
    const saved = await f.saved();
    assert.equal(saved.findings[0]?.proposed, 'The tool compiles a report.');
    assert.equal(saved.findings[0]?.rewriteRequest?.status, 'proposed');
    assert.equal(saved.findings[0]?.judge?.after?.probability, 0.1);
    assert.equal(await readFile(f.file, 'utf8'), source);
    await writeFile(
      f.log,
      JSON.stringify({
        eventId: 'first',
        timestamp: '2026-11-05T20:00:00.000Z',
        action: 'dismiss',
        finding: 'D001',
        before: { finding },
        after: { finding: { ...finding, status: 'dismissed' } },
      }) + '\n',
    );
    const feed = await f.call('proofmarks_decisions', { reviewId: 'proofmarks-fixture' });
    assert.equal((feed.structuredContent as { decisions: unknown[] }).decisions.length, 1);
    const cursor = await f.call('proofmarks_decisions', { reviewId: 'proofmarks-fixture', since: 'first' });
    assert.deepEqual((cursor.structuredContent as { decisions: unknown[] }).decisions, []);
    const refresh = await f.call('proofmarks_review', { path: f.file });
    assert.equal(refresh.isError, undefined);
    assert.equal((await f.saved()).findings.find(item => item.id === 'D001')?.proposed, 'The tool compiles a report.');
    assert.equal(await readFile(f.file, 'utf8'), source);
  } finally {
    await f.close();
  }
});
test('still-flagged proposals retain their score and explicit flag', async () => {
  const f = await fixture(0.95);
  try {
    const result = await f.call('proofmarks_propose_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: 'Not a report, but a revolution.',
    });
    assert.equal((result.structuredContent as { stillFlagged: boolean }).stillFlagged, true);
    assert.equal((await f.saved()).findings[0]?.rewriteRequest?.stillFlagged, true);
  } finally {
    await f.close();
  }
});
test('empty and identical rewrites are refused without provider calls', async () => {
  const f = await fixture();
  try {
    for (const text of ['', '  ', finding.match, '  It is not a tool, but a revolution. '])
      assert.equal(
        (await f.call('proofmarks_propose_rewrite', { reviewId: 'proofmarks-fixture', findingId: 'D001', text }))
          .isError,
        true,
      );
    assert.equal(f.calls(), 0);
    assert.equal((await f.saved()).findings[0]?.proposed, undefined);
  } finally {
    await f.close();
  }
});
test('proposal uses the compatible lock and refuses stale revisions', async () => {
  const f = await fixture();
  const lock = await open(f.log + '.lock', 'wx');
  try {
    const result = await f.call('proofmarks_propose_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: 'The tool compiles reports.',
    });
    assert.equal(result.isError, true);
    assert.equal((await f.saved()).findings[0]?.proposed, undefined);
  } finally {
    await lock.close();
    const { unlink } = await import('node:fs/promises');
    await unlink(f.log + '.lock');
  }
  try {
    const snapshot = await f.service.store.read('proofmarks-fixture');
    await writeFile(f.reviewFile, JSON.stringify({ ...(await f.saved()), changed: true }));
    await assert.rejects(
      f.service.store.commit(snapshot, async () => snapshot.review!),
      /changed/,
    );
  } finally {
    await f.close();
  }
});
test('log and project Dismiss memory suppress new open marks while refresh preserves decisions', async () => {
  const f = await fixture(0.95);
  try {
    const old = await f.saved();
    old.findings[0] = { ...old.findings[0]!, status: 'dismissed' };
    await writeFile(f.reviewFile, JSON.stringify(old));
    await writeFile(
      f.log,
      JSON.stringify({
        eventId: 'dismiss',
        timestamp: '2026-11-05T20:00:00.000Z',
        action: 'dismiss',
        finding: 'D001',
        before: { finding },
        after: { finding: old.findings[0] },
      }) + '\n',
    );
    assert.equal((await f.call('proofmarks_review', { path: f.file })).isError, undefined);
    const saved = await f.saved();
    assert.equal(saved.findings.find(item => item.id === 'D001')?.status, 'dismissed');
    assert.ok(!saved.findings.some(item => item.rule === 'contrast' && (item.status ?? 'open') === 'open'));
    const memory = JSON.parse(await readFile(path.join(f.root, '.proofmarks/dismissed.json'), 'utf8'));
    assert.ok(memory.entries.length);
    await writeFile(f.reviewFile, JSON.stringify({ ...old, findings: [] }));
    await writeFile(f.log, '');
    await f.call('proofmarks_review', { path: f.file });
    assert.ok(!(await f.saved()).findings.some(item => item.rule === 'contrast'));
  } finally {
    await f.close();
  }
});
test('provider credentials never appear in any MCP result or error', async () => {
  const f = await fixture(0.1, true);
  try {
    const results = [
      await f.call('proofmarks_list_reviews'),
      await f.call('proofmarks_pending_rewrites'),
      await f.call('proofmarks_decisions', { reviewId: 'proofmarks-fixture' }),
      await f.call('proofmarks_propose_rewrite', {
        reviewId: 'proofmarks-fixture',
        findingId: 'D001',
        text: 'A new sentence.',
      }),
      await f.call('proofmarks_review', { path: f.file }),
    ];
    assert.ok(results[3]?.isError);
    assert.ok(results[4]?.isError);
    assert.ok(!JSON.stringify(results).includes(f.secret));
    assert.ok(!(await readFile(f.reviewFile, 'utf8')).includes(f.secret));
  } finally {
    await f.close();
  }
});
test('root escapes, symlinked reviews and mismatched outputs are refused', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.review(path.join(f.base, 'outside.mdx')));
    await writeFile(path.join(f.root, 'reference-article.mdx'), source);
    const store = await ReviewStore.create(f.root);
    assert.throws(
      () =>
        store.output(
          path.join(f.root, 'reference-article.mdx'),
          path.join(f.base, 'content/reviews/another-article.json'),
        ),
      /match/,
    );
    const { unlink } = await import('node:fs/promises');
    await unlink(f.reviewFile);
    await symlink(f.file, f.reviewFile);
    assert.equal((await f.call('proofmarks_pending_rewrites')).isError, true);
  } finally {
    await f.close();
  }
});
test('an overlay decision arriving during judging wins over the stale proposal', async () => {
  const f = await fixture();
  try {
    const judge = f.provider.judge;
    f.provider.judge = async (...args) => {
      const current = await f.saved();
      current.findings[0]!.status = 'accepted';
      await writeFile(f.reviewFile, JSON.stringify(current));
      return judge(...args);
    };
    const result = await f.call('proofmarks_propose_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: 'The tool compiles reports.',
    });
    assert.equal(result.isError, true);
    const saved = await f.saved();
    assert.equal(saved.findings[0]?.status, 'accepted');
    assert.equal(saved.findings[0]?.proposed, undefined);
  } finally {
    await f.close();
  }
});
test('delete rules permit an empty proposal, which clears without a judge call', async () => {
  const f = await fixture();
  try {
    const text = 'It is important to note that';
    await writeFile(f.file, text + ' the report exists.');
    const review = await f.saved();
    review.findings[0] = { ...review.findings[0]!, rule: 'filler', edit: 'delete', match: text };
    await writeFile(f.reviewFile, JSON.stringify(review));
    const result = await f.call('proofmarks_propose_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: '',
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual((result.structuredContent as { stillFlagged: boolean }).stillFlagged, false);
    assert.equal((await f.saved()).findings[0]?.proposed, '');
    // The judge can't score an empty passage (the relay refuses one), and deleting the text removes the problem.
    assert.equal(f.calls(), 0);
    const checked = await f.call('proofmarks_check_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: '',
    });
    assert.deepEqual(checked.structuredContent, { probability: 0, threshold: 0.8, clears: true });
    assert.equal(f.calls(), 0);
  } finally {
    await f.close();
  }
});
test('HTTP refresh uses the same Dismiss memory and merge service', async () => {
  const f = await fixture(0.95);
  const { serve } = await import('./server');
  const server = await serve({
    provider: f.provider,
    roots: [f.root],
    port: 0,
    sessionDir: path.join(f.base, 'session'),
    cacheDir: path.join(f.base, 'cache'),
  });
  try {
    await writeFile(
      f.log,
      JSON.stringify({
        eventId: 'dismiss',
        timestamp: '2026-11-05T20:00:00.000Z',
        action: 'dismiss',
        before: { finding },
        after: { finding: { ...finding, status: 'dismissed' } },
      }) + '\n',
    );
    const session = JSON.parse(await readFile(path.join(f.base, 'session/session.json'), 'utf8'));
    const result = await fetch(`http://127.0.0.1:${session.port}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ path: f.file }),
    });
    assert.equal(result.status, 200);
    assert.ok(!(await f.saved()).findings.some(item => item.rule === 'contrast' && (item.status ?? 'open') === 'open'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await f.close();
  }
});
test('packaged stdio command speaks MCP without stdout diagnostics', async () => {
  const f = await fixture();
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { childEnv } = await import('./keys');
  const client = new Client({ name: 'proofmarks-stdio-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('./bin.mjs', import.meta.url).pathname, 'mcp', '--root', f.root, '--judge', 'fake'],
    cwd: f.base,
    env: Object.fromEntries(
      Object.entries(childEnv()).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += String(chunk);
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 12);
    assert.equal((await client.callTool({ name: 'proofmarks_pending_rewrites', arguments: {} })).isError, undefined);
    assert.ok(!stderr.includes(f.secret));
  } finally {
    await client.close();
    await f.close();
  }
});
test('manual project Dismiss memory suppresses an old pending mark after normalization', async () => {
  const f = await fixture(0.95);
  try {
    await mkdir(path.join(f.root, '.proofmarks'));
    await writeFile(
      path.join(f.root, '.proofmarks/dismissed.json'),
      JSON.stringify({ version: 1, entries: [{ rule: 'contrast', text: '  IT IS NOT A TOOL, BUT A REVOLUTION.  ' }] }),
    );
    const result = await f.call('proofmarks_review', { path: f.file });
    assert.equal(result.isError, undefined);
    assert.ok(!(await f.saved()).findings.some(item => item.rule === 'contrast'));
  } finally {
    await f.close();
  }
});

test('only pending requests allow proposals; Accept, Undo and Dismiss never create requests', async () => {
  const f = await fixture();
  try {
    for (const state of [undefined, { status: 'proposed' as const }]) {
      const review = await f.saved();
      review.findings[0]!.rewriteRequest = state;
      await writeFile(f.reviewFile, JSON.stringify(review));
      const result = await f.call('proofmarks_propose_rewrite', {
        reviewId: 'proofmarks-fixture',
        findingId: 'D001',
        text: 'A new observation.',
      });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /No pending rewrite request/);
    }
    assert.equal(f.calls(), 0);
    const review = await f.saved();
    review.findings[0]!.rewriteRequest = { status: 'pending' };
    await writeFile(f.reviewFile, JSON.stringify(review));
    assert.equal(
      (
        await f.call('proofmarks_propose_rewrite', {
          reviewId: 'proofmarks-fixture',
          findingId: 'D001',
          text: 'A new observation.',
        })
      ).isError,
      undefined,
    );
    const before = await readFile(f.reviewFile, 'utf8');
    assert.equal(
      (
        await f.call('proofmarks_propose_rewrite', {
          reviewId: 'proofmarks-fixture',
          findingId: 'D001',
          text: 'Another observation.',
        })
      ).isError,
      true,
    );
    assert.equal(await readFile(f.reviewFile, 'utf8'), before);
    assert.equal(f.calls(), 1);
  } finally {
    await f.close();
  }
});
test('stdio discovers config and starts without --root, keeping unlisted reviews read-only', async () => {
  const f = await fixture();
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { childEnv } = await import('./keys');
  await writeFile(
    path.join(f.base, 'proofmarks.config.json'),
    JSON.stringify({
      version: 1,
      documents: [
        {
          id: 'fixture-alias',
          source: 'content/essays/proofmarks-fixture.mdx',
          review: 'content/reviews/proofmarks-fixture.json',
          write: true,
        },
      ],
      roots: ['content/essays'],
      judge: { provider: 'fake', model: 'fixture-1' },
    }),
  );
  const client = new Client({ name: 'proofmarks-config-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('./bin.mjs', import.meta.url).pathname, 'mcp', '--cache-dir', path.join(f.base, 'config-cache')],
    cwd: f.base,
    env: Object.fromEntries(
      Object.entries(childEnv()).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'proofmarks_list_reviews', arguments: {} });
    assert.equal(
      (result.structuredContent as { reviews: { reviewId: string }[] }).reviews[0]?.reviewId,
      'fixture-alias',
    );
    assert.equal(
      (
        await client.callTool({
          name: 'proofmarks_propose_rewrite',
          arguments: { reviewId: 'unlisted', findingId: 'D001', text: 'A new observation.' },
        })
      ).isError,
      true,
    );
  } finally {
    await client.close();
    await f.close();
  }
});
test('a stale span still finds the body sentence when the frontmatter repeats it', async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.file,
      `---\nsummary: "${finding.match}"\n---\n\nAn accepted rewrite moved this paragraph. ${source}`,
    );
    const review = await f.saved();
    review.findings[0]!.span = { start: 0, end: finding.match.length };
    await writeFile(f.reviewFile, JSON.stringify(review));
    const result = await f.call('proofmarks_propose_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: 'A new observation.',
    });
    assert.equal(result.isError, undefined);
    assert.equal((await f.saved()).findings[0]!.proposed, 'A new observation.');
  } finally {
    await f.close();
  }
});

test('MCP pending and persisted helper updates use source order even for scrambled legacy files', async () => {
  const f = await fixture();
  try {
    const review = await f.saved(),
      second = {
        ...structuredClone(review.findings[0]!),
        id: 'D002',
        match: 'A specific observation belongs in this paragraph.',
      };
    review.findings = [second, review.findings[0]!];
    await writeFile(f.reviewFile, JSON.stringify(review));
    const pending = await f.call('proofmarks_pending_rewrites');
    assert.deepEqual(
      (pending.structuredContent as { pending: { findingId: string }[] }).pending.map(f => f.findingId),
      ['D001', 'D002'],
    );
    const list = await f.call('proofmarks_list_reviews');
    assert.equal((list.structuredContent as { reviews: { counts: { open: number } }[] }).reviews[0]?.counts.open, 2);
    const store = await ReviewStore.create(f.root),
      snapshot = await store.read('proofmarks-fixture');
    await store.commit(snapshot, async () => ({
      ...snapshot.review!,
      findings: [...snapshot.review!.findings].reverse(),
    }));
    assert.deepEqual(
      (await f.saved()).findings.map(f => f.id),
      ['D001', 'D002'],
    );
  } finally {
    await f.close();
  }
});

test('self-driving: the agent opens requests for itself, checks drafts without saving, then proposes', async () => {
  const f = await fixture(0.1);
  try {
    // Three proofs: one open with no request, one with a rewrite already, one already dismissed.
    const review = await f.saved();
    const base = { ...review.findings[0]!, rewriteRequest: undefined };
    review.findings = [
      base,
      {
        ...base,
        id: 'D002',
        match: 'A specific observation belongs in this paragraph.',
        proposed: 'Specifics belong here.',
      },
      { ...base, id: 'D003', match: 'belongs in this paragraph', status: 'dismissed' },
    ] as ReviewDocument['findings'];
    await writeFile(f.reviewFile, JSON.stringify(review));
    const requested = await f.call('proofmarks_request_rewrites', { reviewId: 'proofmarks-fixture' });
    assert.deepEqual(requested.structuredContent, { requested: ['D001'], skipped: [] });
    const request = (await f.saved()).findings[0]!.rewriteRequest!;
    // Targeted at this agent, which got its id when it connected.
    assert.deepEqual([request.status, request.target, request.version], ['pending', f.service.options.agent, 1]);
    assert.ok(request.target);
    assert.match(await readFile(f.log, 'utf8'), /"action":"rewrite\.requested"/);
    const pending = (await f.call('proofmarks_pending_rewrites')).structuredContent as {
      pending: { findingId: string }[];
    };
    assert.deepEqual(
      pending.pending.map(p => p.findingId),
      ['D001'],
    );

    // A draft is scored and nothing is saved.
    const before = await readFile(f.reviewFile, 'utf8'),
      calls = f.calls();
    const checked = await f.call('proofmarks_check_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: 'It is a revolution.',
    });
    assert.deepEqual(checked.structuredContent, { probability: 0.1, threshold: 0.8, clears: true });
    assert.equal(await readFile(f.reviewFile, 'utf8'), before);
    assert.equal(f.calls(), calls + 1);
    assert.equal(
      (
        await f.call('proofmarks_check_rewrite', {
          reviewId: 'proofmarks-fixture',
          findingId: 'D001',
          text: 'It is not a tool, but a revolution.',
        })
      ).isError,
      true,
      'the original is refused',
    );

    assert.equal(
      (
        await f.call('proofmarks_propose_rewrite', {
          reviewId: 'proofmarks-fixture',
          findingId: 'D001',
          text: 'It is a revolution.',
        })
      ).isError,
      undefined,
    );
    assert.equal((await f.saved()).findings[0]!.proposed, 'It is a revolution.');
    const again = await f.call('proofmarks_request_rewrites', {
      reviewId: 'proofmarks-fixture',
      findingIds: ['D001', 'D003', 'nope'],
    });
    assert.deepEqual(again.structuredContent, {
      requested: [],
      skipped: [
        { findingId: 'nope', reason: 'No such proof' },
        { findingId: 'D001', reason: 'Already has a rewrite' },
        { findingId: 'D003', reason: 'Already decided' },
      ],
    });
  } finally {
    await f.close();
  }
});

test('a draft that still has the problem does not clear', async () => {
  const f = await fixture(0.95);
  try {
    const checked = await f.call('proofmarks_check_rewrite', {
      reviewId: 'proofmarks-fixture',
      findingId: 'D001',
      text: 'Not a tool. A revolution.',
    });
    assert.deepEqual(checked.structuredContent, { probability: 0.95, threshold: 0.8, clears: false });
  } finally {
    await f.close();
  }
});

test('the proof prompt walks the self-driving loop and never accepts', async () => {
  const f = await fixture();
  try {
    const prompts = await f.client.listPrompts();
    assert.deepEqual(prompts.prompts.map(p => p.name).sort(), ['proof', 'watch']);
    const prompt = await f.client.getPrompt({ name: 'proof', arguments: { page: 'linkedin-post' } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    for (const step of [
      'proofmarks_open_page',
      'proofmarks_review',
      'proofmarks_request_rewrites',
      'proofmarks_check_rewrite',
      'at most 3 drafts',
      'proofmarks_propose_rewrite',
    ])
      assert.ok(text.includes(step), step);
    assert.match(text, /"linkedin-post"/);
    assert.match(text, /Never accept, dismiss or edit the source yourself/);
  } finally {
    await f.close();
  }
});

test('a review is refreshed by reviewId or by the path proofmarks_list_reviews shows, and a missing file says so', async () => {
  const f = await fixture();
  try {
    const tool = (await f.client.listTools()).tools.find(t => t.name === 'proofmarks_review')!;
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), ['path', 'reviewId']);
    const listed = (await f.call('proofmarks_list_reviews')).structuredContent as {
      reviews: { reviewId: string; source: string }[];
    };
    const source = listed.reviews[0]!.source;
    assert.equal(source, 'content/essays/proofmarks-fixture.mdx');
    for (const args of [{ reviewId: 'proofmarks-fixture' }, { path: source }, { path: 'proofmarks-fixture.mdx' }]) {
      const result = await f.call('proofmarks_review', args);
      assert.equal(result.isError, undefined, JSON.stringify(args));
      assert.equal((result.structuredContent as { reviewId: string }).reviewId, 'proofmarks-fixture');
    }
    assert.equal((await f.call('proofmarks_review', {})).isError, true);
    const missing = await f.call('proofmarks_review', { path: 'content/essays/missing.mdx' });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.content), /Can't read .*missing\.mdx \(ENOENT\)/);
    assert.doesNotMatch(JSON.stringify(missing.content), /Jev/);
  } finally {
    await f.close();
  }
});
test("where Proofmarks isn't set up, the MCP server says how, and starts and writes nothing", async () => {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const project = await mkdtemp(new URL('mcp-setup-', work).pathname);
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createSetupServer(project).connect(serverTransport);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map(t => [t.name, t.title, t.annotations?.readOnlyHint]),
      [['proofmarks_setup', 'Set up Proofmarks', true]],
    );
    const result = await client.callTool({ name: 'proofmarks_setup', arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    assert.ok(text.includes(project));
    assert.match(text, /https:\/\/proofmarks\.dev\/setup\.md/);
    assert.match(text, /npx proofmarks init --yes/);
    assert.match(text, /Torta's relay/);
    await client.close();
    assert.deepEqual(await readdir(project), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
