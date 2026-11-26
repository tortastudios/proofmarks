import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const work = new URL('../../.test-work/', import.meta.url);
export async function fixture() {
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(new URL('api-', work).pathname);
  await mkdir(path.join(root, 'drafts'));
  await mkdir(path.join(root, 'reviews'));
  await writeFile(path.join(root, 'drafts/proofmarks-fixture.mdx'), 'A sentence.');
  await writeFile(
    path.join(root, 'reviews/custom.json'),
    JSON.stringify({
      source: 'drafts/proofmarks-fixture.mdx',
      rules: [],
      findings: [{ id: 'F', rule: 'r', match: 'A sentence.', proposed: 'A better sentence.' }],
    }),
  );
  await writeFile(
    path.join(root, 'proofmarks.config.json'),
    JSON.stringify({
      version: 1,
      roots: ['drafts'],
      documents: [
        {
          id: 'custom',
          source: 'drafts/proofmarks-fixture.mdx',
          review: 'reviews/custom.json',
          write: true,
          url: '/essay',
        },
      ],
      judge: { provider: 'fake', model: 'fixture' },
    }),
  );
  return root;
}
