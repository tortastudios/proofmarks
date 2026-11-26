export type Question = { id: string; kind: 'yes-no'; ask: string; yes?: string; no?: string };
export type JudgeInput = { target: string; context?: string };
export type Answer = { id: string; probability: number; confidence?: number };
export type JudgeResult = {
  answers: Answer[];
  provider: string;
  model: string;
  latencyMs: number;
  cached: boolean;
  usage: { calls: number; inputTokens?: number; dollars: number };
};
export interface JudgeProvider {
  id: string;
  model: string;
  capabilities: { maxQuestionsPerCall: number; pricing: 'per-token' | 'per-call' };
  judge(input: JudgeInput, questions: Question[], opts?: { signal?: AbortSignal }): Promise<JudgeResult>;
}
