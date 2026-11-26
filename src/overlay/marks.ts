import type { ProofmarksFinding, ProofmarksRule } from './types';
import { editType } from './registry';
import { acceptedText } from './matcher';
export function markPlan(rule: ProofmarksRule, finding: ProofmarksFinding, lines: number) {
  // Accepted, a rewrite is underlined on its new text, and a deletion that left nothing gets a caret at the gap.
  if (finding.status === 'accepted' || finding.status === 'accepted-unrecorded')
    return { mark: acceptedText(finding).trim() ? ('underline' as const) : ('caret' as const), bracket: false };
  const edit = editType(finding, rule);
  if (edit === 'paragraph') return { mark: 'underline' as const, bracket: true, bracketOnly: true };
  if (edit === 'delete') return { mark: 'strike-through' as const, bracket: false };
  if (edit === 'insert') return { mark: 'caret' as const, bracket: false };
  if (lines > 1 || finding.match.length > 90) return { mark: 'underline' as const, bracket: true };
  const requested = rule.mark ?? 'underline',
    deletion = finding.proposed !== undefined && !finding.proposed.trim();
  return {
    mark:
      (requested === 'strike-through' || requested === 'crossed-off') && !deletion ? ('underline' as const) : requested,
    bracket: false,
  };
}
