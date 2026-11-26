import { identity, type Decision, type ReviewStore } from './state';

/**
 * Per-site strictness: each rule's line moves with what this site keeps and dismisses, so Proofmarks gets
 * closer to its editors' eye. Only a person's own calls count (Accept and Dismiss; an Undo or a restore takes the mark
 * back out), the line moves in steps of 0.05, and never more than 0.15 from the calibrated line.
 */
export const LEARNING = {
  /** Decided marks on a rule before its line can move. */
  minimum: 8,
  step: 0.05,
  reach: 0.15,
  /** Raising the line must explain this many more calls than leaving it, so one or two clicks can't move it. */
  gain: 3,
  edge: 0.1,
  /** Lowering a step needs this many marks scored just over the line, nearly all of them kept. */
  edgeMinimum: 5,
  keptShare: 0.9,
};

/** One decided mark: Jev's score for it, the line it was shown under, and whether the person kept it. */
export type Outcome = { rule: string; score: number; line: number; kept: boolean; at: string };
/** A rule whose line this site has moved, with the calls that moved it. */
export type Strictness = { rule: string; line: number; base: number; kept: number; dismissed: number };

/** Each mark's last call, across the site's decision logs. */
export function outcomes(events: Decision[]) {
  const last = new Map<string, Outcome>();
  for (const event of events) {
    const finding = event.before?.finding ?? event.after?.finding;
    if (!finding) continue;
    const key = identity(finding);
    if (event.action === 'revert' || event.action === 'restore') {
      last.delete(key);
      continue;
    }
    if (event.action !== 'accept' && event.action !== 'dismiss') continue;
    const score = finding.judge?.probability ?? finding.judge?.score,
      line = finding.judge?.threshold;
    if (typeof score !== 'number' || typeof line !== 'number' || typeof event.timestamp !== 'string') continue;
    last.delete(key);
    last.set(key, { rule: finding.rule, score, line, kept: event.action === 'accept', at: event.timestamp });
  }
  return [...last.values()];
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Where a rule's line sits for this site. Lowering walks down from the calibrated line a step at a time, and only past a
 * line marks were actually shown under, while nearly every mark just over it was kept. Raising fits the line to the calls:
 * the fewest kept marks below it and dismissed marks above it.
 */
export function learnLine(base: number, marks: Outcome[]) {
  const kept = marks.filter(mark => mark.kept).length,
    result = { line: base, base, kept, dismissed: marks.length - kept };
  if (marks.length < LEARNING.minimum) return result;
  const floor = Math.max(0.05, round(base - LEARNING.reach)),
    ceiling = Math.min(0.95, round(base + LEARNING.reach)),
    lowest = Math.min(...marks.map(mark => mark.line));
  let line = base;
  while (round(line - LEARNING.step) >= floor && line >= lowest - 1e-9) {
    const edge = marks.filter(mark => mark.score >= line - 1e-9 && mark.score < line + LEARNING.edge);
    if (edge.length < LEARNING.edgeMinimum || edge.filter(mark => mark.kept).length < LEARNING.keptShare * edge.length)
      break;
    line = round(line - LEARNING.step);
  }
  const fits = (at: number) => marks.filter(mark => mark.score >= at - 1e-9 === mark.kept).length;
  let best = line;
  for (let at = round(line + LEARNING.step); at <= ceiling + 1e-9; at = round(at + LEARNING.step))
    if (fits(at) > fits(best)) best = at;
  if (fits(best) - fits(line) >= LEARNING.gain) line = best;
  return { ...result, line };
}

/** This site's line for each rule with a calibrated one. Resets forget a rule's calls up to then. */
export function siteStrictness(bases: Record<string, number>, marks: Outcome[], resets: Record<string, string> = {}) {
  return Object.entries(bases).map(([rule, base]) => ({
    rule,
    ...learnLine(
      base,
      marks.filter(mark => mark.rule === rule && (!resets[rule] || Date.parse(mark.at) > Date.parse(resets[rule]))),
    ),
  }));
}
/** This site's line for each rule, from every review's decisions and the resets. */
export async function storeStrictness(store: ReviewStore, bases: Record<string, number>) {
  return siteStrictness(bases, outcomes(await store.siteDecisions()), await store.strictnessResets());
}
/** The rules this site has moved, whose lines a review applies. */
export const moved = (lines: Strictness[]) => lines.filter(entry => entry.line !== entry.base);
/** The rules this site has made calls on, which the review records for Settings. */
export const decided = (lines: Strictness[]) => lines.filter(entry => entry.kept + entry.dismissed > 0);
