export { createProofmarksForwarders } from './forward';
import type { ProofmarksFinding, ProofmarksTarget } from '../overlay/types';
import { loadConfig } from '../config/index';
import { allowedRequest, corsHeaders, createToken, equalToken, limitedJson } from './security';
import { rebuild } from './rebuild';
import { matchDocument } from './match';
import { expireClaims } from '../events/index';
import { agentStatus, selectTarget, failRequest, projectStore } from './agents';
import { companion } from './companion';
import {
  requestRewrite,
  applySourceAction,
  availableReview,
  readReview,
  waitForSourceActions,
  waitForReviewActions,
} from './source';
import { changeStream } from './changes';
const processToken = createToken();
export type RouteOptions = {
  projectRoot: string;
  defaultReviewId?: string;
  regenerate?: (reviewId: string) => Promise<void>;
  companionRequest?: typeof companion;
  token?: string;
  /** After a person's Accept, Dismiss or Undo, with the mark as it was before, for decision counts, which go out only if the person turned usage counts on. */
  onDecision?: (action: 'accept' | 'dismiss' | 'revert' | 'restore', finding: ProofmarksFinding) => void;
};
/** Guarded dev handlers. The host owns its content compiler; config owns document identity and writes. */
export function createProofmarksRoutes({
  projectRoot,
  defaultReviewId,
  regenerate,
  companionRequest = companion,
  token = processToken,
  onDecision,
}: RouteOptions) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const rejectedRequests = new Set<string>();
  function rejected(request: Request, reason: string, status: number) {
    if (process.env.NODE_ENV === 'development') {
      const key = `${request.method} ${new URL(request.url).pathname}: ${reason}`;
      if (!rejectedRequests.has(key)) {
        rejectedRequests.add(key);
        console.warn(`[Proofmarks dev guard] ${key} (${status})`);
      }
    }
    return status === 404 ? new Response(null, { status }) : json({ ok: false, reason }, status);
  }
  async function GET(request: Request) {
    if (
      new URL(request.url).searchParams.get('action') === 'changes' ||
      new URL(request.url).pathname.endsWith('/changes')
    )
      return changeStream(projectRoot, request, new URL(request.url).searchParams.get('reviewId') ?? defaultReviewId);
    if (
      new URL(request.url).searchParams.get('action') === 'agents' ||
      new URL(request.url).pathname.endsWith('/agents')
    )
      return json(await agentStatus(projectRoot));
    if (
      new URL(request.url).searchParams.get('action') === 'status' ||
      new URL(request.url).pathname.endsWith('/status')
    )
      return json(await companionRequest('status', projectRoot));
    try {
      await waitForSourceActions();
      await waitForReviewActions(projectRoot, new URL(request.url).searchParams.get('reviewId') ?? defaultReviewId);
      await expireClaims(await projectStore(projectRoot));
      return json(
        availableReview(
          await readReview(projectRoot, new URL(request.url).searchParams.get('reviewId') ?? defaultReviewId),
        ),
      );
    } catch (error) {
      return json({ ok: false, reason: (error as Error).message }, 409);
    }
  }
  async function POST(request: Request) {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return rejected(request, 'JSON required.', 415);
    try {
      const body = (await limitedJson(request)) as Record<string, unknown> & {
        action: string;
        target: string;
        reviewId: string;
        findingId?: string;
        id?: string;
        revision: string;
        sourceRevision?: string;
        source?: string;
        expectedCopies?: ProofmarksTarget[];
        version?: number;
        another?: boolean;
      };
      const route = new URL(request.url).pathname.split('/').at(-1) ?? '';
      if (route === 'match') return json(await matchDocument(projectRoot, body));
      if (route === 'strictness') {
        // Reset: forget this site's calls on a rule, so its line goes back to the calibrated one.
        if (Object.keys(body).some(key => key !== 'rule') || !/^[a-z0-9-]{1,40}$/.test(String(body.rule)))
          return rejected(request, 'Invalid rule.', 400);
        await (await projectStore(projectRoot)).resetStrictness(String(body.rule));
        return json({ ok: true });
      }
      if (['review', 'request-rewrite', 'cancel-rewrite', 'target'].includes(route)) body.action = route;
      const fields =
        body.action === 'target'
          ? ['action', 'target']
          : body.action === 'review'
            ? ['action', 'reviewId']
            : body.action === 'cancel-rewrite'
              ? ['action', 'reviewId', 'findingId', 'id']
              : [
                  'action',
                  'id',
                  'findingId',
                  'revision',
                  'sourceRevision',
                  'reviewId',
                  'source',
                  'expectedCopies',
                  'version',
                  'another',
                ];
      if (Object.keys(body).some(key => !fields.includes(key)))
        return rejected(request, 'Only documented identity fields are accepted.', 400);
      if (body.action === 'target' || new URL(request.url).pathname.endsWith('/target')) {
        if (typeof body.target !== 'string') return rejected(request, 'Invalid target.', 400);
        return json({ ok: true, ...(await selectTarget(projectRoot, body.target)) });
      }
      if (body.action === 'cancel-rewrite') {
        const one = body.findingId ?? body.id;
        if (typeof body.reviewId !== 'string' || (one !== undefined && typeof one !== 'string'))
          return rejected(request, 'Invalid cancellation.', 400);
        // Without a finding, one Cancel stops every rewrite still waiting in this review.
        const ids =
          one !== undefined
            ? [one]
            : (await readReview(projectRoot, body.reviewId)).review.findings
                .filter(f => ['pending', 'claimed'].includes(f.rewriteRequest?.status ?? ''))
                .map(f => f.id);
        for (const id of ids) {
          await failRequest(projectRoot, body.reviewId, id, 'Cancelled');
          await companionRequest('cancel-rewrite', projectRoot, body.reviewId, id);
        }
        return json({ ok: true, review: availableReview(await readReview(projectRoot, body.reviewId)) });
      }
      if (body.action === 'review' && typeof body.reviewId === 'string') {
        const result = await companionRequest('review', projectRoot, body.reviewId);
        return json(result, result.ok === false ? 409 : 200);
      }
      if (body.action === 'request-rewrite') {
        if (
          Object.keys(body).some(
            key =>
              !['action', 'reviewId', 'id', 'findingId', 'revision', 'sourceRevision', 'source', 'another'].includes(
                key,
              ),
          )
        )
          return rejected(request, 'Only review and finding identities are accepted for rewrite requests.', 400);
        if (
          typeof body.revision !== 'string' ||
          (body.sourceRevision !== undefined && typeof body.sourceRevision !== 'string') ||
          typeof body.reviewId !== 'string' ||
          (body.findingId !== undefined && typeof body.findingId !== 'string') ||
          (body.id !== undefined && typeof body.id !== 'string') ||
          (body.source !== undefined && typeof body.source !== 'string') ||
          (body.another !== undefined && typeof body.another !== 'boolean')
        )
          return rejected(request, 'Invalid rewrite request.', 400);
        let review = await requestRewrite(
          projectRoot,
          body.revision,
          body.reviewId,
          body.findingId ?? body.id,
          body.source,
          body.another === true,
          body.sourceRevision,
        );
        for (const finding of review.findings) {
          const request = finding.rewriteRequest;
          if (request?.status === 'pending' && request.target?.startsWith('headless:')) {
            const result = await companionRequest('rewrite', projectRoot, body.reviewId, finding.id);
            if (result.ok === false)
              await failRequest(
                projectRoot,
                body.reviewId,
                finding.id,
                String(result.reason ?? 'Proofmarks companion is not running. Start proofmarks serve.'),
              );
          }
        }
        review = availableReview(await readReview(projectRoot, body.reviewId));
        return json({ ok: true, review });
      }
      if (
        typeof body.id !== 'string' ||
        typeof body.revision !== 'string' ||
        typeof body.reviewId !== 'string' ||
        !['accept', 'dismiss', 'revert', 'restore'].includes(body.action) ||
        (body.source !== undefined && typeof body.source !== 'string') ||
        (body.sourceRevision !== undefined && typeof body.sourceRevision !== 'string') ||
        body.another !== undefined ||
        (body.version !== undefined &&
          (body.action !== 'accept' || !Number.isInteger(body.version) || body.version < 1))
      )
        return rejected(request, 'Invalid action.', 400);
      if (
        body.expectedCopies !== undefined &&
        (!Array.isArray(body.expectedCopies) ||
          body.expectedCopies.some(
            (t: Record<string, unknown>) =>
              !t ||
              t.kind !== 'meta' ||
              !['description', 'summary', 'takeaways'].includes(String(t.field)) ||
              (t.field === 'takeaways' ? !Number.isInteger(t.index) || Number(t.index) < 0 : t.index !== undefined),
          ))
      )
        return rejected(request, 'Invalid metadata targets.', 400);
      const timing: string[] = [];
      const before = onDecision
        ? (await readReview(projectRoot, body.reviewId).catch(() => undefined))?.review.findings.find(
            finding => finding.id === body.id,
          )
        : undefined;
      const review = await applySourceAction(
        projectRoot,
        body.id,
        body.action as import('./source').Action,
        body.revision,
        body.source,
        async () => {
          if (regenerate) await regenerate(body.reviewId);
          else await rebuild(projectRoot);
        },
        (name, ms) => timing.push(`${name};dur=${ms.toFixed(2)}`),
        body.reviewId,
        body.expectedCopies,
        body.version,
        body.sourceRevision,
      );
      if (before) onDecision?.(body.action as 'accept' | 'dismiss' | 'revert' | 'restore', before);
      return Response.json(
        { ok: true, review },
        { headers: { 'Cache-Control': 'no-store', 'Server-Timing': timing.join(', ') } },
      );
    } catch (error) {
      return json({ ok: false, reason: (error as Error).message }, (error as { status?: number }).status ?? 409);
    }
  }

  async function handle(request: Request) {
    let config;
    try {
      config = await loadConfig(projectRoot);
    } catch {
      return json({ ok: false, reason: 'Project configuration is unavailable.' }, 409);
    }
    if (!allowedRequest(request, config)) return rejected(request, 'Host/origin not allowed', 403);
    const route = new URL(request.url).pathname.split('/').at(-1) ?? '';
    const legacy = ['proofmarks', 'review.json', ''].includes(route);
    if (
      !legacy &&
      ![
        'session',
        'review',
        'changes',
        'agents',
        'status',
        'decision',
        'match',
        'request-rewrite',
        'cancel-rewrite',
        'target',
        'strictness',
      ].includes(route)
    )
      return json({ ok: false, reason: 'Unknown endpoint.' }, 404);
    if (request.method === 'GET' && !legacy && !['session', 'review', 'changes', 'agents', 'status'].includes(route))
      return json({ ok: false, reason: 'Method not allowed.' }, 405);
    if (request.method === 'POST' && !legacy && ['session', 'changes', 'agents', 'status'].includes(route))
      return json({ ok: false, reason: 'Method not allowed.' }, 405);
    let response: Response;
    if (request.method === 'OPTIONS')
      response = new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Proofmarks-Token',
          'Access-Control-Max-Age': '600',
        },
      });
    else if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/session'))
      response = json({ token, project: config.projectRoot, version: '0.0.0' });
    else if (request.method === 'GET') response = await GET(request);
    else if (request.method === 'POST')
      response = equalToken(request.headers.get('x-proofmarks-token'), token)
        ? await POST(request)
        : rejected(request, 'Invalid session token.', 403);
    else response = json({ ok: false, reason: 'Method not allowed.' }, 405);
    for (const [key, value] of Object.entries(corsHeaders(request))) response.headers.set(key, value);
    return response;
  }
  return { GET: handle, POST: handle, OPTIONS: handle, handle, token };
}
