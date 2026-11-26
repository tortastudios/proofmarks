import { TypeSafeClient, type SystemOneRequest } from '@typesafe-ai/sdk';
import { setTimeout as delay } from 'node:timers/promises';
import type { JudgeInput, JudgeProvider, JudgeResult, Question } from './types';
export const MODEL = 'jev-1.14.0';
export const PRICE_PER_MILLION = 0.042;
// Never trust an SDK error name: a provider can put request data in it.
export function sanitizedError(error: unknown): Error {
  const value = error as { status?: unknown; name?: unknown } | null;
  const status = typeof value?.status === 'number' && Number.isInteger(value.status) ? value.status : 'unknown';
  const name = ['AbortError', 'APIUserAbortError', 'RateLimitError', 'AuthenticationError', 'APIError'].includes(
    String(value?.name),
  )
    ? String(value?.name)
    : 'ProviderError';
  // A plain sentence for people, then the code for bug reports; never the provider's own message, which can carry detail.
  const what =
    name === 'RateLimitError' || status === 429
      ? 'Jev is busy right now'
      : name === 'AuthenticationError' || status === 401
        ? 'Jev refused the key'
        : name === 'AbortError' || name === 'APIUserAbortError'
          ? 'The judge was stopped'
          : "Jev didn't answer";
  return new Error(`${what}. Try again in a moment. (Judge failed: status=${status} name=${name})`);
}
export function jevRequest(input: JudgeInput, questions: Question[]): SystemOneRequest {
  return {
    model: MODEL,
    state: { target: input.target, ...(input.context ? { context: input.context } : {}) },
    questions: Object.fromEntries(
      questions.map(q => [
        q.id,
        {
          type: 'noul' as const,
          instructions: q.ask,
          ...(q.yes || q.no ? { criteria: { true: q.yes ?? '', false: q.no ?? '' } } : {}),
        },
      ]),
    ),
  };
}
type Client = Pick<TypeSafeClient, 'systemOne'>;
/**
 * baseURL is Jev's own API for a person's own key, or Torta's relay with an install token (see relay.ts). The relay's
 * key is a function, asked again before every attempt, retries included, so a choice about usage counts made during a
 * retry's wait holds for the retry.
 */
export function createJev(
  apiKey: string | ((signal?: AbortSignal) => Promise<string>),
  client?: Client,
  baseURL = 'https://api.typesafe.ai',
): JudgeProvider {
  const key = typeof apiKey === 'string' ? async () => apiKey : apiKey;
  let current: { key: string; sdk: Client } | undefined;
  const sdkFor = (apiKey: string) => {
    if (client) return client;
    if (current?.key !== apiKey)
      current = {
        key: apiKey,
        sdk: new TypeSafeClient({ apiKey, baseURL, logLevel: 'off', timeout: 20000, retry: { maxRetries: 0 } }),
      };
    return current.sdk;
  };
  return {
    id: 'jev',
    model: MODEL,
    capabilities: { maxQuestionsPerCall: 32, pricing: 'per-token' },
    async judge(input, questions, opts): Promise<JudgeResult> {
      const start = performance.now();
      let calls = 0;
      for (;;) {
        const sdk = sdkFor(await key(opts?.signal));
        try {
          opts?.signal?.throwIfAborted();
          calls++;
          const response = await sdk.systemOne(jevRequest(input, questions), { signal: opts?.signal });
          const inputTokens = response.usage?.input_tokens;
          if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens)) throw new Error('Missing usage');
          const answers = questions.map(q => {
            const probability = (response.answers[q.id] as { noul?: number } | undefined)?.noul;
            if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1)
              throw new Error('Invalid probability');
            return { id: q.id, probability };
          });
          return {
            answers,
            provider: 'jev',
            model: MODEL,
            latencyMs: performance.now() - start,
            cached: false,
            usage: { calls, inputTokens, dollars: (inputTokens * PRICE_PER_MILLION) / 1e6 },
          };
        } catch (error) {
          const e = error as {
            status?: number;
            retryAfterMs?: number;
            headers?: { get?: (name: string) => string | null };
          };
          // A dropped connection, a timeout, a server error or a malformed answer is usually gone a moment later: one
          // quiet retry. Refusals (4xx) and cancellations fail at once.
          const name = (error as { name?: string }).name;
          const transient =
            (e.status === undefined || e.status >= 500) && name !== 'AbortError' && name !== 'APIUserAbortError';
          if (transient && calls < 2 && !opts?.signal?.aborted) {
            await delay(500, undefined, { signal: opts?.signal }).catch(() => {
              throw sanitizedError({ name: 'AbortError' });
            });
            continue;
          }
          if (e.status === 429 && calls < 4 && !opts?.signal?.aborted) {
            const header = e.headers?.get?.('retry-after');
            const retry = header
              ? Number.isFinite(Number(header))
                ? Number(header) * 1000
                : Date.parse(header) - Date.now()
              : undefined;
            await delay(Math.max(0, e.retryAfterMs ?? retry ?? 1000 * 2 ** (calls - 1)), undefined, {
              signal: opts?.signal,
            }).catch(() => {
              throw sanitizedError({ name: 'AbortError' });
            });
            continue;
          }
          throw sanitizedError(error);
        }
      }
    },
  };
}
