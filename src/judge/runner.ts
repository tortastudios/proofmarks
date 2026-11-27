import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { JudgeInput, JudgeProvider, JudgeResult, Question } from './types';
import { sanitizedError, PRICE_PER_MILLION } from './jev';
import { calibrate, type Calibration } from './calibration';
export type RunnerOptions = {
  cacheDir: string;
  rulesVersion: string;
  concurrency?: number;
  repeats?: number;
  replicateOffset?: number;
  calibration?: Calibration;
  signal?: AbortSignal;
  onEstimate?: (estimate: { calls: number; dollars: number }) => void;
};
export async function runJudge(
  provider: JudgeProvider,
  input: JudgeInput,
  questions: Question[],
  options: RunnerOptions,
) {
  const limit = provider.capabilities.maxQuestionsPerCall;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid question limit');
  if (new Set(questions.map(q => q.id)).size !== questions.length) throw new Error('Duplicate question id');
  const jobs: { questions: Question[]; repeat: number }[] = [];
  const repeatCount = (q: Question) => options.calibration?.rules[q.id]?.repeats ?? options.repeats ?? 1;
  const repeats = Math.max(1, ...questions.map(repeatCount));
  if (!Number.isInteger(repeats) || repeats > 20) throw new Error('Invalid repeat count');
  for (let repeat = 0; repeat < repeats; repeat++) {
    const active = questions.filter(q => repeat < repeatCount(q));
    for (let i = 0; i < active.length; i += limit)
      jobs.push({ questions: active.slice(i, i + limit), repeat: repeat + (options.replicateOffset ?? 0) });
  }
  const estimate = {
    calls: jobs.length,
    dollars: jobs.length * (provider.capabilities.pricing === 'per-call' ? 0.001 : (65536 * PRICE_PER_MILLION) / 1e6),
  };
  options.onEstimate?.(estimate);
  // The cache only saves calls, so a review goes ahead without it where it can't be written, as in an agent's sandbox.
  const kept = (write: Promise<unknown>) => write.catch(() => {});
  await kept(mkdir(options.cacheDir, { recursive: true, mode: 0o700 }));
  const results: JudgeResult[] = new Array(jobs.length);
  let next = 0;
  const concurrency = Math.max(1, Math.min(16, options.concurrency ?? 4));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        options.signal?.throwIfAborted();
        const index = next++,
          job = jobs[index]!;
        const key = createHash('sha256')
          .update(
            JSON.stringify({
              provider: provider.id,
              model: provider.model,
              rulesVersion: options.rulesVersion,
              input,
              ...job,
            }),
          )
          .digest('hex');
        const file = path.join(options.cacheDir, key + '.json');
        let result: JudgeResult | undefined;
        try {
          result = JSON.parse(await readFile(file, 'utf8')) as JudgeResult;
        } catch (error) {
          // A file that can't be read is a miss; one that isn't JSON is a broken cache.
          if (!(error as NodeJS.ErrnoException).code) throw new Error('Invalid judge cache');
        }
        if (result) {
          result = { ...result, cached: true, usage: { calls: 0, dollars: 0 } };
        } else {
          try {
            const raw = await provider.judge(input, job.questions, { signal: options.signal });
            // Explicit projection: provider payloads, error bodies and credentials never reach disk.
            const answers = job.questions.map(q => {
              const probability = raw.answers.find(a => a.id === q.id)?.probability;
              if (
                typeof probability !== 'number' ||
                !Number.isFinite(probability) ||
                probability < 0 ||
                probability > 1
              )
                throw new Error('Invalid answer');
              return { id: q.id, probability };
            });
            if (!Number.isFinite(raw.usage.dollars) || raw.usage.dollars < 0) throw new Error('Invalid usage');
            result = {
              answers,
              provider: provider.id,
              model: provider.model,
              latencyMs: raw.latencyMs,
              cached: false,
              usage: {
                calls: raw.usage.calls,
                dollars: raw.usage.dollars,
                ...(raw.usage.inputTokens === undefined ? {} : { inputTokens: raw.usage.inputTokens }),
              },
            };
            await kept(writeFile(file, JSON.stringify(result), { mode: 0o600 }));
          } catch (error) {
            await kept(
              appendFile(
                path.join(options.cacheDir, 'ledger.jsonl'),
                JSON.stringify({ key, status: 'failed', unknownUsage: true }) + '\n',
                { mode: 0o600 },
              ),
            );
            throw sanitizedError(error);
          }
        }
        results[index] = result;
        await kept(
          appendFile(
            path.join(options.cacheDir, 'ledger.jsonl'),
            JSON.stringify({ key, cached: result.cached, ...result.usage }) + '\n',
            { mode: 0o600 },
          ),
        );
      }
    }),
  );
  const answers = questions.map(q => ({
    id: q.id,
    ...calibrate(
      results.flatMap(r => r.answers.filter(a => a.id === q.id).map(a => a.probability)),
      options.calibration?.rules[q.id],
    ),
  }));
  const ledger = results.reduce(
    (sum, r) => ({
      calls: sum.calls + r.usage.calls,
      dollars: sum.dollars + r.usage.dollars,
      cached: sum.cached + Number(r.cached),
    }),
    { calls: 0, dollars: 0, cached: 0 },
  );
  return { answers, estimate, ledger, results };
}
