import type { ProofmarksEdit, ProofmarksFinding, ProofmarksTarget } from '../overlay/types';
import { hiddenCopies } from '../overlay/source-regions.mjs';
// supersededFindings: the exact prior state of every proof an Accept retired or carried, which its Undo restores.
export type AffectedFinding = ProofmarksFinding & {
  span?: { start: number; end: number };
  supersededBy?: string;
  carriedBy?: string;
  supersededFindings?: AffectedFinding[];
};
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;
/** All offsets are absolute source offsets. Each edit is expressed in the pre-transaction source. */
function shiftSpan<T extends { start: number; end: number }>(span: T, edits: ProofmarksEdit[]): T {
  if (edits.some(edit => overlaps(span, edit))) return span;
  const delta = edits
    .filter(edit => edit.end <= span.start)
    .reduce((n, edit) => n + edit.after.length - (edit.end - edit.start), 0);
  return delta ? { ...span, start: span.start + delta, end: span.end + delta } : span;
}
function shift(finding: AffectedFinding, edits: ProofmarksEdit[]): AffectedFinding {
  return {
    ...finding,
    ...(finding.span ? { span: shiftSpan(finding.span, edits) } : {}),
    ...(finding.edits ? { edits: finding.edits.map(edit => shiftSpan(edit, edits)) } : {}),
    ...(finding.supersededFindings ? { supersededFindings: finding.supersededFindings.map(f => shift(f, edits)) } : {}),
  };
}
const delta = (edits: ProofmarksEdit[]) =>
  edits.reduce((n, edit) => n + edit.after.length - (edit.end - edit.start), 0);
/**
 * A proof around the accepted text, like a paragraph proof around an accepted sentence, stays open: its own text takes
 * the edit. Undefined when an edit reaches its edge or replaces all of it, since then the proof's own words are gone.
 */
function carried(source: string, located: { start: number; end: number }[], edits: ProofmarksEdit[]) {
  const texts = located.map(span => {
    const inside = edits.filter(edit => overlaps(span, edit));
    if (
      inside.some(
        edit => edit.start < span.start || edit.end > span.end || (edit.start === span.start && edit.end === span.end),
      )
    )
      return undefined;
    return [...inside]
      .sort((a, b) => b.start - a.start)
      .reduce(
        (text, edit) => text.slice(0, edit.start - span.start) + edit.after + text.slice(edit.end - span.start),
        source.slice(span.start, span.end),
      );
  });
  return texts.length && texts.every(text => text !== undefined && text === texts[0]) ? texts[0] : undefined;
}
function spans(
  source: string,
  finding: AffectedFinding,
  locate: (finding: ProofmarksFinding, target?: ProofmarksTarget) => { start: number; end: number },
) {
  const targets: (ProofmarksTarget | undefined)[] = [finding.target, ...hiddenCopies(source, finding)];
  return targets.flatMap(target => {
    try {
      return [locate(finding, target)];
    } catch {
      return [];
    }
  });
}
export function affectedFindings(
  source: string,
  findings: ProofmarksFinding[],
  owner: ProofmarksFinding,
  changed: ProofmarksFinding,
  edits: ProofmarksEdit[],
  undo: boolean,
  locate: (finding: ProofmarksFinding, target?: ProofmarksTarget) => { start: number; end: number },
) {
  const before = owner as AffectedFinding,
    restored = new Map((undo ? (before.supersededFindings ?? []) : []).map(f => [f.id, f]));
  const superseded: AffectedFinding[] = [];
  const transitions: {
    before: ProofmarksFinding;
    after: ProofmarksFinding;
    action: 'supersede' | 'unsupersede' | 'carry' | 'uncarry';
  }[] = [];
  const next = findings.map(input => {
    const finding = input as AffectedFinding;
    if (finding.id === owner.id) return changed;
    if (undo && finding.supersededBy === owner.id && restored.has(finding.id)) {
      const original = structuredClone(restored.get(finding.id)!);
      transitions.push({ before: input, after: original, action: 'unsupersede' });
      return original;
    }
    if (undo && finding.carriedBy === owner.id && restored.has(finding.id)) {
      // Decided since the Accept: keep that decision, and give back only the text and place.
      const original = structuredClone(restored.get(finding.id)!),
        after: AffectedFinding =
          (finding.status ?? 'open') === 'open'
            ? original
            : { ...finding, match: original.match, ...(original.span ? { span: original.span } : {}) };
      delete after.carriedBy;
      transitions.push({ before: input, after, action: 'uncarry' });
      return after;
    }
    const located = !undo && (finding.status ?? 'open') === 'open' ? spans(source, finding, locate) : [];
    if (located.some(span => edits.some(edit => overlaps(span, edit)))) {
      superseded.push(structuredClone(finding));
      const text = carried(source, located, edits);
      if (text !== undefined) {
        // Its rewrite was written for the old text, so it goes; Undo of this Accept brings it back.
        const after: AffectedFinding = { ...finding, match: text, carriedBy: owner.id };
        delete after.rewriteRequest;
        delete after.proposed;
        delete after.proposals;
        if (finding.span) {
          const span = finding.span,
            before = edits.filter(edit => edit.end <= span.start),
            within = edits.filter(edit => edit.start >= span.start && edit.end <= span.end);
          after.span = { start: span.start + delta(before), end: span.end + delta(before) + delta(within) };
        }
        transitions.push({ before: input, after, action: 'carry' });
        return after;
      }
      const after: AffectedFinding = { ...finding, status: 'superseded', supersededBy: owner.id };
      delete after.rewriteRequest;
      transitions.push({ before: input, after, action: 'supersede' });
      return after;
    }
    return shift(finding, edits);
  });
  const accepted = next.find(f => f.id === owner.id)! as AffectedFinding;
  if (!undo && superseded.length) accepted.supersededFindings = superseded;
  if (undo) delete accepted.supersededFindings;
  return { findings: next, transitions };
}
