// Lexicon matching with English inflections. A lexicon hit is a mark unless the judge vetoes it.
import type { LexiconTerm } from './types';

const SIBILANT = /(?:s|x|z|ch|sh)$/;
const CONSONANT_Y = /[^aeiou]y$/;

function verbForms(word: string) {
  const third = SIBILANT.test(word) ? word + 'es' : CONSONANT_Y.test(word) ? word.slice(0, -1) + 'ies' : word + 's';
  const past = word.endsWith('e') ? word + 'd' : CONSONANT_Y.test(word) ? word.slice(0, -1) + 'ied' : word + 'ed';
  const ing = word.endsWith('ie')
    ? word.slice(0, -2) + 'ying'
    : /(?:ee|ye|oe)$/.test(word)
      ? word + 'ing'
      : word.endsWith('e')
        ? word.slice(0, -1) + 'ing'
        : word + 'ing';
  return [word, third, past, ing];
}
const nounForms = (word: string) => [
  word,
  SIBILANT.test(word) ? word + 'es' : CONSONANT_Y.test(word) ? word.slice(0, -1) + 'ies' : word + 's',
];
function adjForms(word: string) {
  const ly = word.endsWith('le')
    ? word.slice(0, -1) + 'y'
    : word.endsWith('ic')
      ? word + 'ally'
      : CONSONANT_Y.test(word)
        ? word.slice(0, -1) + 'ily'
        : word + 'ly';
  return [word, ly];
}

/** Every surface form of a term. Multi-word verbs and nouns inflect their head word (first for verbs, last for nouns). */
export function inflect(term: LexiconTerm) {
  const words = term.term.split(' ');
  let forms: string[];
  if (term.pos === 'verb') forms = verbForms(words[0]!).map(w => [w, ...words.slice(1)].join(' '));
  else if (term.pos === 'noun') forms = nounForms(words.at(-1)!).map(w => [...words.slice(0, -1), w].join(' '));
  else if (term.pos === 'adj') forms = adjForms(term.term);
  else forms = [term.term];
  return [...new Set([...forms, ...(term.forms ?? [])])];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A folded form as a pattern: either apostrophe, and a hyphen or any whitespace between words. */
const formPattern = (folded: string) => escape(folded).replace(/'/g, "['’]").replace(/ /g, '[-\\s]+');
const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[-\s]+/g, ' ');

export type CompiledLexicon = { regex: RegExp; lookup: Map<string, LexiconTerm> };
export function compileLexicon(terms: LexiconTerm[]): CompiledLexicon {
  const lookup = new Map<string, LexiconTerm>();
  for (const term of terms) for (const form of inflect(term)) lookup.set(fold(form), term);
  const forms = [...lookup.keys()].sort((a, b) => b.length - a.length);
  // Lookarounds instead of \b so terms may end in punctuation ("Here's the thing:", "And the best part?").
  const body = forms.map(formPattern).join('|');
  return { regex: new RegExp(`(?<![\\p{L}\\p{N}'’-])(?:${body})(?![\\p{L}\\p{N}-])`, 'giu'), lookup };
}

export type LexiconHit = { start: number; end: number; text: string; term: LexiconTerm };
export function lexiconHits(text: string, compiled: CompiledLexicon) {
  const hits: LexiconHit[] = [];
  for (const m of text.matchAll(compiled.regex)) {
    const term = compiled.lookup.get(fold(m[0]));
    if (term) hits.push({ start: m.index, end: m.index + m[0].length, text: m[0], term });
  }
  return hits;
}
