import { compareSourcePosition } from '../finding-order';
import type { ProofmarksFinding } from './types';
export const visibleProofs = (findings: readonly ProofmarksFinding[]) =>
  findings.filter(f => f.status !== 'superseded');
export const proofSet = (findings: ProofmarksFinding[], mode: 'open' | 'reviewed') =>
  visibleProofs(findings).filter(f => ((f.status ?? 'open') === 'open') === (mode === 'open'));
/** Step in original document order, even after the current proof leaves its set. */
export function stepProof(
  findings: ProofmarksFinding[],
  id: string | undefined,
  direction: number,
  mode: 'open' | 'reviewed',
) {
  const start = findings.findIndex(f => f.id === id),
    length = findings.length;
  for (let n = 1; n <= length; n++) {
    const i = ((start < 0 ? (direction > 0 ? -1 : 0) : start) + direction * n + length * (n + 1)) % length,
      f = findings[i]!;
    if (f.status !== 'superseded' && ((f.status ?? 'open') === 'open') === (mode === 'open')) return f;
  }
  return undefined;
}
/** Raise perceptual lightness and reduce chroma on ink; page marks stay unchanged. */
export const lightRuleColor = (color: string) => `oklch(from ${color} .8 calc(c * .7) h)`;

/** Located proofs precede missing source spans, with hidden copy last. */
export const orderProofs = (findings: ProofmarksFinding[], ranks: ReadonlyMap<string, number> = new Map()) =>
  [...visibleProofs(findings)].sort(
    (a, b) =>
      Number(!!a.target) - Number(!!b.target) ||
      (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) ||
      compareSourcePosition(a, b),
  );

/** Keep established identities in place through in-place Accept/Undo text edits. */
export class ProofOrder {
  private anchors = new Map<string, Range>();
  private ranks = new Map<string, number>();
  reset() {
    this.anchors.clear();
    this.ranks.clear();
  }
  order(findings: ProofmarksFinding[], matches: readonly { finding: ProofmarksFinding; range: Range | null }[]) {
    let added = false;
    for (const match of matches)
      if (match.range && !match.finding.target && !this.anchors.has(match.finding.id)) {
        this.anchors.set(match.finding.id, match.range.cloneRange());
        added = true;
      }
    if (added) {
      const located = findings.filter(f => this.anchors.has(f.id));
      located.sort((a, b) => {
        const ar = this.ranks.get(a.id),
          br = this.ranks.get(b.id);
        if (ar !== undefined && br !== undefined) return ar - br;
        const x = this.anchors.get(a.id)!,
          y = this.anchors.get(b.id)!;
        return x.compareBoundaryPoints(0, y) || y.compareBoundaryPoints(2, x);
      });
      located.forEach((finding, index) => this.ranks.set(finding.id, index));
    }
    return orderProofs(findings, this.ranks);
  }
}
export const pageAnchorReason = (finding: ProofmarksFinding, located: boolean) =>
  !finding.target && (finding.status ?? 'open') === 'open' && !located
    ? "Couldn't find this text on the page."
    : undefined;

/** D keeps decided proofs in place; its pager crosses every proof. */
export function stepAllProofs(findings: ProofmarksFinding[], id: string | undefined, direction: number) {
  findings = visibleProofs(findings);
  if (!findings.length) return;
  const i = findings.findIndex(f => f.id === id),
    start = i < 0 ? (direction > 0 ? -1 : 0) : i;
  return findings[(start + direction + findings.length) % findings.length];
}
