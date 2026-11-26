// Records Jev's answers for the labeled set (rules/labeled) into the recording the offline tests replay
// (rules/calibration/jev-jev-1.14.0.replay.json): the mean of three runs for each target, context and question.
//
//   TYPESAFE_API_KEY=... pnpm exec tsx scripts/record-judge.mts [--rules contrast,generic-voice]
//
// Without --rules it asks only questions not yet recorded, as after adding a passage. With --rules it asks those rules
// again everywhere, as after changing their questions. Answers no passage asks for any more are dropped. It then prints
// each rule's scores on the planted problems and on human writing, to set its threshold in jev-jev-1.14.0.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze, questionId } from '../src/detect/detect.ts';
import type { JudgeInput, JudgeProvider, Question } from '../src/detect/judge-contract.ts';
import { labeledSet, passageDoc, plantCaught } from '../src/detect/labeled.ts';
import { loadRegistry } from '../src/detect/registry.ts';
import { replayKey } from '../src/detect/replay.ts';
import { createJev } from '../src/judge/jev.ts';
import type { Doc } from '../src/detect/types.ts';

const root = new URL('../rules/', import.meta.url);
const replayFile = new URL('calibration/jev-jev-1.14.0.replay.json', root);
const calibrationFile = new URL('calibration/jev-jev-1.14.0.json', root);
const manifestFile = new URL('labeled/MANIFEST.json', root);
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('Set TYPESAFE_API_KEY to record Jev answers.');
const rulesArgument = process.argv.indexOf('--rules');
const again = new Set(rulesArgument > 0 ? process.argv[rulesArgument + 1]!.split(',') : []);

const replay = JSON.parse(readFileSync(replayFile, 'utf8')) as {
  labeledSetHash: string;
  answers: Record<string, number>;
};
const registry = loadRegistry(),
  set = labeledSet();
const docs: Doc[] = [...set.planted.map(passageDoc), ...set.human.map(passageDoc), ...set.real];
// Every rule is recorded, including those a project turns on.
const everyRule = { rules: registry.rules.map(r => r.id) };
const ruleOf = (id: string) => registry.rules.find(r => questionId({ rule: r.id }) === id.split('__')[0])?.id;

// Every question the set asks, and which of them to ask Jev now.
const needed = new Map<string, { input: JudgeInput; question: Question }>();
const collector: JudgeProvider = {
  id: 'jev',
  model: 'jev-1.14.0',
  capabilities: { maxQuestionsPerCall: 32, pricing: 'per-token' },
  async judge(input, questions) {
    for (const question of questions) needed.set(replayKey(input, question.id), { input, question });
    return {
      answers: questions.map(q => ({ id: q.id, probability: 0 })),
      provider: 'jev',
      model: 'jev-1.14.0',
      latencyMs: 0,
      cached: true,
      usage: { calls: 0, dollars: 0 },
    };
  },
};
for (const doc of docs) await analyze(doc, registry, collector, everyRule);
const ask = [...needed].filter(
  ([k, { question }]) => replay.answers[k] === undefined || again.has(ruleOf(question.id) ?? ''),
);
console.log(`${needed.size} questions in the set; asking Jev ${ask.length} of them, three times each`);

// Questions about one target share a call, as in detection.
const jev = createJev(key),
  fresh: Record<string, number> = {};
const groups = new Map<string, { input: JudgeInput; questions: Question[] }>();
for (const [, { input, question }] of ask) {
  const group = groups.get(JSON.stringify(input)) ?? { input, questions: [] };
  group.questions.push(question);
  groups.set(JSON.stringify(input), group);
}
let done = 0;
for (const { input, questions } of groups.values()) {
  const runs = await Promise.all([0, 1, 2].map(() => jev.judge(input, questions)));
  for (const q of questions) {
    const values = runs.map(r => r.answers.find(a => a.id === q.id)!.probability);
    fresh[replayKey(input, q.id)] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1e6) / 1e6;
  }
  if (++done % 20 === 0) console.log(`  ${done} of ${groups.size} targets`);
}
const answers = Object.fromEntries(
  Object.entries({ ...replay.answers, ...fresh })
    .filter(([k]) => needed.has(k))
    .sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(replayFile, JSON.stringify({ ...replay, labeledSetHash: set.hash, answers }) + '\n');
for (const file of [calibrationFile, manifestFile]) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  value[file === manifestFile ? 'hash' : 'labeledSetHash'] = set.hash;
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
console.log(`recorded ${Object.keys(fresh).length} answers; the recording now holds ${Object.keys(answers).length}`);

// Each rule's scores: the planted problems it should catch (fit and holdout), and the most it scores on human writing.
const recorded: JudgeProvider = {
  ...collector,
  async judge(input, questions) {
    return {
      ...(await collector.judge(input, questions)),
      answers: questions.map(q => ({ id: q.id, probability: answers[replayKey(input, q.id)] ?? 0 })),
    };
  },
};
const report = new Map<string, { fit: number[]; holdout: number[]; human: number[] }>();
const entry = (rule: string) => {
  let scores = report.get(rule);
  if (!scores) {
    scores = { fit: [], holdout: [], human: [] };
    report.set(rule, scores);
  }
  return scores;
};
for (const passage of set.planted) {
  const { candidates } = await analyze(passageDoc(passage), registry, recorded, everyRule);
  for (const plant of passage.plants)
    for (const rule of plant.rules) {
      const scores = candidates
        .filter(c => c.rule === rule && plantCaught(passage, plant, [{ rule, level: c.level, span: c }]))
        .map(c => c.probability ?? 0);
      if (scores.length) entry(rule)[passage.split].push(Math.max(...scores));
    }
}
for (const doc of [...set.human.map(passageDoc), ...set.real]) {
  const { candidates } = await analyze(doc, registry, recorded, everyRule);
  for (const c of candidates) if (c.probability !== undefined) entry(c.rule).human.push(c.probability);
}
const fmt = (values: number[]) =>
  values
    .sort((a, b) => a - b)
    .map(v => v.toFixed(2))
    .join(' ') || '-';
for (const rule of again.size ? [...again] : [...report.keys()]) {
  const r = report.get(rule);
  if (r)
    console.log(
      `\n${rule}\n  planted, fit:     ${fmt(r.fit)}\n  planted, holdout: ${fmt(r.holdout)}\n  human writing, top 8: ${fmt(r.human.sort((a, b) => b - a).slice(0, 8))}`,
    );
}
