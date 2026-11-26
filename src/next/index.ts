import { createProofmarksRoutes as createServerRoutes } from '../server/index';
export type { RouteOptions } from '../server/index';
import type { RouteOptions } from '../server/index';
/** Optional Next.js binding; the helper and Next routes share every handler. */
export function createProofmarksRoutes(options: RouteOptions) {
  const routes = createServerRoutes(options);
  const handle = (request: Request) => {
    if (process.env.NODE_ENV !== 'development') return Promise.resolve(new Response(null, { status: 404 }));
    const url = new URL(request.url),
      action = url.searchParams.get('action');
    if (
      action &&
      [
        'session',
        'review',
        'decision',
        'request-rewrite',
        'cancel-rewrite',
        'agents',
        'target',
        'status',
        'match',
        'strictness',
      ].includes(action)
    ) {
      url.pathname = '/__proofmarks/' + action;
      return routes.handle(new Request(url, request));
    }
    return routes.handle(request);
  };
  return { GET: handle, POST: handle, OPTIONS: handle };
}
