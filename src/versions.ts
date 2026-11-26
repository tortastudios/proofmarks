export type RewriteVersion = {
  version: number;
  text: string;
  by?: string;
  proposedAt?: string;
  stillFlagged?: boolean;
};
type Versioned = {
  proposed?: string;
  proposals?: RewriteVersion[];
  rewriteRequest?: { status: string; by?: string; proposedAt?: string; stillFlagged?: boolean; version?: number };
};
/** Every rewrite a finding has received, oldest first. A review saved before versions holds one proposal: version 1. */
export function rewriteVersions(finding: Versioned): RewriteVersion[] {
  if (finding.proposals?.length) return finding.proposals;
  if (finding.proposed === undefined) return [];
  const request = finding.rewriteRequest;
  return [
    {
      version: 1,
      text: finding.proposed,
      ...(request?.by ? { by: request.by } : {}),
      ...(request?.proposedAt ? { proposedAt: request.proposedAt } : {}),
      ...(request?.stillFlagged ? { stillFlagged: true } : {}),
    },
  ];
}
export const nextVersion = (finding: Versioned) => Math.max(0, ...rewriteVersions(finding).map(v => v.version)) + 1;
/** The version an open request will produce; undefined when nothing is waiting. */
export function waitingVersion(finding: Versioned) {
  const request = finding.rewriteRequest;
  return request && (request.status === 'pending' || request.status === 'claimed')
    ? (request.version ?? nextVersion(finding))
    : undefined;
}
