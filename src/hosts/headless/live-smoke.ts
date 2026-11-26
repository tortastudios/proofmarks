// Opt-in only: one fixture run for each named CLI; no real documents or real judge.
import { eventFixture } from '../../events/fixture';
import { updateRequest, eventFeed } from '../../events/index';
import { ReviewService } from '../../companion/service';
import { fakeProvider } from '../../companion/fake';
import { HeadlessRunner } from './index';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const cli = process.argv[2];
if (cli !== 'claude' && cli !== 'codex') throw new Error('Choose claude or codex');
const fixture = await eventFixture();
const runner = new HeadlessRunner(
  await ReviewService.create({ root: fixture.root, provider: fakeProvider, cacheDir: fixture.base + '/cache' }),
);
try {
  const source = fixture.root + '/proofmarks-fixture.mdx',
    before = createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
  await updateRequest(
    fixture.store,
    'fixture',
    'F1',
    f => ({
      ...f,
      rewriteRequest: { status: 'pending', target: 'headless:' + cli, requestedAt: new Date().toISOString() },
    }),
    'rewrite.requested',
  );
  await runner.start('fixture', 'F1');
  await runner.idle();
  const finding = (await fixture.store.read('fixture')).review!.findings[0]!,
    events = (await eventFeed(fixture.store)).events;
  const result = {
    cli,
    status: finding.rewriteRequest?.status,
    error: finding.rewriteRequest?.error,
    proposal: finding.proposed,
    judgedBy: finding.judge?.after?.provider,
    sourceUnchanged:
      before ===
      createHash('sha256')
        .update(await readFile(source))
        .digest('hex'),
    events: events.map(e => e.type),
  };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (result.status !== 'proposed' || !result.sourceUnchanged) process.exitCode = 1;
} finally {
  await runner.close();
  await fixture.close();
}
