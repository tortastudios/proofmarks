// Detection: candidates from lexicons, patterns and judge units; one batched judge call per target; calibrated decisions.
import type { JudgeProvider, Question } from './judge-contract';
import { compileLexicon, lexiconHits, type CompiledLexicon } from './lexicon';
import { PATTERNS } from './patterns';
import { bodyStart, project, sentences, sourceSpan, wordCount, type Block, type Sentence } from './segment';
import type { Calibration, Candidate, Doc, Finding, Registry, Rule } from './types';

export const PREAMBLE = 'Evaluate only the target; the context, when given, is background. ';
/** Used only when a rule has no calibration entry. Lexicon thresholds are veto floors. */
export const DEFAULT_THRESHOLDS = { lexicon: 0.2, pattern: 0.6, judge: 0.7 } as const;
const HEADING_PATTERNS = new Set(['title-case', 'bold', 'em-dash']);

export type AnalyzeOptions = {
  /** Rule ids to run; defaults to every rule that is on by default. */
  rules?: string[];
  /** Judge calls per question, averaged; a number or a per-rule lookup. */
  repeats?: number | ((rule: string) => number);
  concurrency?: number;
  signal?: AbortSignal;
};

const fill = (text: string, term?: string) => (term ? text.replaceAll('{term}', term) : text);
const fold = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ');
/** Identifier-safe question ids: one per rule, or one per rule and lexicon term. */
const slug = (s: string) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
export const questionId = (c: Pick<Candidate, 'rule' | 'term'>) => slug(c.rule) + (c.term ? `__${slug(c.term)}` : '');

function candidatesFor(doc: Doc, rule: Rule, block: Block, sents: Sentence[], compiled?: CompiledLexicon) {
  const out: Candidate[] = [];
  const prose = block.kind !== 'heading';
  const context = rule.judge?.context === 'paragraph' ? block.text : undefined;
  const span = (a: number, b: number) => sourceSpan(block, a, b, doc.source);
  const exact = (a: number, b: number) => ({ start: block.map[a]!, end: block.map[b - 1]! + 1 });
  const sentenceAt = (at: number) =>
    sents.find(s => at >= s.start && at < s.end) ?? { start: 0, end: block.text.length, text: block.text };
  const { detector } = rule;
  if (detector.kind === 'lexicon') {
    if (rule.level !== 'word' && !prose) return out;
    for (const hit of lexiconHits(block.text, compiled!)) {
      const s = sentenceAt(hit.start);
      if (hit.term.start && block.text.slice(s.start, hit.start).replace(/["“‘'(\s]/g, '')) continue;
      const focus = exact(hit.start, hit.end);
      const marked = rule.level === 'word' ? focus : span(s.start, s.end);
      out.push({
        rule: rule.id,
        level: rule.level,
        ...marked,
        focus: rule.level === 'word' ? undefined : focus,
        term: hit.text,
        plain: hit.term.plain,
        target: s.text,
        context,
      });
    }
  } else if (detector.kind === 'pattern') {
    if (!prose && !HEADING_PATTERNS.has(detector.pattern)) return out;
    for (const hit of PATTERNS[detector.pattern]!({ block, sentences: sents, source: doc.source })) {
      const marked = span(hit.start, hit.end);
      const focus =
        hit.focusStart !== undefined && hit.focusEnd !== undefined && hit.focusEnd > hit.focusStart
          ? exact(hit.focusStart, hit.focusEnd)
          : undefined;
      const target =
        rule.level === 'paragraph'
          ? block.text
          : rule.level === 'word'
            ? sentenceAt(hit.start).text
            : block.text.slice(hit.start, hit.end);
      out.push({
        rule: rule.id,
        level: rule.level,
        ...marked,
        focus,
        // A question about a word-level pattern's own words names them, as for bold.
        ...(rule.level === 'word' && rule.judge?.ask.includes('{term}')
          ? { term: block.text.slice(hit.start, hit.end) }
          : {}),
        target,
        context: target === block.text ? undefined : context,
      });
    }
  } else if (rule.level === 'sentence' && prose) {
    for (const s of sents)
      if (wordCount(s.text) >= 4)
        out.push({ rule: rule.id, level: 'sentence', ...span(s.start, s.end), target: s.text, context });
  } else if (rule.level === 'paragraph') {
    if ((block.kind === 'paragraph' || block.kind === 'quote') && sents.length >= 2 && wordCount(block.text) >= 30)
      out.push({ rule: rule.id, level: 'paragraph', ...span(0, block.text.length), target: block.text });
  }
  return out;
}

/**
 * Spans of the source inside quotation marks, paired within a paragraph (a blank line ends any open quote). Quoted words
 * belong to someone else, such as a customer, a source or a character, so the writer can't rewrite them.
 * A straight quote right after `=` or `{` is an attribute or a code string, and one right after a letter or digit is an
 * inch mark or a closing quote, not an opening one: MDX and HTML keep the writer's own prose in props like text="...".
 */
export function quotedRanges(source: string) {
  const ranges: { start: number; end: number }[] = [];
  // Attribute and code strings are matched whole and skipped, so their closing quote can't open a quotation.
  const pattern = /(?<code>[={]\s*"[^"\n]*")|“(?:[^“”\n]|\n(?!\s*\n))*”|(?<![\p{L}\p{N}])"(?:[^"\n]|\n(?!\s*\n))*"/gu;
  for (const quote of source.matchAll(pattern))
    if (!quote.groups?.code) ranges.push({ start: quote.index, end: quote.index + quote[0].length });
  return ranges;
}

/** Drop a candidate whose problem (its focus, or else the whole span) is mostly inside a quotation. */
function dropQuoted(doc: Doc, candidates: Candidate[]) {
  const quoted = quotedRanges(doc.source);
  if (!quoted.length) return candidates;
  return candidates.filter(c => {
    const { start, end } = c.focus ?? c;
    const inside = quoted.reduce((n, q) => n + Math.max(0, Math.min(end, q.end) - Math.max(start, q.start)), 0);
    return inside * 2 < end - start;
  });
}

/** Drop a lexicon hit that sits entirely inside a longer lexicon hit ("Let's delve into" keeps the signpost). */
function dropNestedLexicon(candidates: Candidate[], registry: Registry) {
  const lexicon = new Set(
    registry.rules.filter(r => r.detector.kind === 'lexicon' && r.level === 'word').map(r => r.id),
  );
  const words = candidates.filter(c => lexicon.has(c.rule));
  return candidates.filter(
    c =>
      !lexicon.has(c.rule) ||
      !words.some(o => o !== c && o.start <= c.start && o.end >= c.end && o.end - o.start > c.end - c.start),
  );
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        signal?.throwIfAborted();
        await run(items[next++]!);
      }
    }),
  );
}

/** Candidates with averaged judge probabilities (no thresholds applied). Without a judge, probabilities stay unset. */
export async function analyze(doc: Doc, registry: Registry, judge?: JudgeProvider, options: AnalyzeOptions = {}) {
  const rules = registry.rules.filter(r => (options.rules ? options.rules.includes(r.id) : r.default));
  const compiled = new Map(
    rules.flatMap(r => (r.detector.kind === 'lexicon' ? [[r.id, compileLexicon(r.detector.terms)] as const] : [])),
  );
  const blocks = project(doc);
  let candidates: Candidate[] = [];
  for (const block of blocks) {
    const sents =
      block.kind === 'heading' ? [{ start: 0, end: block.text.length, text: block.text }] : sentences(block);
    for (const rule of rules) candidates.push(...candidatesFor(doc, rule, block, sents, compiled.get(rule.id)));
  }
  candidates = dropQuoted(doc, dropNestedLexicon(candidates, registry));
  const usage = { calls: 0, inputTokens: 0, dollars: 0, groups: 0, cachedCalls: 0 };
  const byId = new Map(registry.rules.map((r, i) => [r.id, { rule: r, order: i }]));
  const judged = candidates.filter(c => byId.get(c.rule)!.rule.judge);
  if (judge && judged.length) {
    // One target + context = one group; its questions are packed into as few calls as the provider allows.
    const groups = new Map<string, { target: string; context?: string; members: Candidate[] }>();
    for (const c of judged) {
      const key = JSON.stringify([c.target, c.context ?? '']);
      const group = groups.get(key) ?? { target: c.target, context: c.context, members: [] };
      group.members.push(c);
      groups.set(key, group);
    }
    const repeatsFor = (rule: string) =>
      typeof options.repeats === 'function' ? options.repeats(rule) : (options.repeats ?? 1);
    const calls: {
      input: { target: string; context?: string };
      questions: Question[];
      repeats: number;
      members: Candidate[];
    }[] = [];
    for (const group of groups.values()) {
      const questions = new Map<string, { question: Question; order: number; rule: string }>();
      for (const c of group.members) {
        const rule = byId.get(c.rule)!,
          id = questionId(c);
        if (!questions.has(id))
          questions.set(id, {
            order: rule.order,
            rule: c.rule,
            question: {
              id,
              kind: 'yes-no',
              ask: PREAMBLE + fill(rule.rule.judge!.ask, c.term),
              yes: fill(rule.rule.judge!.yes, c.term),
              no: fill(rule.rule.judge!.no, c.term),
            },
          });
      }
      const ordered = [...questions.values()].sort(
        (a, b) => a.order - b.order || a.question.id.localeCompare(b.question.id),
      );
      const size = Math.max(1, judge.capabilities.maxQuestionsPerCall);
      for (let i = 0; i < ordered.length; i += size) {
        const chunk = ordered.slice(i, i + size);
        const ids = new Set(chunk.map(q => q.question.id));
        calls.push({
          input: group.context ? { target: group.target, context: group.context } : { target: group.target },
          questions: chunk.map(q => q.question),
          repeats: Math.max(...chunk.map(q => repeatsFor(q.rule))),
          members: group.members.filter(c => ids.has(questionId(c))),
        });
      }
    }
    usage.groups = groups.size;
    await pool(
      calls,
      options.concurrency ?? 4,
      async call => {
        const answers = new Map<string, number[]>();
        for (let r = 0; r < call.repeats; r++) {
          const result = await judge.judge(call.input, call.questions, { signal: options.signal });
          usage.calls += result.usage.calls;
          usage.inputTokens += result.usage.inputTokens ?? 0;
          usage.dollars += result.usage.dollars;
          if (result.cached) usage.cachedCalls += 1;
          for (const a of result.answers) answers.set(a.id, [...(answers.get(a.id) ?? []), a.probability]);
        }
        for (const c of call.members) {
          const list = answers.get(questionId(c));
          if (!list?.length) continue;
          c.probabilities = list;
          c.probability = list.reduce((n, p) => n + p, 0) / list.length;
        }
      },
      options.signal,
    );
  }
  return { blocks, candidates, usage };
}

const normalize = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
function occurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) count++;
  return count;
}

/** Widen [start, end) by whole words inside its block until the normalized text is unique in the body. */
function uniqueSpan(source: string, body: string, start: number, end: number, block?: Block) {
  const lo = block?.start ?? 0,
    hi = block?.end ?? source.length;
  for (let step = 0; step < 16; step++) {
    if (occurrences(body, normalize(source.slice(start, end))) <= 1) return { start, end, unique: true };
    const right = /^\s*\S+/.exec(source.slice(end, hi)),
      left = /\S+\s*$/.exec(source.slice(lo, start));
    if (!right && !left) break;
    if (right && (step % 2 === 0 || !left)) end += right[0].length;
    else if (left) start -= left[0].length;
  }
  return { start, end, unique: false };
}

export type DecideMeta = { provider: string; model: string };
/** Apply per-rule thresholds and build findings with exact, unique source matches. */
export function decide(
  doc: Doc,
  candidates: Candidate[],
  registry: Registry,
  calibration?: Calibration,
  meta: DecideMeta = { provider: calibration?.provider ?? 'none', model: calibration?.model ?? 'none' },
  blocks = project(doc),
) {
  const body = normalize(doc.source.slice(bodyStart(doc.source)));
  const rules = new Map(registry.rules.map(r => [r.id, r]));
  const seen = new Set<string>();
  const kept = candidates
    .filter(c => {
      const rule = rules.get(c.rule);
      if (!rule) return false;
      const key = `${c.rule}:${c.start}:${c.end}:${c.focus?.start ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (!rule.judge) return true;
      if (c.probability === undefined) return false;
      return c.probability >= (calibration?.rules[c.rule]?.threshold ?? DEFAULT_THRESHOLDS[rule.detector.kind]);
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  return kept.map((c, index) => {
    const rule = rules.get(c.rule)!;
    const block = blocks.find(b => c.start >= b.start && c.start < b.end);
    const wide = uniqueSpan(doc.source, body, c.start, c.end, block);
    const inner =
      c.focus ?? (wide.start !== c.start || wide.end !== c.end ? { start: c.start, end: c.end } : undefined);
    const threshold = calibration?.rules[c.rule]?.threshold ?? DEFAULT_THRESHOLDS[rule.detector.kind];
    const finding: Finding = {
      id: `D${String(index + 1).padStart(3, '0')}`,
      rule: c.rule,
      level: c.level,
      edit: rule.edit,
      match: doc.source.slice(wide.start, wide.end),
      span: { start: wide.start, end: wide.end },
      note: rule.fix + (c.plain ? ` Try “${c.plain}”.` : ''),
      severity: rule.severity ?? 'flag',
      status: 'open',
    };
    if (inner) finding.focus = { start: inner.start - wide.start, end: inner.end - wide.start };
    if (!wide.unique) finding.ambiguous = true;
    if (rule.judge && c.probability !== undefined)
      finding.judge = {
        provider: meta.provider,
        model: meta.model,
        probability: Math.round(c.probability * 1000) / 1000,
        threshold,
        rulesVersion: registry.version,
      };
    return finding;
  });
}

/** The detection API: candidates, one judge pass, calibrated findings. */
export async function detect(
  doc: Doc,
  registry: Registry,
  judge: JudgeProvider,
  calibration?: Calibration,
  options: Omit<AnalyzeOptions, 'repeats'> = {},
) {
  const { blocks, candidates } = await analyze(doc, registry, judge, {
    ...options,
    repeats: rule => calibration?.rules[rule]?.repeats ?? 1,
  });
  return decide(doc, candidates, registry, calibration, { provider: judge.id, model: judge.model }, blocks);
}
