// Rule registry v3, calibration and finding shapes.

export const LEVELS = ['word', 'sentence', 'paragraph'] as const;
export const EDITS = ['replace', 'delete', 'insert', 'paragraph'] as const;
export const DETECTORS = ['lexicon', 'pattern', 'judge'] as const;
export const MARKS = ['underline', 'box', 'circle', 'strike-through', 'crossed-off', 'caret', 'bracket'] as const;
export const CONTEXTS = ['none', 'paragraph'] as const;
export type Level = (typeof LEVELS)[number];
export type Edit = (typeof EDITS)[number];

/** A lexicon term. `pos` drives inflection; `forms` lists extra spellings verbatim; `plain` is the plainer word, shown in the note. */
export type LexiconTerm = {
  term: string;
  pos?: 'verb' | 'noun' | 'adj' | 'phrase';
  forms?: string[];
  plain?: string;
  start?: boolean;
};

export type Rule = {
  id: string;
  label: string;
  color?: string;
  mark?: (typeof MARKS)[number];
  level: Level;
  why: string;
  fix: string;
  edit: Edit;
  detector: { kind: 'lexicon'; terms: LexiconTerm[] } | { kind: 'pattern'; pattern: string } | { kind: 'judge' };
  /** Absent for code-only rules: the detector alone decides. `{term}` in ask/yes is replaced by the matched term. */
  judge?: { ask: string; yes: string; no: string; context: 'none' | 'paragraph' };
  default: boolean;
  severity?: 'flag' | 'warning';
};
export type Registry = { version: string; rules: Rule[] };

/** Per rule: mark when the averaged probability is at or above `threshold`. Lexicon thresholds are veto floors. */
export type RuleCalibration = {
  threshold: number;
  band: [number, number];
  repeats: number;
  recall?: number;
  humanMarks?: number;
};
export type Calibration = {
  provider: string;
  model: string;
  rulesVersion: string;
  labeledSetHash: string;
  fitted: string;
  rules: Record<string, RuleCalibration>;
};

/** A document: MDX source (frontmatter, JSX and code are skipped) or plain text. */
export type Doc = { id: string; kind: 'mdx' | 'text'; source: string };

/** One judge decision unit before thresholds: a code candidate, a lexicon hit, or a judge-level unit. */
export type Candidate = {
  rule: string;
  level: Level;
  /** Source offsets of the marked span, and of the exact problem inside it. */
  start: number;
  end: number;
  focus?: { start: number; end: number };
  term?: string;
  plain?: string;
  /** The text the judge sees, and its context. */
  target: string;
  context?: string;
  probability?: number;
  probabilities?: number[];
};

export type Finding = {
  id: string;
  rule: string;
  level: Level;
  edit: Edit;
  /** Exact source text, widened by whole words until it is unique in the body when possible. */
  match: string;
  /** The precise problem inside `match`, as offsets into `match`. */
  focus?: { start: number; end: number };
  span: { start: number; end: number };
  note: string;
  severity: 'flag' | 'warning';
  status: 'open';
  ambiguous?: true;
  judge?: { provider: string; model: string; probability: number; threshold: number; rulesVersion: string };
};
