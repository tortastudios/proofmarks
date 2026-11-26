import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRelay, configFromEnv } from '../../relay/src/server.ts';
import { sendFeedback, issueUrl, feedbackOn, type FeedbackReport } from './feedback';
import { setOwnersOff } from '../judge/relay';

const work = new URL('../../.test-work/', import.meta.url).pathname;
const report: FeedbackReport = {
  kind: 'wrong-mark',
  summary: 'Flags a quotation as filler',
  details: 'A quoted interview line got a Filler mark.',
  expected: 'Quotations are left alone.',
  tool: 'proofmarks_review',
  proposedFix: 'Skip text inside quotation marks.',
};

async function relay() {
  const slack: unknown[] = [];
  const request = (async (url: string | URL, init: RequestInit = {}) => {
    if (String(url).includes('hooks.slack')) slack.push(JSON.parse(String(init.body)));
    return new Response('ok');
  }) as typeof fetch;
  const instance = createRelay(
    {
      ...configFromEnv({
        TOKEN_SECRET: 's'.repeat(40),
        TYPESAFE_API_KEY: 'k',
        SLACK_FEEDBACK_WEBHOOK_URL: 'https://hooks.slack.test/feedback',
      }),
    },
    { request },
  );
  const server = createServer((incoming, response) => void instance.handle(incoming, response)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(path.join(work, 'feedback-'));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    slack,
    file: path.join(dir, 'install.json'),
    close: async () => {
      server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('feedback reaches Torta through the relay, with the setup only when usage counts are on', async () => {
  const r = await relay();
  try {
    assert.deepEqual(await sendFeedback(report, { relay: r.url, telemetry: true, file: r.file }), {
      sent: true,
      to: "Torta's Proofmarks channel",
    });
    const on = JSON.stringify(r.slack[0]);
    assert.match(on, /Flags a quotation as filler/);
    assert.match(on, /Skip text inside quotation marks/);
    assert.match(on, new RegExp(`${process.platform}-${process.arch}`));
    assert.equal((await sendFeedback(report, { relay: r.url, telemetry: false, file: r.file })).sent, true);
    const off = JSON.stringify(r.slack[1]);
    assert.match(off, /Flags a quotation as filler/);
    assert.doesNotMatch(
      off,
      new RegExp(`${process.platform}-${process.arch}`),
      'an opted-out install adds nothing about itself',
    );
  } finally {
    await r.close();
  }
});

test('a report says nothing about the install when counts go off while its token is on its way', async () => {
  const r = await relay(),
    previous = { telemetry: process.env.PROOFMARKS_TELEMETRY, home: process.env.HOME },
    bodies: { telemetry?: boolean }[] = [];
  process.env.HOME = path.dirname(r.file);
  let off = false;
  const request = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/v1/install')) {
      bodies.push(JSON.parse(String(init?.body)));
      off = true;
    }
    return fetch(url, init);
  }) as typeof fetch;
  try {
    process.env.PROOFMARKS_TELEMETRY = '1';
    setOwnersOff(() => off);
    assert.equal((await sendFeedback(report, { relay: r.url, file: r.file, request })).sent, true);
    assert.deepEqual(
      bodies.map(b => b.telemetry),
      [true, false],
    );
    assert.doesNotMatch(JSON.stringify(r.slack[0]), new RegExp(`${process.platform}-${process.arch}`));
  } finally {
    setOwnersOff(() => false);
    if (previous.telemetry === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous.telemetry;
    process.env.HOME = previous.home;
    await r.close();
  }
});

test('without the relay the agent gets a prefilled GitHub issue to hand over, and nothing is sent', async () => {
  const result = await sendFeedback(report, {
    relay: 'http://127.0.0.1:9',
    telemetry: true,
    file: path.join(work, 'feedback-none.json'),
  });
  assert.equal(result.sent, false);
  const url = new URL(result.issueUrl!);
  assert.equal(url.origin + url.pathname, 'https://github.com/tortastudios/proofmarks/issues/new');
  assert.equal(url.searchParams.get('title'), report.summary);
  assert.match(url.searchParams.get('body')!, /\*\*Proposed fix\*\*\nSkip text inside quotation marks\./);
  assert.equal(issueUrl(report), result.issueUrl);
});

test('PROOFMARKS_FEEDBACK=0 turns the tool off', () => {
  assert.equal(feedbackOn({}), true);
  for (const value of ['0', 'off', 'false', 'no']) assert.equal(feedbackOn({ PROOFMARKS_FEEDBACK: value }), false);
});
