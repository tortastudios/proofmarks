import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { jevRequest, createJev, sanitizedError } from './jev';
import { calibrate, average } from './calibration';
import { runJudge } from './runner';
import type { JudgeProvider, Question } from './types';
const q: Question = { id: 'contrast', kind: 'yes-no', ask: 'Contrast?', yes: 'yes', no: 'no' };
const work = new URL('../../.test-work/', import.meta.url);
async function scratch() {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(work, { recursive: true });
  return mkdtemp(new URL('run-', work).pathname);
}
test('neutral questions map to pinned Jev noul', () => {
  assert.deepEqual(jevRequest({ target: 'text', context: 'paragraph' }, [q]), {
    model: 'jev-1.14.0',
    state: { target: 'text', context: 'paragraph' },
    questions: { contrast: { type: 'noul', instructions: 'Contrast?', criteria: { true: 'yes', false: 'no' } } },
  });
});
test('averaging, thresholds, review bands and missing calibration', () => {
  assert.ok(Math.abs(average([0.7, 0.8, 0.9]) - 0.8) < 1e-12);
  assert.equal(calibrate([0.9], { threshold: 0.8, reviewBand: [0.75, 0.85], repeats: 3 }).decision, 'flag');
  assert.equal(calibrate([0.8], { threshold: 0.8, reviewBand: [0.75, 0.85], repeats: 3 }).decision, 'review');
  assert.equal(calibrate([0.3], { threshold: 0.8, reviewBand: [0.75, 0.85], repeats: 3 }).decision, 'clear');
  assert.equal(calibrate([0.99]).decision, 'review');
  assert.throws(() => average([]));
});
test('packing, bounded concurrency, repeat averaging, versioned cache and ledger', async () => {
  const cacheDir = await scratch();
  let calls = 0,
    active = 0,
    peak = 0;
  const provider: JudgeProvider = {
    id: 'fake',
    model: 'one',
    capabilities: { maxQuestionsPerCall: 2, pricing: 'per-call' },
    async judge(_input, questions) {
      calls++;
      active++;
      peak = Math.max(peak, active);
      assert.ok(questions.length <= 2);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return {
        answers: questions.map(question => ({ id: question.id, probability: 0.9 })),
        provider: 'fake',
        model: 'one',
        cached: false,
        latencyMs: 5,
        usage: { calls: 1, dollars: 0.001 },
      };
    },
  };
  try {
    let estimated = false;
    const questions = Array.from({ length: 5 }, (_, i) => ({ ...q, id: String(i) }));
    const options = {
      cacheDir,
      rulesVersion: '3',
      repeats: 2,
      concurrency: 2,
      onEstimate: () => {
        assert.equal(calls, 0);
        estimated = true;
      },
    };
    const first = await runJudge(provider, { target: 'text' }, questions, options);
    assert.ok(estimated);
    assert.equal(calls, 6);
    assert.equal(peak, 2);
    assert.equal(first.ledger.calls, 6);
    assert.equal(first.ledger.dollars, 0.006);
    assert.equal(first.answers[0]?.probability, 0.9);
    const second = await runJudge(provider, { target: 'text' }, questions, { ...options, onEstimate: undefined });
    assert.equal(calls, 6);
    assert.equal(second.ledger.cached, 6);
    assert.equal(second.ledger.dollars, 0);
    await runJudge(provider, { target: 'text' }, questions, { ...options, rulesVersion: '4', onEstimate: undefined });
    assert.equal(calls, 12);
    const ledger = (await readFile(path.join(cacheDir, 'ledger.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(ledger.length, 18);
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});
test('fake credential never survives error sanitization, logs, cache or results', async () => {
  const secret = 'FAKE-CREDENTIAL-MUST-NOT-LEAK';
  const cacheDir = await scratch();
  const provider: JudgeProvider = {
    id: 'fake',
    model: 'one',
    capabilities: { maxQuestionsPerCall: 2, pricing: 'per-call' },
    async judge() {
      throw Object.assign(new Error(secret), { status: 401, name: secret, headers: { authorization: secret } });
    },
  };
  const logged: string[] = [];
  const methods = ['error', 'log', 'warn', 'info', 'debug'] as const;
  const originals = methods.map(method => console[method]);
  for (const method of methods)
    console[method] = (...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    };
  try {
    assert.ok(!sanitizedError({ name: secret, message: secret }).message.includes(secret));
    await assert.rejects(
      runJudge(provider, { target: 'text' }, [q], { cacheDir, rulesVersion: '3' }),
      error => !String(error).includes(secret),
    );
    for (const file of await readdir(cacheDir))
      assert.ok(!(await readFile(path.join(cacheDir, file), 'utf8')).includes(secret));
    assert.ok(!logged.join('').includes(secret));
  } finally {
    methods.forEach((method, index) => {
      console[method] = originals[index]!;
    });
    await rm(cacheDir, { recursive: true });
  }
});
test('Jev mock retry, cost and abort without live network', async () => {
  let calls = 0;
  const client = {
    async systemOne() {
      calls++;
      if (calls === 1) throw { status: 429, retryAfterMs: 0 };
      return { answers: { contrast: { noul: 0.9 } }, usage: { input_tokens: 100, output_tokens: 0 } };
    },
  };
  const provider = createJev('FAKE', client as unknown as Parameters<typeof createJev>[1]);
  const result = await provider.judge({ target: 'text' }, [q]);
  assert.equal(calls, 2);
  assert.equal(result.usage.dollars, (100 * 0.042) / 1e6);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.judge({ target: 'text' }, [q], { signal: controller.signal }));
  assert.equal(calls, 2);
});
test('calibration loads provider/model file and rejects unsafe identifiers', async () => {
  const { loadCalibration } = await import('./calibration');
  const { writeFile } = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const dir = await scratch();
  try {
    await writeFile(
      path.join(dir, 'fake-one.json'),
      JSON.stringify({
        rulesVersion: '3',
        rules: { contrast: { threshold: 0.8, reviewBand: [0.75, 0.85], repeats: 3 } },
      }),
    );
    assert.equal((await loadCalibration('fake', 'one', pathToFileURL(dir + path.sep))).rules.contrast?.repeats, 3);
    await assert.rejects(loadCalibration('../fake', 'one', pathToFileURL(dir + path.sep)));
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('runner projects successful provider results before persistence', async () => {
  const secret = 'FAKE-CREDENTIAL-MUST-NOT-LEAK';
  const cacheDir = await scratch();
  const provider: JudgeProvider = {
    id: 'fake',
    model: 'one',
    capabilities: { maxQuestionsPerCall: 2, pricing: 'per-call' },
    async judge() {
      return {
        answers: [{ id: q.id, probability: 0.9, privateKey: secret }],
        provider: secret,
        model: secret,
        cached: false,
        latencyMs: 1,
        usage: { calls: 1, dollars: 0 },
        authorization: secret,
      };
    },
  };
  try {
    const result = await runJudge(provider, { target: 'text' }, [q], { cacheDir, rulesVersion: '3' });
    assert.ok(!JSON.stringify(result).includes(secret));
    for (const file of await readdir(cacheDir))
      assert.ok(!(await readFile(path.join(cacheDir, file), 'utf8')).includes(secret));
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});
test('aborted runner never calls provider', async () => {
  const cacheDir = await scratch();
  const controller = new AbortController();
  controller.abort();
  const provider: JudgeProvider = {
    id: 'fake',
    model: 'one',
    capabilities: { maxQuestionsPerCall: 2, pricing: 'per-call' },
    async judge() {
      assert.fail('Provider must not be called');
    },
  };
  try {
    await assert.rejects(
      runJudge(provider, { target: 'text' }, [q], { cacheDir, rulesVersion: '3', signal: controller.signal }),
    );
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});

test('a dropped connection or server error gets one quiet retry; refusals fail at once, in a plain sentence', async () => {
  const answer = { answers: { q: { noul: 0.6 } }, usage: { input_tokens: 100 } };
  const question = { id: 'q', kind: 'yes-no' as const, ask: 'Is it padded?' };
  const flaky = (failures: unknown[]) => {
    let calls = 0;
    return {
      client: {
        systemOne: async () => {
          const failure = failures[calls++];
          if (failure) throw failure;
          return answer;
        },
      } as never,
      calls: () => calls,
    };
  };
  for (const failure of [{ status: 502 }, Object.assign(new Error('socket hang up'), { name: 'APIConnectionError' })]) {
    const once = flaky([failure]);
    const result = await createJev('k', once.client).judge({ target: 'A passage.' }, [question]);
    assert.equal(result.answers[0]!.probability, 0.6);
    assert.equal(once.calls(), 2, 'retried once');
  }
  const twice = flaky([{ status: 502 }, { status: 502 }]);
  await assert.rejects(
    createJev('k', twice.client).judge({ target: 'A passage.' }, [question]),
    /^Error: Jev didn't answer\. Try again in a moment\. \(Judge failed: status=502 name=ProviderError\)$/,
  );
  assert.equal(twice.calls(), 2, 'only one retry');
  const refused = flaky([{ status: 401, name: 'AuthenticationError' }]);
  await assert.rejects(
    createJev('k', refused.client).judge({ target: 'A passage.' }, [question]),
    /Jev refused the key/,
  );
  assert.equal(refused.calls(), 1, 'a refusal is not retried');
});
