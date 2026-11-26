import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkJevKey, judgeStatus } from './keys';
test('a key of your own is checked against Jev with a models call, and failures never echo the provider', async () => {
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/models');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer fake-key-for-test');
    return Response.json({ models: [] });
  };
  await checkJevKey('fake-key-for-test', request);
  for (const status of [401, 403, 500])
    await assert.rejects(
      checkJevKey('fake-key-for-test', async () => new Response('private-provider-error', { status })),
      error => error instanceof Error && !error.message.includes('private-provider-error'),
    );
  await assert.rejects(
    checkJevKey('fake-key-for-test', async () => {
      throw new Error('private-provider-error');
    }),
    error => error instanceof Error && !error.message.includes('private-provider-error'),
  );
});
test('status says how Jev is reached and whether it answers, without any key material', async () => {
  const key = 'fake-test-secret-with-a-distinct-ending';
  const own = await judgeStatus({ key, check: async () => {} }),
    ownDown = await judgeStatus({
      key,
      check: async () => {
        throw new Error(key);
      },
    });
  assert.deepEqual([own.route, own.connected, ownDown.connected], ['your key', true, false]);
  // Usage counts are the person's choice, own key or not: feedback can still count.
  const previous = process.env.PROOFMARKS_TELEMETRY,
    home = process.env.HOME;
  try {
    // No saved choice from the machine running the tests.
    process.env.HOME = path.join(tmpdir(), 'proofmarks-no-home');
    process.env.PROOFMARKS_TELEMETRY = '1';
    assert.equal((await judgeStatus({ key, check: async () => {} })).usageCounts, true);
    process.env.PROOFMARKS_TELEMETRY = '0';
    assert.equal((await judgeStatus({ key, check: async () => {} })).usageCounts, false);
  } finally {
    if (previous === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous;
    process.env.HOME = home;
  }
  const relay = await judgeStatus({ key: undefined, health: async () => true }),
    relayDown = await judgeStatus({ key: undefined, health: async () => false });
  assert.deepEqual([relay.route, relay.connected, relayDown.connected], ["Torta's relay", true, false]);
  assert.ok(!JSON.stringify([own, ownDown, relay, relayDown]).includes(key.slice(-4)));
});

test("status reports the project's running helper beside this shell, since their environments can differ", async () => {
  const key = 'fake-test-secret-with-a-distinct-ending';
  const helper = { route: "Torta's relay", usageCounts: false };
  assert.deepEqual((await judgeStatus({ key, check: async () => {}, helper: async () => helper })).helper, helper);
  assert.equal('helper' in (await judgeStatus({ key, check: async () => {}, helper: async () => undefined })), false);
});
