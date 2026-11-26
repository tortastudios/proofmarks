import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRelay, configFromEnv } from '../../relay/src/server.ts';
import {
  createRelayJev,
  installToken,
  rememberVia,
  envTurnsOff,
  saveTelemetry,
  setOwnersOff,
  telemetryOn,
  telemetryState,
  RESTING,
} from './relay';

const work = new URL('../../.test-work/', import.meta.url).pathname;
const question = { id: 'q1', kind: 'yes-no' as const, ask: 'Is it padded?' };

// The real relay code on a free port, in front of a fake Jev.
async function relay(
  jev: () => Response = () => Response.json({ answers: { q1: { noul: 0.75 } }, usage: { input_tokens: 500 } }),
  overrides = {},
) {
  const seen: { url: string; authorization: string | null; body: string }[] = [];
  const request = (async (url: string | URL, init: RequestInit = {}) => {
    seen.push({
      url: String(url),
      authorization: new Headers(init.headers).get('authorization'),
      body: String(init.body ?? ''),
    });
    return jev();
  }) as typeof fetch;
  const instance = createRelay(
    { ...configFromEnv({ TOKEN_SECRET: 's'.repeat(40), TYPESAFE_API_KEY: 'torta-jev-key' }), ...overrides },
    { request },
  );
  const server = createServer((incoming, response) => void instance.handle(incoming, response)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen, close: () => server.close() };
}
async function scratch() {
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(path.join(work, 'relay-client-'));
  return { file: path.join(dir, 'install.json'), close: () => rm(dir, { recursive: true, force: true }) };
}

test('usage counts are off until the person turns them on; DO_NOT_TRACK and CI turn them off', async () => {
  const s = await scratch(),
    file = path.join(path.dirname(s.file), 'telemetry.json');
  try {
    assert.deepEqual(telemetryState({}, file), { on: false, by: 'default' });
    await saveTelemetry(true, file);
    assert.deepEqual(telemetryState({}, file), { on: true, by: 'saved' });
    assert.equal(((await stat(file)).mode & 0o777).toString(8), '600');
    assert.deepEqual(telemetryState({ DO_NOT_TRACK: '1' }, file), { on: false, by: 'DO_NOT_TRACK' });
    assert.deepEqual(telemetryState({ CI: 'true' }, file), { on: false, by: 'CI' });
    assert.deepEqual(telemetryState({ CI: 'false' }, file), { on: true, by: 'saved' });
    for (const value of ['0', 'off', 'false', 'NO'])
      assert.equal(telemetryOn({ PROOFMARKS_TELEMETRY: value }, file), false);
    // Setting it on in a process outranks CI, but any off wins: DO_NOT_TRACK, and a saved off, even for a helper
    // started with PROOFMARKS_TELEMETRY=1.
    assert.deepEqual(telemetryState({ PROOFMARKS_TELEMETRY: '1', CI: 'true' }, file), {
      on: true,
      by: 'PROOFMARKS_TELEMETRY',
    });
    assert.equal(telemetryOn({ PROOFMARKS_TELEMETRY: '1', DO_NOT_TRACK: '1' }, file), false);
    await saveTelemetry(false, file);
    assert.deepEqual(telemetryState({ PROOFMARKS_TELEMETRY: '1' }, file), { on: false, by: 'saved' });
    await writeFile(file, 'not json');
    assert.deepEqual(telemetryState({}, file), { on: false, by: 'default' });
  } finally {
    await s.close();
  }
});

test('an install asks once for a token, keeps it privately, and asks again when its choice changes', async () => {
  const r = await relay(),
    s = await scratch(),
    bodies: unknown[] = [];
  const request = (async (url: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return fetch(url, init);
  }) as typeof fetch;
  try {
    const options = {
      relay: r.url,
      version: '0.1.0',
      route: 'npm',
      file: s.file,
      request,
    };
    const first = await installToken({ ...options, telemetry: true });
    assert.equal(await installToken({ ...options, telemetry: true }), first, 'kept, not asked again');
    assert.equal(((await stat(s.file)).mode & 0o777).toString(8), '600');
    assert.deepEqual(bodies[0], {
      version: '0.1.0',
      route: 'npm',
      os: `${process.platform}-${process.arch}`,
      telemetry: true,
    });
    const off = await installToken({ ...options, telemetry: false });
    assert.notEqual(off, first);
    assert.match(off, /^pm1\.[^.]+\.0\./);
    assert.deepEqual(bodies[1], { telemetry: false }, 'an opted-out install sends nothing about itself');
    assert.deepEqual(JSON.parse(await readFile(s.file, 'utf8')), { token: off, relay: r.url, telemetry: false });
  } finally {
    r.close();
    await s.close();
  }
});

test('Jev through the relay: the install token goes to the relay, Torta key goes to Jev, and the answer comes back', async () => {
  const r = await relay(),
    s = await scratch();
  try {
    const provider = createRelayJev({ relay: r.url, telemetry: true, version: '0.1.0', route: 'npm', file: s.file });
    const result = await provider.judge({ target: 'A passage.' }, [question]);
    assert.deepEqual(result.answers, [{ id: 'q1', probability: 0.75 }]);
    assert.equal(r.seen[0]!.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(r.seen[0]!.authorization, 'Bearer torta-jev-key');
    assert.equal(JSON.parse(r.seen[0]!.body).state.target, 'A passage.');
  } finally {
    r.close();
    await s.close();
  }
});

test('a token the relay no longer knows is replaced once, and a resting relay says how to keep going', async () => {
  const r = await relay(),
    s = await scratch();
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      s.file,
      JSON.stringify({
        token: 'pm1.AAAAAAAAAAAAAAAAAAAAAA.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        relay: r.url,
        telemetry: true,
      }),
    );
    const provider = createRelayJev({ relay: r.url, telemetry: true, version: '0.1.0', route: 'npm', file: s.file });
    assert.equal((await provider.judge({ target: 'A passage.' }, [question])).answers[0]!.probability, 0.75);
  } finally {
    r.close();
    await s.close();
  }
  const resting = await relay(undefined, {
      limits: {
        callsPerMinute: 99,
        callsPerDay: 99,
        dollarsPerInstallPerDay: 1,
        dollarsPerDay: 0,
        feedbackPerInstallPerDay: 1,
        feedbackPerDay: 1,
        installsPerAddressPerDay: 9,
      },
    }),
    t = await scratch();
  try {
    const provider = createRelayJev({
      relay: resting.url,
      telemetry: true,
      version: '0.1.0',
      route: 'npm',
      file: t.file,
    });
    await assert.rejects(
      provider.judge({ target: 'A passage.' }, [question]),
      new RegExp(RESTING.slice(0, 40).replace(/[.'()]/g, '.')),
    );
  } finally {
    resting.close();
    await t.close();
  }
});

test('calls refused together share one new token, and every one of them gets its answer', async () => {
  const r = await relay(),
    s = await scratch();
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      s.file,
      JSON.stringify({
        token: 'pm1.AAAAAAAAAAAAAAAAAAAAAA.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        relay: r.url,
        telemetry: true,
      }),
    );
    const provider = createRelayJev({ relay: r.url, telemetry: true, version: '0.1.0', route: 'npm', file: s.file });
    // Four at once, as a review sends them: before, each asked for its own token and their saves collided.
    const answers = await Promise.all([1, 2, 3, 4].map(n => provider.judge({ target: `Passage ${n}.` }, [question])));
    assert.deepEqual(
      answers.map(a => a.answers[0]!.probability),
      [0.75, 0.75, 0.75, 0.75],
    );
    assert.equal(r.seen.filter(call => call.url.endsWith('/v1/install')).length, 0, 'Jev saw no install calls');
    const saved = JSON.parse(await readFile(s.file, 'utf8')) as { token: string };
    assert.notEqual(saved.token, 'pm1.AAAAAAAAAAAAAAAAAAAAAA.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  } finally {
    r.close();
    await s.close();
  }
});

test('the listing an install came from rides along with its first install request, only while counts are on', async () => {
  const r = await relay(),
    s = await scratch(),
    bodies: Record<string, unknown>[] = [];
  const request = (async (url: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return fetch(url, init);
  }) as typeof fetch;
  try {
    const options = { relay: r.url, version: '0.1.0', route: 'npm', file: s.file, request, via: undefined };
    await rememberVia('mcp-registry', s.file);
    await assert.rejects(rememberVia('Not A Listing!', s.file));
    await installToken({ ...options, telemetry: true });
    assert.equal(bodies[0]!.via, 'mcp-registry', 'from init --via');
    assert.equal(JSON.parse(await readFile(s.file, 'utf8')).via, 'mcp-registry', 'kept with the token');
    await installToken({ ...options, telemetry: true, via: 'claude-plugins' }, true);
    assert.equal(bodies[1]!.via, 'claude-plugins', 'PROOFMARKS_VIA from a listing config wins');
    await installToken({ ...options, telemetry: true, via: 'BAD value' }, true);
    assert.equal(
      bodies[2]!.via,
      'claude-plugins',
      'a malformed name falls back to the one remembered with the last token',
    );
    await installToken({ ...options, telemetry: false });
    assert.deepEqual(bodies[3], { telemetry: false }, 'opted out: nothing about the install, not even the listing');
  } finally {
    r.close();
    await s.close();
  }
});

test('a real review request (over 1 KB, which the TypeSafe SDK compresses) gets through the relay', async () => {
  const r = await relay(() =>
      Response.json({ answers: { a: { noul: 0.9 }, b: { noul: 0.1 } }, usage: { input_tokens: 900 } }),
    ),
    s = await scratch();
  try {
    const provider = createRelayJev({ relay: r.url, telemetry: true, version: '0.1.0', route: 'npm', file: s.file });
    const long = 'A paragraph of context that a real review sends along with the passage being judged. '.repeat(20);
    const questions = ['a', 'b'].map(id => ({
      id,
      kind: 'yes-no' as const,
      ask: `Is this question ${id} about the passage?`,
      yes: 'Examples of yes. '.repeat(10),
      no: 'Examples of no. '.repeat(10),
    }));
    const result = await provider.judge({ target: 'A passage.', context: long }, questions);
    assert.deepEqual(result.answers, [
      { id: 'a', probability: 0.9 },
      { id: 'b', probability: 0.1 },
    ]);
    assert.equal(JSON.parse(r.seen[0]!.body).state.context, long, 'Jev gets the unpacked request');
  } finally {
    r.close();
    await s.close();
  }
});

test('turning counts off while a helper runs gets the relay a token that says so', async () => {
  const r = await relay(),
    s = await scratch(),
    previous = { telemetry: process.env.PROOFMARKS_TELEMETRY, home: process.env.HOME },
    bodies: { telemetry?: boolean }[] = [];
  // No saved choice from the machine running the tests.
  process.env.HOME = path.dirname(s.file);
  const request = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/v1/install')) bodies.push(JSON.parse(String(init?.body)));
    return fetch(url, init);
  }) as typeof fetch;
  try {
    const provider = createRelayJev({ relay: r.url, version: '0.1.0', route: 'npm', file: s.file, request });
    process.env.PROOFMARKS_TELEMETRY = '1';
    await provider.judge({ target: 'A passage.' }, [question]);
    process.env.PROOFMARKS_TELEMETRY = '0';
    await provider.judge({ target: 'Another passage.' }, [question]);
    await provider.judge({ target: 'A third passage.' }, [question]);
    assert.deepEqual(
      bodies.map(b => b.telemetry),
      [true, false],
      'one new token for the new choice, then kept',
    );
  } finally {
    if (previous.telemetry === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous.telemetry;
    process.env.HOME = previous.home;
    r.close();
    await s.close();
  }
});

test('turning counts off while a judgment waits to retry gets the retry a token that says so', async () => {
  let failed = false,
    off = false;
  // The first call fails, and counts are turned off while the client waits to try again.
  const r = await relay(() => {
      if (failed) return Response.json({ answers: { q1: { noul: 0.75 } }, usage: { input_tokens: 500 } });
      failed = off = true;
      return new Response('upstream down', { status: 500 });
    }),
    s = await scratch(),
    previous = { telemetry: process.env.PROOFMARKS_TELEMETRY, home: process.env.HOME },
    bodies: { telemetry?: boolean }[] = [];
  process.env.HOME = path.dirname(s.file);
  const request = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/v1/install')) bodies.push(JSON.parse(String(init?.body)));
    return fetch(url, init);
  }) as typeof fetch;
  try {
    process.env.PROOFMARKS_TELEMETRY = '1';
    setOwnersOff(() => off);
    const provider = createRelayJev({ relay: r.url, version: '0.1.0', route: 'npm', file: s.file, request });
    const result = await provider.judge({ target: 'A passage.' }, [question]);
    assert.equal(result.answers[0]!.probability, 0.75);
    assert.deepEqual(
      bodies.map(b => b.telemetry),
      [true, false],
      'the retry asks for a token with counts off',
    );
  } finally {
    setOwnersOff(() => false);
    if (previous.telemetry === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous.telemetry;
    process.env.HOME = previous.home;
    r.close();
    await s.close();
  }
});

test('turning counts off while a new token is on its way gets the judgment a token that says so', async () => {
  const r = await relay(),
    s = await scratch(),
    previous = { telemetry: process.env.PROOFMARKS_TELEMETRY, home: process.env.HOME },
    bodies: { telemetry?: boolean }[] = [];
  let off = false;
  process.env.HOME = path.dirname(s.file);
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
    const provider = createRelayJev({ relay: r.url, version: '0.1.0', route: 'npm', file: s.file, request });
    await provider.judge({ target: 'A passage.' }, [question]);
    assert.deepEqual(
      bodies.map(b => b.telemetry),
      [true, false],
      'the judgment waits for a token with counts off',
    );
    assert.equal(r.seen.length, 1, 'one judge request, with the new token');
  } finally {
    setOwnersOff(() => false);
    if (previous.telemetry === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous.telemetry;
    process.env.HOME = previous.home;
    r.close();
    await s.close();
  }
});

test('a judgment stopped while its token is on its way asks for no more tokens', async () => {
  const r = await relay(),
    s = await scratch(),
    previous = { telemetry: process.env.PROOFMARKS_TELEMETRY, home: process.env.HOME },
    stop = new AbortController();
  let registrations = 0,
    off = false;
  process.env.HOME = path.dirname(s.file);
  // Every token request stops the judgment and changes the choice, so only cancellation ends the asking.
  const request = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/v1/install')) {
      registrations++;
      off = !off;
      stop.abort();
    }
    return fetch(url, init);
  }) as typeof fetch;
  try {
    process.env.PROOFMARKS_TELEMETRY = '1';
    setOwnersOff(() => off);
    const provider = createRelayJev({ relay: r.url, version: '0.1.0', route: 'npm', file: s.file, request });
    await assert.rejects(provider.judge({ target: 'A passage.' }, [question], { signal: stop.signal }), /stopped/);
    assert.equal(registrations, 1);
    assert.equal(r.seen.length, 0, 'no judge request');
  } finally {
    setOwnersOff(() => false);
    if (previous.telemetry === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous.telemetry;
    process.env.HOME = previous.home;
    r.close();
    await s.close();
  }
});

test('a token the relay turns down is replaced with one that says what counts are now', async () => {
  const r = await relay(),
    s = await scratch(),
    previous = { telemetry: process.env.PROOFMARKS_TELEMETRY, home: process.env.HOME },
    bodies: { telemetry?: boolean }[] = [];
  process.env.HOME = path.dirname(s.file);
  // A saved token from counts-on days that the relay no longer accepts; counts are off by the time it's refused.
  await writeFile(s.file, JSON.stringify({ token: 'not-a-relay-token', relay: r.url, telemetry: true }));
  const request = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/v1/install')) bodies.push(JSON.parse(String(init?.body)));
    return fetch(url, init);
  }) as typeof fetch;
  let asked = 0;
  try {
    process.env.PROOFMARKS_TELEMETRY = '1';
    setOwnersOff(() => asked++ > 0);
    const provider = createRelayJev({ relay: r.url, version: '0.1.0', route: 'npm', file: s.file, request });
    await provider.judge({ target: 'A passage.' }, [question]);
    assert.deepEqual(bodies, [{ telemetry: false }], 'the new token is asked for with counts off');
  } finally {
    setOwnersOff(() => false);
    if (previous.telemetry === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous.telemetry;
    process.env.HOME = previous.home;
    r.close();
    await s.close();
  }
});

test("a helper shared by several processes counts nothing while any owner's environment turns counts off", async () => {
  const s = await scratch(),
    file = path.join(path.dirname(s.file), 'telemetry.json');
  try {
    assert.equal(envTurnsOff({ DO_NOT_TRACK: '1' }), true);
    assert.equal(envTurnsOff({ PROOFMARKS_TELEMETRY: '0' }), true);
    assert.equal(envTurnsOff({ CI: 'true' }), true);
    assert.equal(envTurnsOff({ CI: 'true', PROOFMARKS_TELEMETRY: '1' }), false);
    assert.equal(envTurnsOff({}), false);
    await saveTelemetry(true, file);
    let off = true;
    setOwnersOff(() => off);
    assert.deepEqual(telemetryState({}, file), { on: false, by: 'owner' });
    off = false;
    assert.deepEqual(telemetryState({}, file), { on: true, by: 'saved' });
  } finally {
    setOwnersOff(() => false);
    await s.close();
  }
});
