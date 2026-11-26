import { compareSourcePosition } from '../finding-order';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import type { JudgeProvider } from '../judge/types';
import type { Calibration, Doc, Finding, Registry } from '../detect/types';
import { runJudge, type RunnerOptions } from '../judge/runner';
import { loadCalibration } from '../judge/calibration';
import { decided, moved, type Strictness } from './strictness';
import { ConfigError } from '../config/index';
type Detect = (
  doc: Doc,
  registry: Registry,
  judge: JudgeProvider,
  calibration: Calibration,
  options?: { signal?: AbortSignal; concurrency?: number; rules?: string[] },
) => Finding[] | Promise<Finding[]>;
export async function registeredReview(
  detect: Detect,
  text: string,
  source: string,
  provider: JudgeProvider,
  options: {
    cacheDir?: string;
    signal?: AbortSignal;
    onEstimate?: RunnerOptions['onEstimate'];
    kind?: 'mdx' | 'text';
    /** This site's line for each rule, given the calibrated ones. */
    strictness?: (bases: Record<string, number>) => Promise<Strictness[]>;
    /** Rules the project turned on or off in proofmarks.config.json; the rest keep their defaults. */
    rules?: Record<string, boolean>;
  },
) {
  const registry = JSON.parse(
    await readFile(new URL('../../rules/rules.v3.json', import.meta.url), 'utf8'),
  ) as Registry;
  let calibration: Calibration;
  let reviewMode = provider.id === 'fake' ? 'fixture' : 'calibrated';
  try {
    const loaded = await loadCalibration(provider.id, provider.model);
    const raw = JSON.parse(
      await readFile(new URL(`../../rules/calibration/${provider.id}-${provider.model}.json`, import.meta.url), 'utf8'),
    ) as Calibration;
    if (raw.rulesVersion !== registry.version) throw new Error('Calibration rules version mismatch');
    calibration = {
      ...raw,
      rules: Object.fromEntries(
        Object.entries(loaded.rules).map(([id, value]) => [id, { ...value, band: value.reviewBand }]),
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // An uncalibrated real provider can only suggest; it cannot confirm a mark.
    if (provider.id !== 'fake') reviewMode = 'suggest-only';
    calibration = {
      provider: provider.id,
      model: provider.model,
      rulesVersion: registry.version,
      labeledSetHash: 'uncalibrated',
      fitted: 'November 5, 2026',
      rules: Object.fromEntries(
        registry.rules.map(rule => [
          rule.id,
          { threshold: provider.id === 'fake' ? 0.8 : 0, band: [0, 1] as [number, number], repeats: 1 },
        ]),
      ),
    };
  }
  // A site's learned lines replace the calibrated ones. An uncalibrated provider has no line to move.
  const lines =
    options.strictness && reviewMode !== 'suggest-only'
      ? await options.strictness(
          Object.fromEntries(Object.entries(calibration.rules).map(([id, value]) => [id, value.threshold])),
        )
      : [];
  for (const entry of moved(lines))
    calibration.rules[entry.rule] = { ...calibration.rules[entry.rule]!, threshold: entry.line };
  const usage = { calls: 0, dollars: 0, cached: 0 };
  const slots = new Map<string, number>();
  let active = 0;
  const waiting: (() => void)[] = [];
  const bounded: JudgeProvider = {
    ...provider,
    async judge(input, questions, opts) {
      opts?.signal?.throwIfAborted();
      if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve));
      else active++;
      try {
        opts?.signal?.throwIfAborted();
        return await provider.judge(input, questions, opts);
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    },
  };
  const judged: JudgeProvider = {
    ...provider,
    async judge(input, questions, opts) {
      const key = createHash('sha256').update(JSON.stringify({ input, questions })).digest('hex');
      const replicateOffset = slots.get(key) ?? 0;
      slots.set(key, replicateOffset + 1);
      const started = performance.now();
      const result = await runJudge(bounded, input, questions, {
        cacheDir: options.cacheDir ?? path.join(homedir(), '.proofmarks/cache'),
        rulesVersion: registry.version,
        signal: opts?.signal ?? options.signal,
        onEstimate: options.onEstimate,
        replicateOffset,
      });
      usage.calls += result.ledger.calls;
      usage.dollars += result.ledger.dollars;
      usage.cached += result.ledger.cached;
      return {
        answers: result.answers.map(({ id, probability }) => ({ id, probability })),
        provider: provider.id,
        model: provider.model,
        latencyMs: performance.now() - started,
        cached: result.results.every(r => r.cached),
        usage: {
          calls: result.ledger.calls,
          dollars: result.ledger.dollars,
          inputTokens: result.results.reduce((sum, r) => sum + (r.usage.inputTokens ?? 0), 0),
        },
      };
    },
  };
  const findings = (
    await detect(
      { id: path.basename(source, path.extname(source)), kind: options.kind ?? 'mdx', source: text },
      registry,
      judged,
      calibration,
      { signal: options.signal, concurrency: 4, rules: enabledRules(registry, options.rules) },
    )
  ).sort(compareSourcePosition);
  return {
    source,
    usage,
    reviewMode,
    strictness: decided(lines),
    rules: registry.rules.map(rule => ({
      id: rule.id,
      label: rule.label,
      color: rule.color ?? '#87532f',
      mark: rule.mark ?? 'underline',
      rubric: { checks: rule.why, looksLike: '', notLike: '', fix: rule.fix },
    })),
    findings: findings.map(({ judge, ...finding }) => ({
      ...finding,
      ...(reviewMode === 'suggest-only'
        ? { severity: 'warning', note: 'Uncalibrated suggestion. ' + finding.note }
        : {}),
      ...(judge
        ? {
            judge: {
              ...judge,
              score: judge.probability,
              candidate: finding.match,
              scope: finding.level === 'word' ? 'phrase' : 'sentence',
            },
          }
        : {}),
    })),
    judge: {
      provider: provider.id,
      model: provider.model,
      rulesVersion: registry.version,
      generatedAt: new Date().toISOString(),
    },
  };
}

/** The rules a review runs: each rule's default, unless the project's config turns it on or off. */
export function enabledRules(registry: Registry, choices: Record<string, boolean> = {}) {
  const unknown = Object.keys(choices).filter(id => !registry.rules.some(rule => rule.id === id));
  if (unknown.length)
    throw new ConfigError(
      `proofmarks.config.json turns on or off rules that don't exist: ${unknown.join(', ')}. See docs/configuration.md for the rule names.`,
    );
  return registry.rules.filter(rule => choices[rule.id] ?? rule.default).map(rule => rule.id);
}
