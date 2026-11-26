import { editSpan } from './deletion';
import type { ProofmarksReview } from './types';
import { findingRegion, findingTarget, occurrencesInRegion, sameTarget } from './source-regions.mjs';
/** Source is authoritative. Never invent exact revert history for an unrecorded edit. */
export function reconcileReview(source: string, review: ProofmarksReview) {
  const warnings: string[] = [],
    issues: string[] = [];
  const findings = review.findings.map(finding => {
    const next = { ...finding },
      status = finding.status ?? 'open';
    if (status === 'superseded') return next;
    next.target = findingTarget(source, finding);
    let region;
    try {
      region = findingRegion(source, finding);
    } catch {
      next.actionReason = 'Metadata field is missing or ambiguous.';
      issues.push(`${finding.id}: metadata field is missing or ambiguous.`);
      return next;
    }
    const occurrences = (text?: string) => occurrencesInRegion(region.text, text);
    // A recorded body edit may update this metadata copy without deciding its proof.
    const companionEdited =
      !!next.target &&
      review.findings.some(
        owner =>
          owner.id !== finding.id &&
          owner.status === 'accepted' &&
          !owner.target &&
          owner.edits?.some(
            edit =>
              sameTarget(edit.target, next.target) &&
              occurrencesInRegion(edit.before, finding.match) === 1 &&
              occurrences(edit.after) === 1,
          ),
      );
    const original = occurrences(finding.match),
      before = occurrences(finding.before ?? finding.match);
    const proposed = occurrences(finding.proposed);
    let after = occurrences(finding.after ?? finding.proposed);
    if (finding.after === '' && finding.edits?.length) {
      try {
        for (const edit of finding.edits) {
          if (edit.after === '') editSpan(source, edit);
        }
        after = 1;
      } catch {
        after = 0;
      }
    } else if (after > 1 && finding.edits?.some(edit => !edit.target && edit.context)) {
      // A short rewrite can appear more than once; its recorded context says which copy it is.
      try {
        for (const edit of finding.edits.filter(edit => !edit.target && edit.context)) editSpan(source, edit);
        after = 1;
      } catch {
        // Keep the count: without a context that still fits, the copies are ambiguous.
      }
    }
    if ((status === 'accepted' || status === 'accepted-unrecorded') && after === 0 && before === 1) {
      next.status = 'open';
      delete next.edits;
      delete next.before;
      delete next.after;
      delete next.appliedAt;
      delete next.actionReason;
      warnings.push(`Proofmarks ${finding.id}: accepted text is absent; original text is present. Repaired to open.`);
    } else if (status === 'open' && !companionEdited && original === 0 && proposed === 1) {
      next.status = 'accepted-unrecorded';
      delete next.edits;
      delete next.before;
      delete next.after;
      delete next.appliedAt;
      warnings.push(
        `Proofmarks ${finding.id}: proposed text is present without recorded acceptance. Showing accepted-unrecorded.`,
      );
    }
    const effective = next.status ?? 'open';
    if (effective === 'accepted-unrecorded')
      next.actionReason = 'Accepted text has no exact revert history. Review the source before reverting.';
    if (
      effective === 'open' || effective === 'dismissed'
        ? original !== 1 && !companionEdited
        : effective === 'accepted'
          ? after !== 1
          : proposed !== 1 || original !== 0
    )
      issues.push(`${finding.id}: ${effective} does not have a unique corresponding source match.`);
    return next;
  });
  return { review: { ...review, findings }, warnings, issues };
}
export function assertReviewConsistency(source: string, review: ProofmarksReview) {
  const result = reconcileReview(source, review);
  if (result.warnings.length || result.issues.length)
    throw new Error('Inconsistent Proofmarks source/review pair: ' + [...result.warnings, ...result.issues].join(' '));
}
