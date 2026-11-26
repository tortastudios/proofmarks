import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { createRelay, configFromEnv, validJudgeRequest } from './server.ts';
import { issueToken, verifyToken, analyticsId } from './token.ts';
import { defaultLimits } from './limits.ts';

const secret = 's'.repeat(40);
const judgeBody = {
  model: 'jev-1.14.0',
  state: { target: 'A passage.', context: 'Around it.' },
  questions: { q1: { type: 'noul', instructions: 'Is it padded?', criteria: { true: 'yes', false: 'no' } } },
};

// A relay on a free port, with Jev, PostHog and Slack replaced by a recorder.
async function relay(
  overrides: Partial<ReturnType<typeof configFromEnv>> = {},
  upstream: (url: string, init: RequestInit) => Response = () =>
    Response.json({ answers: { q1: { noul: 0.9 } }, usage: { input_tokens: 1000 } }),
) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  let now = Date.parse('2026-11-20T12:00:00Z');
  const request = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      body: String(init.body ?? ''),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    return upstream(String(url), init);
  }) as typeof fetch;
  const config = {
    ...configFromEnv({
      TOKEN_SECRET: secret,
      TYPESAFE_API_KEY: 'jev-key',
      POSTHOG_API_KEY: 'phc_test',
      SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.test/alert',
    }),
    ...overrides,
  };
  const instance = createRelay(config, { request, now: () => now });
  const server = createServer((incoming, response) => void instance.handle(incoming, response)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    calls,
    instance,
    close: () => server.close(),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const post = (url: string, body: unknown, token?: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

test('tokens are anonymous, signed and carry the telemetry choice', () => {
  const on = issueToken(secret, true),
    off = issueToken(secret, false);
  assert.match(on.token, /^pm1\.[A-Za-z0-9_-]{22}\.1\.[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(verifyToken(secret, on.token), { id: on.install.id, telemetry: true });
  assert.deepEqual(verifyToken(secret, off.token), { id: off.install.id, telemetry: false });
  assert.equal(verifyToken(secret, on.token.replace(/\.1\./, '.0.')), undefined, 'the telemetry flag is signed');
  assert.equal(verifyToken('t'.repeat(40), on.token), undefined);
  assert.equal(verifyToken(secret, 'pm1.bad'), undefined);
  assert.doesNotMatch(analyticsId(on.install), new RegExp(on.install.id));
});

test('only Proofmarks judge requests within limits are accepted', () => {
  assert.equal(validJudgeRequest(judgeBody, ['jev-1.14.0']), true);
  assert.equal(validJudgeRequest({ ...judgeBody, model: 'gpt-x' }, ['jev-1.14.0']), false);
  assert.equal(validJudgeRequest({ ...judgeBody, extra: 1 }, ['jev-1.14.0']), false);
  assert.equal(validJudgeRequest({ ...judgeBody, state: { target: 'x'.repeat(8001) } }, ['jev-1.14.0']), false);
  assert.equal(
    validJudgeRequest(
      {
        ...judgeBody,
        questions: Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'x' }]),
        ),
      },
      ['jev-1.14.0'],
    ),
    false,
  );
  assert.equal(
    validJudgeRequest({ ...judgeBody, questions: { q1: { type: 'chat', instructions: 'x' } } }, ['jev-1.14.0']),
    false,
  );
});

test('an install gets a token, and its judge calls reach Jev with Torta key, never its own', async () => {
  const r = await relay();
  try {
    const install = (await (
      await post(`${r.base}/v1/install`, { version: '0.1.0', route: 'npm', os: 'darwin-arm64', telemetry: true })
    ).json()) as { token: string };
    assert.ok(verifyToken(secret, install.token));
    const response = await post(`${r.base}/v1/systemone`, judgeBody, install.token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answers: { q1: { noul: 0.9 } }, usage: { input_tokens: 1000 } });
    const upstream = r.calls.find(call => call.url === 'https://api.typesafe.ai/v1/systemone')!;
    assert.equal(upstream.headers.authorization, 'Bearer jev-key');
    assert.deepEqual(JSON.parse(upstream.body), judgeBody);
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody)).status, 401);
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody, 'pm1.forged')).status, 401);
    assert.equal((await post(`${r.base}/v1/systemone`, { ...judgeBody, model: 'other' }, install.token)).status, 400);
    assert.equal((await fetch(`${r.base}/health`)).status, 200);
  } finally {
    r.close();
  }
});

test('analytics carry counts and setup only, never text, tokens or location, and opted-out installs send nothing about themselves', async () => {
  const r = await relay();
  try {
    const on = (await (
      await post(`${r.base}/v1/install`, {
        version: '0.1.0',
        route: 'homebrew',
        os: 'linux-x64',
        via: 'mcp-registry',
        telemetry: true,
      })
    ).json()) as { token: string };
    await post(`${r.base}/v1/install`, {
      version: '0.1.0',
      route: 'npm',
      os: 'linux-x64',
      via: 'Not A Listing!',
      telemetry: true,
    });
    // An install that doesn't say is off, and isn't counted.
    await post(`${r.base}/v1/install`, { version: '0.1.0', route: 'npm', os: 'linux-x64' });
    const off = (await (
      await post(`${r.base}/v1/install`, { version: '0.1.0', route: 'npm', os: 'darwin-arm64', telemetry: false })
    ).json()) as { token: string; telemetry: boolean };
    assert.equal(off.telemetry, false);
    await post(`${r.base}/v1/systemone`, judgeBody, on.token);
    await post(`${r.base}/v1/systemone`, judgeBody, off.token);
    assert.equal(await r.instance.flush(), 3);
    const sent = r.calls
      .filter(call => call.url === 'https://us.i.posthog.com/batch/')
      .map(call => call.body)
      .join('\n');
    const batch = JSON.parse(sent) as {
      api_key: string;
      batch: { event: string; properties: Record<string, unknown> }[];
    };
    assert.deepEqual(
      batch.batch.map(event => event.event),
      ['proofmarks install', 'proofmarks install', 'proofmarks judge usage'],
    );
    assert.deepEqual(
      {
        route: batch.batch[0]!.properties.route,
        os: batch.batch[0]!.properties.os,
        via: batch.batch[0]!.properties.via,
      },
      { route: 'homebrew', os: 'linux-x64', via: 'mcp-registry' },
    );
    assert.equal(
      batch.batch[1]!.properties.via,
      undefined,
      'a malformed listing name is left out, the install still counted',
    );
    assert.equal(batch.batch[2]!.properties.calls, 1, 'the opted-out call is not counted');
    for (const event of batch.batch) {
      assert.equal(event.properties.$geoip_disable, true);
      assert.equal(event.properties.$process_person_profile, false);
    }
    for (const secretText of [
      'A passage.',
      'Around it.',
      'Is it padded?',
      on.token,
      off.token,
      on.token.split('.')[1]!,
    ])
      assert.ok(!sent.includes(secretText), `analytics must not contain ${secretText}`);
  } finally {
    r.close();
  }
});

test('rate limits, the per-install cap and the daily spend cap, with one alert each at 80% and 100%', async () => {
  // Each call costs $0.000084 (2,000 tokens): the first crosses 80% of a $0.0001 day, the second crosses 100%.
  const r = await relay({ limits: { ...defaultLimits, callsPerMinute: 3, dollarsPerDay: 0.0001 } }, () =>
    Response.json({ answers: { q1: { noul: 0.5 } }, usage: { input_tokens: 2000 } }),
  );
  try {
    const { token } = (await (await post(`${r.base}/v1/install`, {})).json()) as { token: string };
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody, token)).status, 200);
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody, token)).status, 200);
    const third = await post(`${r.base}/v1/systemone`, judgeBody, token);
    assert.equal(third.status, 503, 'the second call crossed the tiny daily cap');
    assert.match(((await third.json()) as { error: string }).error, /TYPESAFE_API_KEY/);
    const alerts = r.calls
      .filter(call => call.url === 'https://hooks.slack.test/alert')
      .map(call => JSON.parse(call.body).text);
    assert.deepEqual(
      alerts.map(text => /(\d+)% of today/.exec(text)?.[1]),
      ['80', '100'],
    );
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody, token)).status, 503);
    assert.equal(r.calls.filter(call => call.url === 'https://hooks.slack.test/alert').length, 2, 'each alert once');
    r.advance(24 * 3600 * 1000);
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody, token)).status, 200, 'a new day resets the cap');
  } finally {
    r.close();
  }
});

test('the relay refuses to judge without its own Jev key, and passes Jev rate limits through', async () => {
  const noKey = await relay({ jevKey: undefined });
  try {
    const { token } = (await (await post(`${noKey.base}/v1/install`, {})).json()) as { token: string };
    assert.equal((await post(`${noKey.base}/v1/systemone`, judgeBody, token)).status, 503);
  } finally {
    noKey.close();
  }
  const busy = await relay(
    {},
    () =>
      new Response('{"error":"slow down"}', {
        status: 429,
        headers: { 'retry-after': '3', 'content-type': 'application/json' },
      }),
  );
  try {
    const { token } = (await (await post(`${busy.base}/v1/install`, {})).json()) as { token: string };
    const response = await post(`${busy.base}/v1/systemone`, judgeBody, token);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '3');
  } finally {
    busy.close();
  }
});

test('per-minute limits answer 429 with a retry hint', async () => {
  const r = await relay({ limits: { ...defaultLimits, callsPerMinute: 1 } });
  try {
    const { token } = (await (await post(`${r.base}/v1/install`, {})).json()) as { token: string };
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody, token)).status, 200);
    const limited = await post(`${r.base}/v1/systemone`, judgeBody, token);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    r.advance(61_000);
    assert.equal((await post(`${r.base}/v1/systemone`, judgeBody, token)).status, 200);
  } finally {
    r.close();
  }
});

test('a new deployment without its token secret passes its health check but turns installs away', async () => {
  assert.throws(() => configFromEnv({ TOKEN_SECRET: 'short' }), /32 or more/);
  const config = configFromEnv({});
  assert.equal(config.tokenSecret, undefined);
  const instance = createRelay(config, { request: (async () => Response.json({})) as typeof fetch });
  const server = createServer((incoming, response) => void instance.handle(incoming, response)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'proofmarks-relay', judging: false });
    assert.equal((await fetch(`${base}/v1/install`, { method: 'POST', body: '{}' })).status, 503);
  } finally {
    server.close();
  }
});

test('feedback reports reach Slack escaped and bounded, at most so many a day, and only from known installs', async () => {
  const { validFeedback } = await import('./feedback.ts');
  const report = {
    kind: 'confusing-tool',
    summary: 'Claim fails after a lease ends',
    details: 'Called <!channel> claim after 2 minutes & it said "already claimed".',
    expected: 'A clear message.',
    tool: 'proofmarks_claim',
    proposedFix: 'Say the lease ended.',
    version: '0.1.0',
    route: 'npm',
    os: 'darwin-arm64',
  };
  assert.equal(validFeedback(report), true);
  assert.equal(validFeedback({ ...report, kind: 'other' }), false);
  assert.equal(validFeedback({ ...report, summary: 'x'.repeat(201) }), false);
  assert.equal(validFeedback({ ...report, extra: 1 }), false);
  assert.equal(validFeedback({ ...report, tool: 'Not A Tool!' }), false);
  const r = await relay(
    { feedbackWebhook: 'https://hooks.slack.test/feedback', limits: { ...defaultLimits, feedbackPerInstallPerDay: 1 } },
    url => (url.includes('hooks.slack') ? new Response('ok') : Response.json({})),
  );
  try {
    const { token } = (await (await post(`${r.base}/v1/install`, {})).json()) as { token: string };
    assert.equal((await post(`${r.base}/v1/feedback`, report)).status, 401);
    assert.equal((await post(`${r.base}/v1/feedback`, { ...report, kind: 'other' }, token)).status, 400);
    assert.equal((await post(`${r.base}/v1/feedback`, report, token)).status, 200);
    const slack = r.calls.find(call => call.url === 'https://hooks.slack.test/feedback')!;
    const message = JSON.parse(slack.body) as { text: string; blocks: { text?: { text: string } }[] };
    assert.match(message.text, /^Proofmarks feedback \(confusing-tool\): Claim fails after a lease ends$/);
    const body = JSON.stringify(message.blocks);
    assert.match(body, /&lt;!channel&gt; claim after 2 minutes &amp; it said/);
    assert.doesNotMatch(body, /<!channel>/);
    assert.match(body, /Say the lease ended/);
    assert.match(body, /Proofmarks 0.1.0 · npm · darwin-arm64 · tool proofmarks_claim/);
    assert.equal((await post(`${r.base}/v1/feedback`, report, token)).status, 429, 'one a day in this test');
  } finally {
    r.close();
  }
  const off = await relay({ feedbackWebhook: undefined });
  try {
    const { token } = (await (await post(`${off.base}/v1/install`, {})).json()) as { token: string };
    assert.equal((await post(`${off.base}/v1/feedback`, report, token)).status, 503);
  } finally {
    off.close();
  }
});

test('compressed request bodies are unpacked, within the same size limit', async () => {
  const r = await relay();
  try {
    const { token } = (await (await post(`${r.base}/v1/install`, {})).json()) as { token: string };
    const send = (data: Buffer, encoding: string, body = new Uint8Array(data)) =>
      fetch(`${r.base}/v1/systemone`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-encoding': encoding },
        body,
      });
    const json = Buffer.from(JSON.stringify(judgeBody));
    assert.equal(
      (await send(zstdCompressSync(json), 'zstd')).status,
      200,
      'zstd, as the TypeSafe SDK sends 1 KB or more',
    );
    assert.equal((await send(gzipSync(json), 'gzip')).status, 200);
    assert.equal((await send(json, 'compress')).status, 415);
    assert.equal((await send(Buffer.from('not zstd'), 'zstd')).status, 400);
    const huge = zstdCompressSync(
      Buffer.from(JSON.stringify({ ...judgeBody, state: { target: 'x'.repeat(200_000) } })),
    );
    assert.ok(huge.length < 64 * 1024, 'small when compressed');
    assert.equal((await send(huge, 'zstd')).status, 413, 'too large once unpacked');
  } finally {
    r.close();
  }
});

test('decision counts become hourly totals by rule, action, score and line, never tied to an install', async () => {
  const { validDecision } = await import('./server.ts');
  const count = {
    rule: 'generic-voice',
    action: 'dismissed',
    score: 0.7499,
    line: 0.7,
    model: 'jev-1.14.0',
    rulesVersion: '3',
  };
  assert.equal(validDecision(count), true);
  for (const bad of [
    { ...count, text: 'The passage.' },
    { ...count, action: 'liked' },
    { ...count, score: 2 },
    { ...count, rule: 'Generic Voice!' },
  ])
    assert.equal(validDecision(bad), false);
  const r = await relay({ limits: { ...defaultLimits, decisionsPerInstallPerDay: 3 } });
  try {
    const on = (await (
      await post(`${r.base}/v1/install`, { version: '0.1.0', route: 'npm', os: 'linux-x64', telemetry: true })
    ).json()) as {
      token: string;
    };
    const off = (await (await post(`${r.base}/v1/install`, { telemetry: false })).json()) as { token: string };
    assert.equal((await post(`${r.base}/v1/decisions`, count)).status, 401);
    assert.equal((await post(`${r.base}/v1/decisions`, { ...count, text: 'The passage.' }, on.token)).status, 400);
    for (let i = 0; i < 2; i++) assert.equal((await post(`${r.base}/v1/decisions`, count, on.token)).status, 200);
    await post(`${r.base}/v1/decisions`, { ...count, action: 'kept', score: 0.91 }, on.token);
    await post(`${r.base}/v1/decisions`, count, on.token);
    assert.equal((await post(`${r.base}/v1/decisions`, count, off.token)).status, 200);
    await r.instance.flush();
    const sent = r.calls.filter(call => call.url === 'https://us.i.posthog.com/batch/').map(call => call.body);
    const events = sent
      .flatMap(
        body =>
          (JSON.parse(body) as { batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[] })
            .batch,
      )
      .filter(event => event.event === 'proofmarks decisions');
    assert.deepEqual(
      events.map(event => [event.distinct_id, event.properties.action, event.properties.score, event.properties.count]),
      [
        ['proofmarks-relay', 'dismissed', 0.7, 2],
        ['proofmarks-relay', 'kept', 0.9, 1],
      ],
      'past the daily cap and from opted-out installs, counts are dropped',
    );
    for (const token of [on.token, off.token]) assert.ok(!sent.join('\n').includes(token));
    await r.instance.flush();
    assert.equal(
      r.calls.filter(call => call.url === 'https://us.i.posthog.com/batch/').length,
      sent.length,
      'totals start over each hour',
    );
  } finally {
    r.close();
  }
});
