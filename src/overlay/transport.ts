import type {
  ProofmarksActionOptions,
  ProofmarksActionResult,
  ProofmarksAgents,
  ProofmarksCompanionStatus,
  ProofmarksFinding,
  ProofmarksReview,
} from './types';

export const startHint = 'Start Proofmarks: npx proofmarks dev';
export type Decision = 'accept' | 'dismiss' | 'revert' | 'restore' | 'request-rewrite' | 'cancel-rewrite';
/** The only browser HTTP boundary. The session token stays in this closure. */
export function createProofmarksTransport(base: string, request: typeof fetch = fetch, endpoint?: string) {
  const prefix = `${base.replace(/\/$/, '')}/__proofmarks/`;
  let session: Promise<{ token: string; project: string; version: string }> | undefined;
  async function json<T>(path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Proofmarks-Token'] = (await getSession()).token;
    }
    const [resource, query] = path.split('?');
    const params = new URLSearchParams(query);
    params.set('action', resource!);
    const url = endpoint ? `${endpoint}?${params}` : prefix + path;
    const response = await request(url, {
      cache: 'no-store',
      ...(body === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(body) }),
    });
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw Error(`Couldn't reach Proofmarks (HTTP ${response.status}).`);
    const value = await response.json();
    if (!response.ok) throw Error(value.reason ?? `Couldn't reach Proofmarks (HTTP ${response.status}).`);
    return value as T;
  }
  function getSession() {
    return (session ??= json<{ token: string; project: string; version: string }>('session').catch(error => {
      session = undefined;
      throw error;
    }));
  }
  return {
    session: getSession,
    match: (url: string, sample: string) =>
      json<{ reviewId: string | null; reason?: string }>('match', { url, sample: sample.slice(0, 4000) }),
    review: (reviewId: string) => json<ProofmarksReview>(`review?reviewId=${encodeURIComponent(reviewId)}`),
    decision: (
      action: Decision,
      reviewId: string,
      review: ProofmarksReview,
      finding?: ProofmarksFinding,
      { expectedCopies, version, another }: ProofmarksActionOptions = {},
    ) =>
      json<ProofmarksActionResult>(action === 'request-rewrite' || action === 'cancel-rewrite' ? action : 'decision', {
        action,
        reviewId,
        id: finding?.id,
        ...(action === 'cancel-rewrite'
          ? {}
          : {
              revision: review.revision,
              ...(review.sourceRevision ? { sourceRevision: review.sourceRevision } : {}),
              source: review.source,
            }),
        ...(expectedCopies ? { expectedCopies } : {}),
        ...(action === 'accept' && version !== undefined ? { version } : {}),
        ...(action === 'request-rewrite' && another ? { another } : {}),
      }),
    recheck: (reviewId: string) => json<ProofmarksActionResult>('review', { reviewId }),
    /** Forget this site's calls on a rule, so its line goes back to the calibrated one. */
    resetStrictness: (rule: string) => json<{ ok: boolean; reason?: string }>('strictness', { rule }),
    agents: () => json<ProofmarksAgents>('agents'),
    target: (target: string) => json<{ ok: boolean; reason?: string }>('target', { target }),
    status: () => json<ProofmarksCompanionStatus>('status'),
    /** The review's change stream (server-sent events), which needs no session token. */
    changes: (reviewId: string) =>
      endpoint
        ? `${endpoint}?${new URLSearchParams({ action: 'changes', reviewId })}`
        : `${prefix}changes?reviewId=${encodeURIComponent(reviewId)}`,
  };
}
