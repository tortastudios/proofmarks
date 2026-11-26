import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture';
import { readReview, availableReview, applySourceAction } from './source';
for (const format of ['html', 'jinja'])
  test(`${format} decisions encode entities, undo exact bytes, and refuse masked spans`, async () => {
    const root = await fixture();
    try {
      const file = path.join(root, `drafts/example.${format}`),
        source =
          '<p>A &amp; B.</p>' + (format === 'jinja' ? '{% if user %}<p>Hello {{ name }} there.</p>{% endif %}' : '');
      await writeFile(file, source);
      const config = JSON.parse(await readFile(path.join(root, 'proofmarks.config.json'), 'utf8'));
      config.documents[0].source = `drafts/example.${format}`;
      config.documents[0].format = format;
      await writeFile(path.join(root, 'proofmarks.config.json'), JSON.stringify(config));
      const review = {
        source: config.documents[0].source,
        rules: [],
        findings: [{ id: 'F', rule: 'r', match: 'A & B.', proposed: 'C < D & E.' }],
      };
      await writeFile(path.join(root, 'reviews/custom.json'), JSON.stringify(review));
      const data = await readReview(root, 'custom');
      assert.equal(availableReview(data).findings[0]!.actionReason, undefined);
      const accepted = await applySourceAction(
        root,
        'F',
        'accept',
        data.revision,
        undefined,
        undefined,
        undefined,
        'custom',
      );
      assert.ok((await readFile(file, 'utf8')).includes('C &lt; D &amp; E.'));
      await applySourceAction(root, 'F', 'revert', accepted.revision, undefined, undefined, undefined, 'custom');
      assert.equal(await readFile(file, 'utf8'), source);
      if (format === 'jinja') {
        review.findings[0]!.match = 'Hello {{ name }} there.';
        await writeFile(path.join(root, 'reviews/custom.json'), JSON.stringify(review));
        const blocked = await readReview(root, 'custom');
        assert.match(availableReview(blocked).findings[0]!.actionReason!, /template expression/);
        await assert.rejects(
          applySourceAction(root, 'F', 'accept', blocked.revision, undefined, undefined, undefined, 'custom'),
          /template expression/,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
test('a document with no review yet reads as an empty review, so the page can offer its first one', async () => {
  const root = await fixture();
  try {
    await rm(path.join(root, 'reviews/custom.json'));
    const data = await readReview(root, 'custom');
    assert.deepEqual(availableReview(data).findings, []);
    // The same revision the review writer computes for a missing file, so the first review isn't refused as stale.
    assert.equal(data.revision, (await import('../companion/state')).revision(data.source, ''));
    const { createProofmarksRoutes } = await import('./index');
    const response = await createProofmarksRoutes({ projectRoot: root, token: 't' }).handle(
      new Request('http://127.0.0.1:4848/__proofmarks/review?reviewId=custom'),
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).findings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
