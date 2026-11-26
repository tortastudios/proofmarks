import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
export async function nodeFetch(
  request: IncomingMessage,
  response: ServerResponse,
  handle: (request: Request) => Promise<Response>,
) {
  const controller = new AbortController();
  response.once('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers))
      if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
    const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, signal: controller.signal };
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
      init.duplex = 'half';
    }
    const result = await handle(new Request(`http://${request.headers.host ?? 'localhost'}${request.url}`, init));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body && request.method !== 'HEAD')
      Readable.fromWeb(result.body as import('node:stream/web').ReadableStream).pipe(response);
    else response.end();
  } catch {
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, reason: 'The helper could not complete this request.' }));
  }
}
