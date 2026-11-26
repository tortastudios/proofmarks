import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture';
import { matchDocument } from './match';
test('document identity comes from URL patterns or a unique text fingerprint; injection and short samples fail closed', async () => {
  const root = await fixture();
  try {
    assert.deepEqual(await matchDocument(root, { url: '/essay', sample: '' }), { reviewId: 'custom' });
    const config = JSON.parse(await readFile(path.join(root, 'proofmarks.config.json'), 'utf8'));
    config.documents[0].url = '/writing/*';
    await writeFile(path.join(root, 'proofmarks.config.json'), JSON.stringify(config));
    assert.deepEqual(await matchDocument(root, { url: 'http://localhost/writing/first', sample: '' }), {
      reviewId: 'custom',
    });
    const sentence =
      'This is a sufficiently long article sentence with several distinctive words to match this page to its exact configured source.';
    await writeFile(path.join(root, 'drafts/proofmarks-fixture.mdx'), sentence);
    assert.deepEqual(await matchDocument(root, { url: '/elsewhere', sample: sentence }), { reviewId: 'custom' });
    assert.equal((await matchDocument(root, { url: '/elsewhere', sample: 'short' })).reviewId, null);
    await assert.rejects(matchDocument(root, { url: '/', sample: 'x'.repeat(4001) }), /4,000/);
    await assert.rejects(matchDocument(root, { url: '/', sample: '', path: 'injection' }), /URL/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
