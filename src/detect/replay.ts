// A recorded judge for offline tests: answers come from a replay file written by the calibration harness.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { JudgeInput, JudgeProvider } from './judge-contract';
import { rulesDir } from './registry';

export const replayKey = (input: JudgeInput, questionId: string) =>
  createHash('sha256')
    .update(JSON.stringify([input.target, input.context ?? '', questionId]))
    .digest('hex')
    .slice(0, 20);

/** Replays recorded probabilities; an unrecorded question means detection changed since calibration, so it throws. */
export function replayJudge(file = new URL('calibration/jev-jev-1.14.0.replay.json', rulesDir)) {
  const recording = JSON.parse(readFileSync(file, 'utf8')) as {
    provider: string;
    model: string;
    labeledSetHash: string;
    answers: Record<string, number>;
  };
  const judge: JudgeProvider = {
    id: recording.provider,
    model: recording.model,
    capabilities: { maxQuestionsPerCall: 32, pricing: 'per-token' },
    async judge(input, questions) {
      const answers = questions.map(q => {
        const probability = recording.answers[replayKey(input, q.id)];
        if (probability === undefined)
          throw new Error(`No recorded answer for ${q.id} on "${input.target.slice(0, 60)}"; rerun calibration.`);
        return { id: q.id, probability };
      });
      return {
        answers,
        provider: recording.provider,
        model: recording.model,
        latencyMs: 0,
        cached: true,
        usage: { calls: 0, dollars: 0 },
      };
    },
  };
  return { judge, labeledSetHash: recording.labeledSetHash };
}
