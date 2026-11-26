import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ReviewStore } from '../companion/state';
/** One contrast finding by default; extra sentences become extra findings F2, F3, … */
export async function eventFixture(extra: string[] = []) {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const base = await mkdtemp(new URL('events-', work).pathname),
    root = path.join(base, 'content/essays');
  await mkdir(root, { recursive: true });
  await mkdir(path.join(base, 'content/reviews'));
  const text = ['It is not a tool, but a revolution. It produces a report from the sales data.', ...extra].join('\n\n');
  const findings = ['It is not a tool, but a revolution.', ...extra].map((match, i) => ({
    id: 'F' + (i + 1),
    rule: 'contrast',
    match,
    status: 'open',
    judge: { threshold: 0.8, probability: 0.95 },
  }));
  await writeFile(path.join(root, 'proofmarks-fixture.mdx'), text);
  await writeFile(
    path.join(base, 'content/reviews/proofmarks-fixture.json'),
    JSON.stringify({ source: 'content/essays/proofmarks-fixture.mdx', findings, rules: [] }),
  );
  await writeFile(
    path.join(base, 'proofmarks.config.json'),
    JSON.stringify({
      version: 1,
      documents: [
        {
          id: 'fixture',
          source: 'content/essays/proofmarks-fixture.mdx',
          review: 'content/reviews/proofmarks-fixture.json',
          write: true,
        },
      ],
      roots: ['content/essays'],
      judge: { provider: 'fake', model: 'fixture-1' },
    }),
  );
  return {
    base,
    root,
    text,
    store: await ReviewStore.create(root),
    close: () => rm(base, { recursive: true, force: true }),
  };
}
