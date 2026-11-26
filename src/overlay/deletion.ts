import type { ProofmarksEdit } from './types';
/**
 * Where an accepted edit's text sits in the source now: between the context recorded around it, so a short rewrite such
 * as "use" is found even where the same text appears again. A deletion is the gap between its context. A
 * later edit nearby can change part of the context, so shorter context is tried until a fit is the only one.
 */
export function editSpan(source: string, edit: Pick<ProofmarksEdit, 'context' | 'after'>) {
  const context = edit.context,
    changed = edit.after
      ? 'Applied text context changed; cannot revert safely.'
      : 'Deleted text context changed; cannot revert safely.';
  if (!context) throw Error(edit.after ? 'Exact edit context is missing.' : 'Exact deletion context is missing.');
  if (!context.left && !context.right) {
    if (source === edit.after) return { start: 0, end: source.length };
    throw Error(changed);
  }
  for (const [l, r] of [
    [64, 64],
    [24, 24],
    [12, 12],
    [0, 16],
    [16, 0],
  ] as const) {
    const left = l ? context.left.slice(-l) : '',
      right = context.right.slice(0, r);
    // Shorter context needs a few characters to go on.
    if (l < 64 && (left + right).trim().length < 6) continue;
    const needle = left + edit.after + right,
      start = source.indexOf(needle);
    if (start >= 0 && source.indexOf(needle, start + 1) < 0) {
      const offset = start + left.length;
      return { start: offset, end: offset + edit.after.length };
    }
  }
  throw Error(changed);
}

/** Closing quotes, brackets and emphasis that can trail a sentence's punctuation. */
const CLOSE = `"'”’)\\]*_`;
const LINE_START = String.raw`(?:^|\n)[ \t]*(?:(?:[-*+]|\d+[.)]|>|#{1,6})[ \t]+)?`;
const SENTENCE_START = new RegExp(String.raw`(?:${LINE_START}|[.!?…][${CLOSE}]*[ \t]+|>[ \t]*)$`);

/**
 * What deleting [start, end) should really change so the sentence around it still reads. A whole sentence
 * goes with its end punctuation and one space; an opener takes the comma, colon, semicolon or dash after it, and the
 * next word is capitalized; no double
 * space or orphaned comma is left. Only punctuation, spaces and that one letter are touched, never markup. `unique` says
 * whether replacement text would be the only copy of itself in the result, so an exact Undo can find it: a capitalized
 * opener grows word by word until it is, and otherwise stays a plain deletion.
 */
export function tidyDeletion(
  text: string,
  start: number,
  end: number,
  unique: (after: string, start: number, end: number) => boolean = () => true,
): { start: number; end: number; after: string } {
  const before = text.slice(0, start),
    rest = text.slice(end),
    deleted = text.slice(start, end),
    opens = SENTENCE_START.test(before),
    stop = new RegExp(`^[.!?…]+[${CLOSE}]*`).exec(rest);
  if (opens && (stop || new RegExp(`[.!?…][${CLOSE}]*$`).test(deleted))) {
    // The whole sentence: its punctuation, then the space before it, or after it at the start of a line.
    const tail = end + (stop?.[0].length ?? 0),
      space = new RegExp(`${LINE_START}$`).test(before) ? null : /[ \t]+$/.exec(before);
    if (space) return { start: start - space[0].length, end: tail, after: '' };
    return { start, end: tail + (/^[ \t]*/.exec(text.slice(tail))?.[0].length ?? 0), after: '' };
  }
  // "Here's the thing: most teams…" loses its colon as "Notably, Docker…" loses its comma.
  const lead = opens ? /^(?:[,:;]|[ \t]+[—–-])?[ \t]+/.exec(rest) : null;
  if (lead) {
    // An opener: the next word starts the sentence now.
    const from = end + lead[0].length,
      next = text.slice(from);
    if (/^\p{Ll}/u.test(next)) {
      const sentence = /^[^\n]*?(?:[.!?…](?=\s|$)|$)/.exec(next)![0];
      for (const word of sentence.matchAll(/\S+/g)) {
        const to = word.index + word[0].length,
          after = sentence.charAt(0).toUpperCase() + sentence.slice(1, to);
        if (unique(after, start, from + to)) return { start, end: from + to, after };
      }
    }
    return { start, end: from, after: '' };
  }
  const comma = /[ \t]*,[ \t]*$/.exec(before);
  if (comma && /^[.!?…]/.test(rest)) return { start: start - comma[0].length, end, after: '' };
  const gap = /[ \t]+$/.exec(before),
    listed = gap && /^,[ \t]+/.exec(rest);
  // A word in a list of adjectives takes its comma: "a seamless, quick tool" reads "a quick tool".
  if (listed) return { start, end: end + listed[0].length, after: '' };
  if (gap && /^[,.;:!?…]/.test(rest)) return { start: start - gap[0].length, end, after: '' };
  if (gap) return { start, end: end + (/^[ \t]*/.exec(rest)?.[0].length ?? 0), after: '' };
  return { start, end, after: '' };
}

/**
 * Where a rewrite starts in its text. One that opens with punctuation, such as ", but" for an em dash's "— but", takes
 * the space before the mark, so the sentence reads "small, but", not "small , but". The source and the page
 * apply it alike. A line break counts as that space; a blank line doesn't.
 */
export function replacementStart(text: string, start: number, replacement: string) {
  if (!/^[,.;:!?]/.test(replacement)) return start;
  const before = text.slice(0, start),
    space = /[ \t]*(?:\n[ \t]*)?$/.exec(before)![0].length,
    rest = before.slice(0, before.length - space);
  // A mark that starts a line or the text has no word to attach to.
  return !rest || rest.endsWith('\n') ? start : start - space;
}
