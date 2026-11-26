import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProofmarksRoutes } from './index';
import { eventFixture } from '../events/fixture';
import { registerAgent } from '../agents/index';
import { eventFeed } from '../events/index';
import { ReviewService } from '../companion/service';
import { fakeProvider } from '../companion/fake';
async function versionFixture(extra: string[] = []) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const f = await eventFixture(extra),
    registration = await registerAgent(f.base, { name: 'codex', version: 'test' });
  const routes = createProofmarksRoutes({ projectRoot: f.base, token: 'fixture-token', defaultReviewId: 'fixture' });
  const get = async () =>
    (await routes.GET(new Request('http://127.0.0.1:3731/dev/proofmarks?action=review&reviewId=fixture'))).json();
  const post = async (body: Record<string, unknown>) => {
    const response = await routes.POST(
      new Request('http://127.0.0.1:3731/dev/proofmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proofmarks-Token': 'fixture-token' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  const agent = new ReviewService(f.store, {
    root: f.root,
    provider: fakeProvider,
    cacheDir: f.base + '/cache',
    agent: registration.agent.id,
  });
  return {
    ...f,
    get,
    post,
    agent,
    async close() {
      await registration.close();
      await f.close();
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    },
  };
}
test('another rewrite is a versioned request: agents see the version and earlier text, and never re-propose without one', async () => {
  const f = await versionFixture();
  try {
    assert.equal(
      (await f.post({ action: 'request-rewrite', reviewId: 'fixture', id: 'F1', revision: (await f.get()).revision }))
        .body.ok,
      true,
    );
    assert.deepEqual(
      (await f.agent.pendingRewrites()).pending.map(p => [p.version, p.previous]),
      [[1, undefined]],
    );
    assert.equal(
      (await f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It produces a report.' })).version,
      1,
    );
    await assert.rejects(
      f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It is a revolution.' }),
      /No pending rewrite request/,
    );
    // Asking for another needs an existing rewrite; Rewrite all never touches proofs that have one.
    assert.equal(
      (await f.post({ action: 'request-rewrite', reviewId: 'fixture', revision: (await f.get()).revision })).body.review
        .findings[0].rewriteRequest.status,
      'proposed',
    );
    const asked = await f.post({
      action: 'request-rewrite',
      reviewId: 'fixture',
      id: 'F1',
      another: true,
      revision: (await f.get()).revision,
    });
    assert.equal(asked.body.review.findings[0].rewriteRequest.status, 'pending');
    assert.equal(asked.body.review.findings[0].rewriteRequest.version, 2);
    assert.equal(asked.body.review.findings[0].proposed, 'It produces a report.');
    assert.equal(
      (
        await f.post({
          action: 'request-rewrite',
          reviewId: 'fixture',
          id: 'F1',
          another: true,
          revision: (await f.get()).revision,
        })
      ).status,
      409,
    );
    assert.deepEqual(
      (await f.agent.pendingRewrites()).pending.map(p => [p.version, p.previous]),
      [[2, ['It produces a report.']]],
    );
    const requested = (await eventFeed(f.store)).events.filter(e => e.type === 'rewrite.requested').at(-1);
    assert.equal(requested?.version, 2);
    assert.deepEqual(requested?.previous, ['It produces a report.']);
    await assert.rejects(
      f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It produces a report.' }),
      /differ from every earlier version/,
    );
    assert.equal(
      (await f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It is a report generator.' }))
        .version,
      2,
    );
    const finding = (await f.get()).findings[0];
    assert.deepEqual(
      finding.proposals.map((v: { version: number; text: string }) => [v.version, v.text]),
      [
        [1, 'It produces a report.'],
        [2, 'It is a report generator.'],
      ],
    );
    assert.equal(finding.proposed, 'It is a report generator.');
    assert.equal(finding.rewriteRequest.version, 2);
    assert.equal((await eventFeed(f.store)).events.filter(e => e.type === 'rewrite.proposed').at(-1)?.version, 2);
  } finally {
    await f.close();
  }
});
test('Accept applies the version on screen while rewrites keep arriving; Undo restores the source byte for byte', async () => {
  const f = await versionFixture();
  try {
    await f.post({ action: 'request-rewrite', reviewId: 'fixture', id: 'F1', revision: (await f.get()).revision });
    await f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It produces a report.' });
    await f.post({
      action: 'request-rewrite',
      reviewId: 'fixture',
      id: 'F1',
      another: true,
      revision: (await f.get()).revision,
    });
    await f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It is a report generator.' });
    const seen = await f.get();
    // The review file moves on (another request) while the reader looks at version 1.
    await f.post({ action: 'request-rewrite', reviewId: 'fixture', id: 'F1', another: true, revision: seen.revision });
    assert.notEqual((await f.get()).revision, seen.revision);
    const legacy = await f.post({
      action: 'accept',
      reviewId: 'fixture',
      id: 'F1',
      revision: seen.revision,
      sourceRevision: seen.sourceRevision,
    });
    assert.equal(legacy.status, 409, 'Accept without a version never applies text the reader may not have seen');
    assert.equal(
      (
        await f.post({
          action: 'accept',
          reviewId: 'fixture',
          id: 'F1',
          revision: seen.revision,
          sourceRevision: 'stale',
          version: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.post({
          action: 'accept',
          reviewId: 'fixture',
          id: 'F1',
          revision: seen.revision,
          sourceRevision: seen.sourceRevision,
          version: 9,
        })
      ).body.reason,
      'That rewrite version is no longer available. Reload and try again.',
    );
    const accepted = await f.post({
      action: 'accept',
      reviewId: 'fixture',
      id: 'F1',
      revision: seen.revision,
      sourceRevision: seen.sourceRevision,
      version: 1,
    });
    assert.equal(accepted.body.ok, true);
    assert.equal(accepted.body.review.findings[0].status, 'accepted');
    assert.equal(
      accepted.body.review.findings[0].rewriteRequest.status,
      'failed',
      'the request for version 3 is cancelled by the decision',
    );
    assert.equal(
      await readFile(f.root + '/proofmarks-fixture.mdx', 'utf8'),
      f.text.replace('It is not a tool, but a revolution.', 'It produces a report.'),
    );
    const after = await f.get();
    const undone = await f.post({
      action: 'revert',
      reviewId: 'fixture',
      id: 'F1',
      revision: after.revision,
      sourceRevision: after.sourceRevision,
    });
    assert.equal(undone.body.ok, true);
    assert.equal(await readFile(f.root + '/proofmarks-fixture.mdx', 'utf8'), f.text);
    assert.equal(undone.body.review.findings[0].proposed, 'It produces a report.');
    assert.equal(undone.body.review.findings[0].proposals.length, 2);
    await assert.rejects(
      f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'A third version.' }),
      /No pending rewrite request/,
      'Undo is not a request',
    );
    for (const body of [{ version: '1' }, { version: 0 }, { action: 'dismiss', version: 1 }, { another: true }])
      assert.equal(
        (await f.post({ action: 'accept', reviewId: 'fixture', id: 'F1', revision: after.revision, ...body })).status,
        400,
      );
  } finally {
    await f.close();
  }
});
test('Rewrite all asks once per open proof without a rewrite, and one Cancel stops every request still waiting', async () => {
  const f = await versionFixture(['It is not a plan, but a promise.', 'It is not a guess, but a bet.']);
  try {
    await f.post({ action: 'request-rewrite', reviewId: 'fixture', id: 'F1', revision: (await f.get()).revision });
    await f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It produces a report.' });
    const all = await f.post({ action: 'request-rewrite', reviewId: 'fixture', revision: (await f.get()).revision });
    assert.deepEqual(
      all.body.review.findings.map((x: { id: string; rewriteRequest: { status: string; version: number } }) => [
        x.id,
        x.rewriteRequest.status,
        x.rewriteRequest.version,
      ]),
      [
        ['F1', 'proposed', 1],
        ['F2', 'pending', 1],
        ['F3', 'pending', 1],
      ],
    );
    await f.agent.claim('fixture', 'F2');
    const cancelled = await f.post({ action: 'cancel-rewrite', reviewId: 'fixture' });
    assert.deepEqual(
      cancelled.body.review.findings.map((x: { rewriteRequest: { status: string; error?: string } }) => [
        x.rewriteRequest.status,
        x.rewriteRequest.error,
      ]),
      [
        ['proposed', undefined],
        ['failed', 'Cancelled'],
        ['failed', 'Cancelled'],
      ],
    );
    assert.deepEqual((await f.agent.pendingRewrites()).pending, []);
    await assert.rejects(
      f.agent.proposeRewrite({ reviewId: 'fixture', findingId: 'F2', text: 'It is a promise.' }),
      /No pending rewrite request/,
    );
  } finally {
    await f.close();
  }
});
test('Re-check keeps every version', async () => {
  const f = await versionFixture();
  const { mergeReview } = await import('../companion/state');
  try {
    const old = (await f.store.read('fixture')).review!,
      proposals = [
        { version: 1, text: 'First.' },
        { version: 2, text: 'Second.' },
      ];
    const merged = mergeReview(
      { ...old, findings: [{ ...old.findings[0]!, proposed: 'Second.', proposals }] },
      { ...old, findings: [{ id: 'F1', rule: 'contrast', match: 'It is not a tool, but a revolution.' }] },
      new Set(),
    );
    assert.deepEqual(merged.findings[0]!.proposals, proposals);
    assert.equal(merged.findings[0]!.proposed, 'Second.');
  } finally {
    await f.close();
  }
});
