import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProofmarksTransport } from './transport';

test('one shared session token protects every write, never GETs or request bodies', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const request = (async (url: string | URL | Request, options: RequestInit = {}) => {
    calls.push({ url: String(url), options });
    return Response.json(
      String(url).endsWith('/session')
        ? { token: 'private-session', project: 'fixture', version: '0' }
        : { ok: true, reviewId: 'draft' },
    );
  }) as typeof fetch;
  const transport = createProofmarksTransport('http://localhost:4848/', request);
  await Promise.all([transport.match('/draft', 'x'.repeat(5000)), transport.target('headless:claude')]);
  await transport.decision(
    'accept',
    'draft',
    { findings: [], rules: [], revision: 'r' },
    { id: 'F', rule: 'r', match: 'text' },
  );
  await transport.decision('request-rewrite', 'draft', { findings: [], rules: [], revision: 'r' });
  await transport.decision(
    'cancel-rewrite',
    'draft',
    { findings: [], rules: [], revision: 'r' },
    { id: 'F', rule: 'r', match: 'text' },
  );
  await transport.recheck('draft');
  await transport.review('draft with spaces');
  await transport.agents();
  await transport.status();
  assert.equal(calls.filter(c => c.url.endsWith('/session')).length, 1);
  assert.equal(JSON.parse(String(calls.find(c => c.url.endsWith('/match'))!.options.body)).sample.length, 4000);
  for (const call of calls) {
    if (call.options.method === 'POST') {
      assert.deepEqual(call.options.headers, {
        'Content-Type': 'application/json',
        'X-Proofmarks-Token': 'private-session',
      });
      assert.ok(!String(call.options.body).includes('private-session'));
    } else assert.equal(call.options.headers, undefined);
  }
  assert.ok(calls.some(c => c.url.endsWith('/review?reviewId=draft%20with%20spaces')));
  assert.deepEqual(
    calls.filter(c => c.options.method === 'POST').map(c => new URL(c.url).pathname),
    [
      '/__proofmarks/match',
      '/__proofmarks/target',
      '/__proofmarks/decision',
      '/__proofmarks/request-rewrite',
      '/__proofmarks/cancel-rewrite',
      '/__proofmarks/review',
    ],
  );
});

test('offline sessions retry and server refusal stays a plain actionable error', async () => {
  let attempts = 0;
  const transport = createProofmarksTransport('', (async (url: string | URL | Request) => {
    if (String(url).endsWith('/session')) {
      if (++attempts === 1) throw Error('offline');
      return Response.json({ token: 'private-session' });
    }
    return Response.json({ reason: 'Source changed. Check again.' }, { status: 409 });
  }) as typeof fetch);
  await assert.rejects(transport.match('/', ''), /offline/);
  await assert.rejects(transport.match('/', ''), /Source changed/);
  assert.equal(attempts, 2);
});
