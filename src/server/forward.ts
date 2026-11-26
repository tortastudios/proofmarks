import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config/index';
import { allowedRequest } from './security';
/** Optional host-framework binding: all state and source work stays in the helper. */
export function createProofmarksForwarders({ projectRoot }: { projectRoot: string }) {
  const handle = async (request: Request) => {
    const config = await loadConfig(projectRoot);
    if (!allowedRequest(request, config))
      return Response.json({ ok: false, reason: 'Host/origin not allowed' }, { status: 403 });
    try {
      const state = JSON.parse(await readFile(path.join(config.projectRoot, '.proofmarks/companion.json'), 'utf8')) as {
        port: number;
      };
      if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65535)
        throw new Error('Invalid helper state');
      const incoming = new URL(request.url),
        headers = new Headers(request.headers);
      for (const key of ['host', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']) headers.delete(key);
      const init: RequestInit & { duplex?: 'half' } = {
        method: request.method,
        headers,
        redirect: 'manual',
        signal: request.signal,
        cache: 'no-store',
      };
      if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = request.body;
        init.duplex = 'half';
      }
      const result = await fetch(`http://127.0.0.1:${state.port}${incoming.pathname}${incoming.search}`, init);
      return new Response(result.body, { status: result.status, headers: result.headers });
    } catch {
      return Response.json(
        {
          ok: false,
          connected: false,
          reason: 'Proofmarks helper is offline. Start proofmarks serve or proofmarks dev.',
        },
        { status: 503 },
      );
    }
  };
  return { GET: handle, POST: handle, OPTIONS: handle, handle };
}
