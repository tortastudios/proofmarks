import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture';
import { createProofmarksRoutes } from './index';
test('configured rebuild runs after source changes; failed rebuild rolls back source without returning subprocess output', async () => {
  const root = await fixture();
  try {
    await writeFile(
      path.join(root, 'rebuild.mjs'),
      "import {appendFileSync} from 'node:fs';appendFileSync('rebuilt','called\\n');",
    );
    const config = JSON.parse(await readFile(path.join(root, 'proofmarks.config.json'), 'utf8'));
    config.rebuild = 'node rebuild.mjs';
    await writeFile(path.join(root, 'proofmarks.config.json'), JSON.stringify(config));
    const api = createProofmarksRoutes({ projectRoot: root });
    const get = async () =>
      await (await api.GET(new Request('http://localhost/__proofmarks/review?reviewId=custom'))).json();
    const decide = async (action: string, revision: string) =>
      api.POST(
        new Request('http://localhost/__proofmarks/decision', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-proofmarks-token': api.token },
          body: JSON.stringify({ action, reviewId: 'custom', id: 'F', revision }),
        }),
      );
    const accepted = await decide('accept', (await get()).revision);
    assert.equal(accepted.status, 200);
    const data = await accepted.json();
    assert.equal((await decide('revert', data.review.revision)).status, 200);
    assert.equal(await readFile(path.join(root, 'rebuilt'), 'utf8'), 'called\ncalled\n');
    config.rebuild = 'node -e "process.exit(7)"';
    await writeFile(path.join(root, 'proofmarks.config.json'), JSON.stringify(config));
    const failure = await decide('accept', (await get()).revision);
    assert.equal(failure.status, 409);
    assert.match((await failure.json()).reason, /Rebuild failed/);
    assert.equal(await readFile(path.join(root, 'drafts/proofmarks-fixture.mdx'), 'utf8'), 'A sentence.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
