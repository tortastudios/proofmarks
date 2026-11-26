import registry from '../../rules/rules.v3.json';
import type { ProofmarksFinding, ProofmarksReview, ProofmarksRule } from './types';
const aliases: Record<string, string> = { actor: 'attribution' };
export function registryRule(id: string) {
  return registry.rules.find(rule => rule.id === (aliases[id] ?? id));
}
export function editType(finding: ProofmarksFinding, rule?: ProofmarksRule) {
  return registryRule(finding.rule)?.edit ?? finding.edit ?? rule?.edit ?? 'replace';
}
/** Keep review IDs and colors stable; names and explanations belong to the registry. */
export function registryReview(review: ProofmarksReview): ProofmarksReview {
  const ids = new Set([...review.rules.map(rule => rule.id), ...review.findings.map(f => f.rule)]);
  return {
    ...review,
    rules: [...ids].map(id => {
      const existing = review.rules.find(rule => rule.id === id),
        rule = registryRule(id);
      if (!rule) return existing ?? { id, label: id, color: '#655347' };
      return {
        ...existing,
        id,
        label: rule.label,
        color: existing?.color ?? '#994b52',
        edit: rule.edit as ProofmarksRule['edit'],
        level: rule.level as ProofmarksRule['level'],
        why: rule.why,
        fix: rule.fix,
        rubric: { checks: rule.why, looksLike: rule.judge?.yes ?? '', notLike: rule.judge?.no ?? '', fix: rule.fix },
      };
    }),
  };
}
