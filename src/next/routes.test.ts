import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getReviewPaths, writableReview } from './decision-log.mjs';
import { readReview, applySourceAction } from './source';

test('the Next adapter loads config identity, supports custom roots, and refuses unlisted/read-only writes', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'proofmarks-next-'));
  try {
    await mkdir(path.join(base, 'drafts'));
    await mkdir(path.join(base, 'reviews'));
    const source = 'A sentence.',
      review = {
        source: 'drafts/proofmarks-fixture.mdx',
        rules: [],
        findings: [{ id: 'F', rule: 'r', match: source, proposed: 'A clearer sentence.' }],
      };
    await writeFile(path.join(base, review.source), source);
    await writeFile(path.join(base, 'reviews/fixture.json'), JSON.stringify(review));
    const config = {
      version: 1,
      documents: [{ id: 'custom', source: review.source, review: 'reviews/fixture.json', write: false }],
      roots: ['drafts'],
      judge: { provider: 'fake', model: 'fixture' },
    };
    const configure = () => writeFile(path.join(base, 'proofmarks.config.json'), JSON.stringify(config));
    await configure();
    const entries = await getReviewPaths(base);
    assert.equal(Object.getPrototypeOf(entries), null);
    const data = await readReview(base, 'custom');
    assert.equal(data.source, source);
    await assert.rejects(readReview(base, '__proto__'), /allow-list/);
    await assert.rejects(writableReview(base, 'missing'), /allow-list/);
    await assert.rejects(
      applySourceAction(base, 'F', 'accept', data.revision, undefined, undefined, undefined, 'custom'),
      /read-only/,
    );
    assert.equal(await readFile(path.join(base, review.source), 'utf8'), source);
    config.documents[0]!.write = true;
    await configure();
    const accepted = await applySourceAction(
      base,
      'F',
      'accept',
      data.revision,
      undefined,
      undefined,
      undefined,
      'custom',
    );
    assert.equal(accepted.findings[0]!.status, 'accepted');
    await applySourceAction(base, 'F', 'revert', accepted.revision, undefined, undefined, undefined, 'custom');
    assert.equal(await readFile(path.join(base, review.source), 'utf8'), source);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('existing React endpoint uses the shared session and token-protected handlers', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const base = await mkdtemp(path.join(tmpdir(), 'proofmarks-binding-'));
  try {
    await mkdir(path.join(base, 'drafts'));
    await mkdir(path.join(base, 'reviews'));
    await writeFile(path.join(base, 'drafts/draft.md'), 'A sentence.');
    await writeFile(
      path.join(base, 'reviews/draft.json'),
      JSON.stringify({
        source: 'drafts/draft.md',
        rules: [],
        findings: [{ id: 'F', rule: 'r', match: 'A sentence.', proposed: 'A better sentence.' }],
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
    const { createProofmarksRoutes } = await import('./index'),
      { createProofmarksTransport } = await import('../overlay/transport');
    const routes = createProofmarksRoutes({ projectRoot: base });
    const transport = createProofmarksTransport(
      '',
      (async (url, init) => {
        const request = new Request(new URL(String(url), 'http://localhost:3000'), init);
        return request.method === 'POST' ? routes.POST(request) : routes.GET(request);
      }) as typeof fetch,
      '/dev/proofmarks',
    );
    const review = await transport.review('draft');
    const result = await transport.decision('accept', 'draft', review, review.findings[0]);
    assert.equal(result.ok, true);
    assert.equal(await readFile(path.join(base, 'drafts/draft.md'), 'utf8'), 'A better sentence.');
    const undone = await transport.decision('revert', 'draft', result.review!, result.review!.findings[0]);
    assert.equal(undone.ok, true);
    assert.equal(await readFile(path.join(base, 'drafts/draft.md'), 'utf8'), 'A sentence.');
    process.env.NODE_ENV = 'production';
    assert.equal((await routes.GET(new Request('http://localhost:3000/dev/proofmarks?action=session'))).status, 404);
  } finally {
    await rm(base, { recursive: true, force: true });
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
