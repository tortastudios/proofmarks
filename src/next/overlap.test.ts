import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { eventFixture } from '../events/fixture';
import { applySourceAction, readReview } from './source';
import { eventFeed } from '../events/index';
import { replayDecisions } from './decision-log.mjs';
import type { ProofmarksFinding } from '../overlay/types';
import { reconcileReview } from '../overlay/reconcile';
async function fixture() {
  const f = await eventFixture();
  const sentence = 'The sample is clear, concise, and useful.',
    tail = 'The next sample uses inflated language.';
  const source = `---\nsummary: "${sentence}"\ndescription: "${tail}"\n---\n\nEarlier sentence. ${sentence} ${tail}\n`;
  const body = source.indexOf(sentence, source.indexOf('---', 4) + 3),
    later = source.lastIndexOf(tail),
    metaTail = source.indexOf(tail);
  const request = { status: 'pending' as const, target: 'test-agent', requestedAt: 'November 7, 2026' };
  const findings: ProofmarksFinding[] = [
    {
      id: 'D002',
      rule: 'three',
      match: sentence,
      proposed: 'The sample helps.',
      span: { start: body, end: body + sentence.length },
    },
    {
      id: 'D003',
      rule: 'puffery',
      match: sentence,
      span: { start: body, end: body + sentence.length },
      rewriteRequest: request,
    },
    {
      id: 'META',
      rule: 'puffery',
      match: 'clear, concise',
      target: { kind: 'meta', field: 'summary' },
      span: { start: source.indexOf('clear'), end: source.indexOf('clear') + 14 },
      rewriteRequest: request,
    },
    { id: 'LATER', rule: 'puffery', match: tail, span: { start: later, end: later + tail.length } },
    {
      id: 'METALATER',
      rule: 'puffery',
      match: tail,
      target: { kind: 'meta', field: 'description' },
      span: { start: metaTail, end: metaTail + tail.length },
    },
  ];
  const initial = await f.store.read('fixture');
  await writeFile(initial.sourceFile, source);
  await writeFile(
    initial.file,
    JSON.stringify({ source: 'content/essays/proofmarks-fixture.mdx', findings, rules: [] }),
  );
  return { ...f, source, sentence, tail, findings };
}
test('Accept supersedes body/hidden overlaps, drops requests, shifts every later region, and Undo restores exact prior findings', async () => {
  const f = await fixture();
  try {
    const initial = await readReview(f.base, 'fixture'),
      accepted = await applySourceAction(
        f.base,
        'D002',
        'accept',
        initial.revision,
        undefined,
        undefined,
        undefined,
        'fixture',
      );
    const raw = (await f.store.read('fixture')).review!;
    const sibling = raw.findings.find(f => f.id === 'D003')!,
      meta = raw.findings.find(f => f.id === 'META')!;
    assert.equal(sibling.status, 'superseded');
    assert.equal(sibling.supersededBy, 'D002');
    assert.equal(sibling.rewriteRequest, undefined);
    assert.equal(meta.status, 'superseded');
    assert.equal(meta.rewriteRequest, undefined);
    const source = await readFile(initial.target, 'utf8');
    assert.equal(source.split('The sample helps.').length, 3);
    for (const id of ['LATER', 'METALATER']) {
      const current = raw.findings.find(f => f.id === id)!;
      const span = current.span as { start: number; end: number };
      assert.equal(source.slice(span.start, span.end), f.tail);
      assert.notDeepEqual(span, f.findings.find(f => f.id === id)!.span);
    }
    const journal = (await readFile(initial.reviewPath.replace(/\.json$/, '.log.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(journal.filter(e => e.action === 'supersede').length, 2);
    assert.equal(
      (await eventFeed(f.store)).events.filter(e => e.findingId === 'D003' || e.findingId === 'META').length,
      0,
    );
    assert.deepEqual(reconcileReview(source, raw as never).issues, []);
    await applySourceAction(f.base, 'D002', 'revert', accepted.revision, undefined, undefined, undefined, 'fixture');
    const restored = (await f.store.read('fixture')).review!;
    for (const id of ['D003', 'META', 'LATER', 'METALATER'])
      assert.deepEqual(
        restored.findings.find(f => f.id === id),
        f.findings.find(f => f.id === id),
      );
    assert.equal(await readFile(initial.target, 'utf8'), f.source);
    assert.equal((await replayDecisions(f.base, 'fixture')).changed, false);
  } finally {
    await f.close();
  }
});
test('Accept keeps a paragraph proof around the accepted sentence open with its text updated, and Undo restores it exactly', async () => {
  const f = await fixture();
  try {
    const paragraph = `Earlier sentence. ${f.sentence} ${f.tail}`,
      start = f.source.indexOf(paragraph),
      stale = 'A paragraph rewrite written for the old text.';
    const para: ProofmarksFinding = {
      id: 'PARA',
      rule: 'generic-voice',
      match: paragraph,
      span: { start, end: start + paragraph.length },
      rewriteRequest: { status: 'proposed', target: 'test-agent', requestedAt: 'November 7, 2026' },
      proposed: stale,
      proposals: [{ version: 1, text: stale }],
    };
    const snapshot = await f.store.read('fixture');
    await writeFile(
      snapshot.file,
      JSON.stringify({ ...snapshot.review, findings: [...snapshot.review!.findings, para] }),
    );
    const initial = await readReview(f.base, 'fixture'),
      accepted = await applySourceAction(
        f.base,
        'D002',
        'accept',
        initial.revision,
        undefined,
        undefined,
        undefined,
        'fixture',
      );
    const raw = (await f.store.read('fixture')).review!,
      carried = raw.findings.find(f => f.id === 'PARA')!,
      source = await readFile(initial.target, 'utf8');
    assert.equal(carried.status ?? 'open', 'open');
    assert.equal(carried.match, `Earlier sentence. The sample helps. ${f.tail}`);
    const span = carried.span as { start: number; end: number };
    assert.equal(source.slice(span.start, span.end), carried.match);
    // Its rewrite was written for the old paragraph, so accepting it later would undo the sentence just accepted.
    assert.equal(carried.rewriteRequest, undefined);
    assert.equal(carried.proposed, undefined);
    assert.equal(carried.proposals, undefined);
    assert.equal(
      raw.findings.find(f => f.id === 'D003')?.status,
      'superseded',
      'a proof on exactly the accepted words is still retired',
    );
    assert.equal(
      raw.findings.find(f => f.id === 'META')?.status,
      'superseded',
      'a proof inside the accepted words is still retired',
    );
    const journal = (await readFile(initial.reviewPath.replace(/\.json$/, '.log.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(journal.filter(e => e.action === 'carry').length, 1);
    assert.deepEqual(reconcileReview(source, raw as never).issues, []);
    assert.equal((await replayDecisions(f.base, 'fixture')).changed, false);
    await applySourceAction(f.base, 'D002', 'revert', accepted.revision, undefined, undefined, undefined, 'fixture');
    assert.deepEqual(
      (await f.store.read('fixture')).review!.findings.find(f => f.id === 'PARA'),
      para,
    );
    assert.equal(await readFile(initial.target, 'utf8'), f.source);
    assert.equal((await replayDecisions(f.base, 'fixture')).changed, false);
  } finally {
    await f.close();
  }
});
test('durable Accept/Undo transactions recover all sibling statuses and spans after an interrupted projection', async () => {
  const f = await fixture();
  try {
    const initial = await readReview(f.base, 'fixture');
    const accepted = await applySourceAction(
      f.base,
      'D002',
      'accept',
      initial.revision,
      undefined,
      undefined,
      undefined,
      'fixture',
    );
    const acceptedBytes = await readFile(initial.reviewPath, 'utf8');
    await writeFile(initial.reviewPath, initial.raw);
    assert.equal((await f.store.read('fixture')).review!.findings.find(f => f.id === 'D003')?.status, 'superseded');
    assert.equal((await replayDecisions(f.base, 'fixture')).changed, true);
    assert.equal(await readFile(initial.reviewPath, 'utf8'), acceptedBytes);
    await applySourceAction(f.base, 'D002', 'revert', accepted.revision, undefined, undefined, undefined, 'fixture');
    const undoneBytes = await readFile(initial.reviewPath, 'utf8');
    await writeFile(initial.reviewPath, acceptedBytes);
    assert.equal((await f.store.read('fixture')).review!.findings.find(f => f.id === 'D003')?.status ?? 'open', 'open');
    await replayDecisions(f.base, 'fixture');
    assert.equal(await readFile(initial.reviewPath, 'utf8'), undoneBytes);
  } finally {
    await f.close();
  }
});
test('replay preserves rewrite requests made after an Accept transaction', async () => {
  const f = await fixture();
  try {
    const initial = await readReview(f.base, 'fixture');
    await applySourceAction(f.base, 'D002', 'accept', initial.revision, undefined, undefined, undefined, 'fixture');
    const { updateRequest } = await import('../events/index');
    await updateRequest(
      f.store,
      'fixture',
      'LATER',
      finding => ({
        ...finding,
        rewriteRequest: { status: 'pending', target: 'later-agent', requestedAt: 'November 7, 2026' },
      }),
      'rewrite.requested',
    );
    const before = await readFile(initial.reviewPath, 'utf8');
    assert.equal((await replayDecisions(f.base, 'fixture')).changed, false);
    assert.equal(await readFile(initial.reviewPath, 'utf8'), before);
    assert.equal(
      (await f.store.read('fixture')).review!.findings.find(f => f.id === 'LATER')?.rewriteRequest?.target,
      'later-agent',
    );
  } finally {
    await f.close();
  }
});
