// Source projection and sentence segmentation. Projected text keeps a per-character map back to the
// source, so every finding carries an exact source substring (the overlay and the MDX writer match on it).
import type { Doc } from './types';

export type BlockKind = 'paragraph' | 'heading' | 'list-item' | 'quote';
export type Block = { kind: BlockKind; text: string; map: number[]; start: number; end: number; excluded: Set<number> };
export type Sentence = { start: number; end: number; text: string };

/** Where prose starts: after a leading `---` frontmatter fence, if any. */
export function bodyStart(source: string) {
  if (!source.startsWith('---\n')) return 0;
  const close = source.indexOf('\n---', 3);
  if (close < 0) return 0;
  const after = source.indexOf('\n', close + 4);
  return after < 0 ? source.length : after + 1;
}

const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^(#{1,6})\s+/;
const QUOTE = /^\s*>\s?/;

type Line = { start: number; end: number; text: string };
function lines(source: string, from: number) {
  const out: Line[] = [];
  let i = from;
  while (i < source.length) {
    const nl = source.indexOf('\n', i),
      end = nl < 0 ? source.length : nl;
    out.push({ start: i, end, text: source.slice(i, end) });
    i = end + 1;
  }
  return out;
}

/** Project one block of MDX source; `prefixes` are list, heading or quote marker offsets to drop. */
function projectMdxBlock(source: string, start: number, end: number, kind: BlockKind, prefixes: Set<number>) {
  let text = '';
  const map: number[] = [];
  const raw = source.slice(start, end);
  const excluded = new Set<number>(prefixes);
  const exclude = (a: number, b: number) => {
    for (let k = a; k < b; k++) excluded.add(start + k);
  };
  // Images, footnote refs, inline tags, JSX expressions and link destinations disappear; link labels stay.
  for (const m of raw.matchAll(/!\[[^\]]*\]\([^)]*\)/g)) exclude(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/\[\^[^\]]+\]/g)) exclude(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/<\/?[A-Za-z][^<>]*>/g)) exclude(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/\{[^{}\n]*\}/g)) exclude(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\(((?:[^()\s]|\([^()]*\))*)\)/g)) {
    exclude(m.index, m.index + 1);
    exclude(m.index + 1 + m[1]!.length, m.index + m[0].length);
  }
  for (let k = 0; k < raw.length; k++) {
    const at = start + k,
      ch = raw[k]!;
    if (excluded.has(at)) continue;
    if (ch === '\\' && k + 1 < raw.length && /[!-/:-@[-`{-~]/.test(raw[k + 1]!)) {
      excluded.add(at);
      continue;
    }
    if (ch === '`' || ch === '*' || ch === '~') {
      excluded.add(at);
      continue;
    }
    if (ch === '_' && !(/[\p{L}\p{N}]/u.test(raw[k - 1] ?? '') && /[\p{L}\p{N}]/u.test(raw[k + 1] ?? ''))) {
      excluded.add(at);
      continue;
    }
    text += ch === '\n' || ch === '\t' ? ' ' : ch;
    map.push(at);
  }
  return { kind, text, map, start, end, excluded };
}

/** MDX blocks: frontmatter, fenced code, JSX blocks, imports/exports and tables are skipped. */
export function projectMdx(source: string) {
  const blocks: Block[] = [];
  let fence: string | undefined, jsx: string | undefined;
  let group: Line[] = [];
  const flush = () => {
    const g = group;
    group = [];
    if (!g.length) return;
    const first = g[0]!.text.trim();
    if (jsx) {
      if (g.some(l => l.text.includes(`</${jsx}>`) || /^\s*\/>/.test(l.text) || /\/>\s*$/.test(l.text)))
        jsx = undefined;
      return;
    }
    if (/^(import|export)\s/.test(first) || first.startsWith('|') || /^[\[\]{}()]/.test(first)) return;
    if (first.startsWith('<') || first.startsWith('{')) {
      const tag = /^<([A-Z][\w.]*)/.exec(first)?.[1];
      const joined = g.map(l => l.text).join('\n');
      if (tag && !joined.includes(`</${tag}>`) && !/\/>\s*$/.test(joined.trim())) jsx = tag;
      return;
    }
    // Split list items and headings into their own blocks.
    let item: Line[] = [];
    let kind: BlockKind = 'paragraph';
    const emit = () => {
      if (!item.length) return;
      const prefixes = new Set<number>();
      for (const l of item) {
        const marker =
          (kind === 'heading' ? HEADING : kind === 'list-item' ? LIST : kind === 'quote' ? QUOTE : /^\s*/).exec(
            l.text,
          )?.[0] ?? '';
        for (let k = 0; k < marker.length; k++) prefixes.add(l.start + k);
        if (kind === 'list-item' && l !== item[0]) {
          const ws = /^\s*/.exec(l.text)![0];
          for (let k = 0; k < ws.length; k++) prefixes.add(l.start + k);
        }
      }
      const block = projectMdxBlock(source, item[0]!.start, item.at(-1)!.end, kind, prefixes);
      if (block.text.trim()) blocks.push(block);
      item = [];
    };
    for (const l of g) {
      const k: BlockKind | undefined = HEADING.test(l.text)
        ? 'heading'
        : LIST.test(l.text)
          ? 'list-item'
          : QUOTE.test(l.text)
            ? 'quote'
            : undefined;
      if (k === 'heading' || k === 'list-item' || (k && k !== kind)) {
        emit();
        kind = k;
      } else if (!k && kind === 'heading') {
        emit();
        kind = 'paragraph';
      }
      item.push(l);
      if (k === 'heading') emit();
    }
    emit();
  };
  for (const line of lines(source, bodyStart(source))) {
    const t = line.text.trim();
    if (fence) {
      if (t.startsWith(fence)) fence = undefined;
      continue;
    }
    if (/^(```|~~~)/.test(t)) {
      flush();
      fence = t.slice(0, 3);
      continue;
    }
    if (!t) {
      flush();
      continue;
    }
    group.push(line);
  }
  flush();
  return blocks;
}

/** Plain text: blank-line paragraphs; short unpunctuated lines are headings. Identity map. */
export function projectText(source: string) {
  const blocks: Block[] = [];
  for (const m of source.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)) {
    const raw = m[0],
      start = m.index;
    if (!raw.trim()) continue;
    const words = raw.trim().split(/\s+/).length;
    const kind: BlockKind = LIST.test(raw)
      ? 'list-item'
      : !/[.!?:;"”’)…]$/.test(raw.trim()) && words <= 12
        ? 'heading'
        : 'paragraph';
    const marker = kind === 'list-item' ? LIST.exec(raw)![0].length : 0;
    const map: number[] = [];
    let text = '';
    for (let k = marker; k < raw.length; k++) {
      text += raw[k] === '\n' ? ' ' : raw[k];
      map.push(start + k);
    }
    blocks.push({ kind, text, map, start, end: start + raw.length, excluded: new Set() });
  }
  return blocks;
}

export const project = (doc: Doc) => (doc.kind === 'mdx' ? projectMdx(doc.source) : projectText(doc.source));

const ABBREVIATIONS =
  /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|e\.g|i\.e|cf|approx|no|inc|ltd|co|corp|dept|fig|vol|al|ca|est|gen|gov|lt|sgt|capt|rev|hon|a\.m|p\.m|u\.s|u\.k)\.\s*$/i;
const INITIALS = /(?:^|[\s(‘'"“])(?:[A-Z]\.){2,}\s*$/;
const INITIAL = /(?:^|[\s(])[A-HJ-Z]\.\s*$/;
const OPENERS =
  /^\s*["“‘']?(?:the|this|that|these|those|it|its|he|she|they|we|i|you|but|and|so|then|a|an|in|on|at|for|if|when|while|after|before|our|their|his|her|my|there|here|what|why|how|now|today)\b/i;

/** Sentences inside one block, as projected offsets with surrounding whitespace trimmed. */
export function sentences(block: Pick<Block, 'text'>) {
  const parts = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(block.text)].map(s => ({
    start: s.index,
    end: s.index + s.segment.length,
  }));
  const merged: { start: number; end: number }[] = [];
  for (const p of parts) {
    const prev = merged.at(-1);
    const prevText = prev ? block.text.slice(prev.start, prev.end) : '';
    const next = block.text.slice(p.start, p.end);
    const join =
      prev &&
      (ABBREVIATIONS.test(prevText) ||
        (INITIALS.test(prevText) && !OPENERS.test(next)) ||
        INITIAL.test(prevText) ||
        /^\s*[a-z]/.test(next) ||
        (/\d\.\s*$/.test(prevText) && /^\d/.test(next)));
    if (join) prev.end = p.end;
    else merged.push({ ...p });
  }
  const out: Sentence[] = [];
  for (const s of merged) {
    let a = s.start,
      b = s.end;
    while (a < b && /\s/.test(block.text[a]!)) a++;
    while (b > a && /\s/.test(block.text[b - 1]!)) b--;
    if (b > a) out.push({ start: a, end: b, text: block.text.slice(a, b) });
  }
  return out;
}

const OPEN_MARKS = new Set(['*', '_', '~', '`', '[']);
const CLOSE_MARKS = new Set(['*', '_', '~', '`']);
/** Source span for projected [a, b), widened over adjacent emphasis/code/link markup so edits stay balanced. */
export function sourceSpan(block: Block, a: number, b: number, source: string) {
  let start = block.map[a]!,
    end = block.map[b - 1]! + 1;
  while (start > block.start && block.excluded.has(start - 1) && OPEN_MARKS.has(source[start - 1]!)) start--;
  for (;;) {
    if (end < block.end && block.excluded.has(end) && CLOSE_MARKS.has(source[end]!)) {
      end++;
      continue;
    }
    if (end < block.end && block.excluded.has(end) && source[end] === ']' && source[end + 1] === '(') {
      // Link destination: walk to the matching parenthesis (URLs may contain balanced parentheses).
      let close = end + 2;
      for (let depth = 1; close < block.end && depth; close++)
        depth += source[close] === '(' ? 1 : source[close] === ')' ? -1 : 0;
      if (close <= block.end) {
        end = close;
        continue;
      }
    }
    break;
  }
  return { start, end };
}

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
