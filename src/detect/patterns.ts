// Code candidates. Each pattern returns projected spans inside one block; the judge decides (code-only rules excepted).
import { wordCount, type Block, type Sentence } from './segment';

export type PatternContext = { block: Block; sentences: Sentence[]; source: string };
/** Projected [start, end) of the marked text, and optionally the exact problem inside it. */
export type PatternHit = { start: number; end: number; focusStart?: number; focusEnd?: number };

const W = String.raw`[\p{L}\p{N}][\p{L}\p{N}'’-]*`;
const NEG = String.raw`(?:not|never|no longer|cannot|(?:is|are|was|were|do|does|did|ca|wo|would|should|could|has|have|had|ai|must)n['’]t)`;
const PRON = String.raw`(?:it|they|we|you|he|she|that|this|these|those|it['’]s|they['’]re|we['’]re|you['’]re|that['’]s|instead|rather|but)`;
const HAS_NEG = new RegExp(String.raw`\b${NEG}\b`, 'i');
const CONTRAST_SINGLE = [
  // "isn't X; it's Y", "don't buy X, they buy Y", "not about X — it's about Y"
  new RegExp(String.raw`\b${NEG}\b[^.;:—–!?]*?(?:[,;:]|\s[—–-]{1,2}\s|[—–])\s*${PRON}\b`, 'i'),
  // "not X but Y", "not only X but also Y", "not just X, but Y"
  new RegExp(String.raw`\b${NEG}\b[^.;!?]*?\bbut\b`, 'i'),
  /\bless about\b[^.;!?]*?\bmore about\b/i,
  /\bmore about\b[^.;!?]*?\bthan about\b/i,
  /\bnot so much\b[^.;!?]*?\bas\b/i,
];
const PAIR_START =
  /^["“‘']?(?:it|they|we|you|he|she|this|that|these|those|instead|rather|just|only|because|it['’]s|they['’]re|we['’]re|you['’]re|that['’]s|there['’]s)\b/i;
const firstWord = (text: string) => /[\p{L}\p{N}'’]+/u.exec(text)?.[0].toLowerCase();
const SUBORDINATE =
  /^["“‘']?(?:if|when|whenever|unless|whether|although|though|because|since|while|until|once|as long as)\b/i;

function contrast({ sentences }: PatternContext) {
  const hits: PatternHit[] = [];
  for (const [i, s] of sentences.entries()) {
    // "If you're not X, we…" is a condition, not a contrast.
    const conditional = SUBORDINATE.test(s.text);
    const single = CONTRAST_SINGLE.map((r, k) => (k === 0 && conditional ? null : r.exec(s.text))).find(Boolean);
    if (single) {
      hits.push({
        start: s.start,
        end: s.end,
        focusStart: s.start + single.index,
        focusEnd: s.start + single.index + single[0].length,
      });
      continue;
    }
    const next = sentences[i + 1];
    const notBecause = /^not because\b/i.test(s.text) && next && /^because\b/i.test(next.text);
    if (!next || (!HAS_NEG.test(s.text) && !notBecause) || wordCount(s.text) > 20) continue;
    if (notBecause || PAIR_START.test(next.text) || firstWord(next.text) === firstWord(s.text))
      hits.push({ start: s.start, end: next.end });
  }
  return hits;
}

const ITEM = String.raw`${W}(?:\s+${W}){0,4}`;
const TRIAD = new RegExp(String.raw`(${ITEM}),\s+(${ITEM}),?\s+(?:and|or|nor)\s+(${ITEM})`, 'gu');
const REPEATED = new RegExp(
  String.raw`(?:(${ITEM}),\s+)?\b(no|every|each|new|more|less|zero|any|fewer|better|faster)\s+(${ITEM}),\s+\2\s+(${ITEM})(?:,?\s+(?:and\s+|or\s+)?\2\s+(${ITEM}))?`,
  'giu',
);
function three({ sentences }: PatternContext) {
  const hits: PatternHit[] = [];
  for (const s of sentences) {
    for (const r of [TRIAD, REPEATED]) {
      r.lastIndex = 0;
      for (const m of s.text.matchAll(r)) {
        const before = s.text.slice(0, m.index);
        // A longer list ("A, B, C, and D") is not a three.
        if (r === TRIAD && /,\s*$/.test(before)) continue;
        if (r === REPEATED && !m[1] && !m[5]) continue;
        hits.push({
          start: s.start,
          end: s.end,
          focusStart: s.start + m.index,
          focusEnd: s.start + m.index + m[0].length,
        });
        break;
      }
    }
  }
  // Three short fragments in a row ("Speed matters. Focus matters. Clarity matters most."), but not longer runs.
  const short = (s: Sentence | undefined, max: number) => !!s && wordCount(s.text) <= max;
  const words = (s: Sentence) => s.text.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  // Parallel when the three share a first, last or next-to-last word ("… for beginners. … for intermediates.").
  const parallel = (...ss: Sentence[]) =>
    [(w: string[]) => w[0], (w: string[]) => w.at(-1), (w: string[]) => w.at(-2)].some(
      pick => new Set(ss.map(s => pick(words(s)))).size === 1,
    );
  for (let i = 0; i + 2 < sentences.length; i++) {
    const [a, b, c] = [sentences[i]!, sentences[i + 1]!, sentences[i + 2]!];
    const run =
      (short(a, 4) && short(b, 4) && short(c, 4)) ||
      (short(a, 3) && short(b, 3)) ||
      (short(a, 6) && short(b, 6) && short(c, 6) && parallel(a, b, c));
    if (run && !short(sentences[i - 1], 3) && !short(sentences[i + 3], 3)) hits.push({ start: a.start, end: c.end });
  }
  return dedupe(hits);
}

const HEDGES =
  /\b(?:could|might|may|perhaps|possibly|potentially|arguably|somewhat|relatively|likely|probably|seemingly|apparently|generally|typically|usually|tends? to|in some cases|in certain (?:cases|situations)|to some extent|to a certain extent|sort of|kind of|more or less|it seems|it appears|seems to|appears to)\b/gi;
function hedging({ sentences }: PatternContext) {
  const hits: PatternHit[] = [];
  for (const s of sentences) {
    const found = [...s.text.matchAll(HEDGES)];
    if (found.length < 2) continue;
    const first = found[0]!,
      last = found.at(-1)!;
    hits.push({
      start: s.start,
      end: s.end,
      focusStart: s.start + first.index,
      focusEnd: s.start + last.index + last[0].length,
    });
  }
  return hits;
}

const ATTRIBUTION =
  /\b(?:experts?\s+(?:agree|say|believe|warn|predict|recommend|suggest|argue)|studies\s+(?:show|suggest|have shown|find|found|indicate)|research(?:ers)?\s+(?:shows?|suggests?|has shown|have found|finds?|found|indicates?)|(?:many|some|most)\s+(?:(?:people|experts|analysts|observers|critics|leaders)\s+)?(?:believe|say|argue|agree|think|feel)|it is (?:widely|generally|commonly) (?:believed|accepted|known|agreed)|according to (?:some|many|experts|studies|research)|data (?:shows|suggests)|surveys? (?:shows?|suggests?)|reports? (?:shows?|suggests?)|science (?:says|shows)|everyone knows|industry (?:leaders|experts|insiders))\b/i;
function attribution({ sentences }: PatternContext) {
  return sentences.flatMap(s => {
    const m = ATTRIBUTION.exec(s.text);
    return m
      ? [{ start: s.start, end: s.end, focusStart: s.start + m.index, focusEnd: s.start + m.index + m[0].length }]
      : [];
  });
}

const NOT_PARTICIPLE = new Set([
  'including',
  'according',
  'during',
  'regarding',
  'concerning',
  'following',
  'something',
  'nothing',
  'anything',
  'everything',
  'thing',
  'things',
  'morning',
  'evening',
  'spring',
  'string',
  'ring',
  'king',
  'wing',
  'bring',
  'sing',
  'ceiling',
  'building',
  'meeting',
  'wedding',
  'being',
  'pending',
  'notwithstanding',
  'considering',
  'excluding',
  'beginning',
  'ending',
  'setting',
  'feeling',
  'interesting',
  'amazing',
  'exciting',
  'boring',
]);
const TRAIL = /,\s+((?:thereby\s+|further\s+|ultimately\s+)?([a-z][a-z-]*ing)\b[^,;:]*?)[.!?]?["”’)]*$/i;
const WHICH =
  /,\s+(which\s+(?:highlights|underscores|showcases|reflects|demonstrates|signals|cements|reinforces|speaks to|shows)\b[^,;:]*?)[.!?]?["”’)]*$/i;
function trailing({ sentences }: PatternContext) {
  const hits: PatternHit[] = [];
  for (const s of sentences) {
    if ((s.text.match(/,\s+[a-z][a-z-]*ing\b/gi) ?? []).length >= 2) continue;
    const m = TRAIL.exec(s.text),
      w = WHICH.exec(s.text);
    const use = m && !NOT_PARTICIPLE.has(m[2]!.toLowerCase()) ? m : w;
    if (!use) continue;
    const clause = s.start + use.index + use[0].indexOf(use[1]!);
    hits.push({ start: s.start, end: s.end, focusStart: clause, focusEnd: clause + use[1]!.length });
  }
  return hits;
}

const RANGE =
  /\b(?:everything\s+|anything\s+)?from\s+(?![\d$])((?:the\s+|a\s+|an\s+)?\p{L}[\p{L}\p{N}'’-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’-]*){0,3}?)\s+to\s+(?![\d$])((?:the\s+|a\s+|an\s+)?[\p{L}\p{N}][\p{L}\p{N}'’-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’-]*){0,3})/giu;
function falseRange({ sentences }: PatternContext) {
  const hits: PatternHit[] = [];
  for (const s of sentences)
    for (const m of s.text.matchAll(RANGE)) {
      if (m[1]!.toLowerCase() === m[2]!.toLowerCase()) continue;
      hits.push({
        start: s.start,
        end: s.end,
        focusStart: s.start + m.index,
        focusEnd: s.start + m.index + m[0].length,
      });
    }
  return hits;
}

function rhythm({ block, sentences }: PatternContext) {
  if (block.kind !== 'paragraph' || sentences.length < 4) return [];
  const counts = sentences.map(s => wordCount(s.text));
  const mean = counts.reduce((n, c) => n + c, 0) / counts.length;
  const cv = Math.sqrt(counts.reduce((n, c) => n + (c - mean) ** 2, 0) / counts.length) / mean;
  const openers = new Map<string, number>();
  for (const s of sentences) {
    const w = firstWord(s.text);
    if (w) openers.set(w, (openers.get(w) ?? 0) + 1);
  }
  const sameOpener = Math.max(...openers.values()) >= 3;
  return cv <= 0.35 || sameOpener ? [{ start: 0, end: block.text.length }] : [];
}

function emDash({ block }: PatternContext) {
  return [...block.text.matchAll(/—|\s–\s|\s?--\s?/g)].map(m => {
    const at = m.index + m[0].search(/[—–-]/),
      end = at + m[0].trim().length;
    // The mark takes the word after the dash, so a rewrite can put in a comma ("small, but") or a period and a capital
    // ("small. But"). A rewrite that opens with punctuation takes the space before the dash when it's applied.
    const next = /^\s?[\p{L}\p{N}][\p{L}\p{N}'’]*/u.exec(block.text.slice(end))?.[0].length ?? 0;
    return { start: at, end: end + next, focusStart: at, focusEnd: end };
  });
}
function colon({ block, sentences, source }: PatternContext) {
  if (block.kind === 'heading') return [];
  const label = leadIn(block, source)?.end ?? -1;
  const hits: PatternHit[] = [];
  for (const s of sentences) {
    const at = s.text.indexOf(':', Math.max(0, label - s.start));
    if (
      at < 0 ||
      at === s.text.length - 1 ||
      /^\s*["“\d]/.test(s.text.slice(at + 1)) ||
      /\d:\d/.test(s.text.slice(at - 1, at + 2))
    )
      continue;
    hits.push({ start: s.start, end: s.end, focusStart: s.start + at, focusEnd: s.start + at + 1 });
  }
  return hits;
}
const MINOR = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'for',
  'nor',
  'of',
  'on',
  'in',
  'to',
  'at',
  'by',
  'with',
  'vs',
  'via',
  'as',
  'up',
  'is',
  'from',
  'into',
]);
function titleCase({ block }: PatternContext) {
  if (block.kind !== 'heading') return [];
  // Minor words, acronyms and names with a capital inside them (GitHub, iPhone) don't show a heading's case.
  const words = (block.text.match(/[\p{L}][\p{L}'’-]*/gu) ?? [])
    .slice(1)
    .filter(w => !MINOR.has(w.toLowerCase()) && w !== w.toUpperCase() && !/\p{Ll}\p{Lu}/u.test(w));
  const capital = words.filter(w => /^\p{Lu}/u.test(w)).length;
  return capital >= 2 && capital / words.length >= 0.6 ? [{ start: 0, end: block.text.length }] : [];
}
/**
 * A bold label that opens a list item or a paragraph ("- **Speed** in half the time", "**No documentation:** Some
 * tasks…"): the raw offset of its opening asterisks and its projected end, just past a colon that ends it. A paragraph's
 * label needs that colon; a list item's doesn't.
 */
function leadIn(block: Block, source: string) {
  const m = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\*\*([^*]+)\*\*(:?)/.exec(source.slice(block.start, block.end));
  if (!m || !(block.kind === 'list-item' || m[2] || m[1]!.endsWith(':'))) return undefined;
  const last = block.map.indexOf(block.start + m[0].length - (m[2] ? 1 : 3));
  return last < 0 ? undefined : { at: m[0].length - m[1]!.length - m[2]!.length - 4, end: last + 1 };
}

function bold({ block, source }: PatternContext) {
  const label = leadIn(block, source);
  const spans = [...source.slice(block.start, block.end).matchAll(/\*\*([^*]+)\*\*/g)].filter(
    m => m.index !== label?.at,
  );
  if (!spans.length || (spans.length === 1 && block.kind === 'heading')) return [];
  const projected = new Map(block.map.map((at, i) => [at, i]));
  return spans.flatMap(m => {
    // The bold text's first and last characters, inside the asterisks.
    const a = projected.get(block.start + m.index + 2),
      b = projected.get(block.start + m.index + m[0].length - 3);
    return a !== undefined && b !== undefined ? [{ start: a, end: b + 1 }] : [];
  });
}

function dedupe(hits: PatternHit[]) {
  const seen = new Set<string>();
  return hits.filter(h => {
    const key = `${h.start}:${h.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const PATTERNS: Record<string, (ctx: PatternContext) => PatternHit[]> = {
  contrast,
  three,
  hedging,
  attribution,
  trailing,
  'false-range': falseRange,
  rhythm,
  'em-dash': emDash,
  colon,
  'title-case': titleCase,
  bold,
};
