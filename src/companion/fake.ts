import type { JudgeProvider } from '../judge/types';
export const fakeProvider: JudgeProvider = {
  id: 'fake',
  model: 'fixture-1',
  capabilities: { maxQuestionsPerCall: 32, pricing: 'per-call' },
  async judge(_input, questions, opts) {
    opts?.signal?.throwIfAborted();
    return {
      provider: 'fake',
      model: 'fixture-1',
      answers: questions.map(q => ({ id: q.id, probability: 0.95 })),
      cached: false,
      latencyMs: 0,
      usage: { calls: 1, dollars: 0 },
    };
  },
};
