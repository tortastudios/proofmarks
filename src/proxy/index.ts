import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib';
import { allowedRequest } from '../server/security';
import { loadConfig } from '../config/index';
import { UserError } from '../companion/user-error';
const snippet = '<script src="/__proofmarks/script.js" defer></script>';
/** `port` is one the person chose, so a taken one is an error; without it the proxy tries `preferredPort` (4849) and the 19 after it. */
export async function devProxy(options: {
  projectRoot: string;
  to: string;
  helperPort: number;
  port?: number;
  preferredPort?: number;
}) {
  const config = await loadConfig(options.projectRoot),
    upstream = new URL(options.to);
  if (!['http:', 'https:'].includes(upstream.protocol)) throw new UserError('Proxy target must be HTTP(S).');
  const authorized = (req: IncomingMessage) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
      return allowedRequest(new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { headers }), config);
    } catch {
      return false;
    }
  };
  const targetUrl = (raw: string | undefined, target: URL) => {
    const parsed = new URL(raw ?? '/', target);
    return new URL(parsed.pathname + parsed.search, target);
  };
  const proxy = (req: IncomingMessage, res: ServerResponse) => {
    if (!authorized(req)) {
      res.writeHead(403);
      res.end('Host/origin not allowed');
      return;
    }
    const api = req.url?.startsWith('/__proofmarks/');
    const target = api ? new URL(`http://127.0.0.1:${options.helperPort}`) : upstream;
    const headers = { ...req.headers, host: api ? req.headers.host : target.host };
    const forwarded = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      targetUrl(req.url, target),
      { method: req.method, headers },
      incoming => {
        const outgoing = { ...incoming.headers };
        if (outgoing.location) {
          try {
            const location = new URL(outgoing.location, upstream);
            if (location.origin === upstream.origin) {
              location.host = req.headers.host ?? 'localhost';
              location.protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
              outgoing.location = location.href;
            }
          } catch {
            /* Preserve upstream invalid redirects. */
          }
        }
        const html =
          !api &&
          req.method !== 'HEAD' &&
          incoming.statusCode === 200 &&
          /^text\/html(?:\s*;|$)/i.test(String(outgoing['content-type'] ?? ''));
        if (!html) {
          res.writeHead(incoming.statusCode ?? 502, outgoing);
          incoming.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => {
          try {
            let bytes = Buffer.concat(chunks);
            const encoding = String(outgoing['content-encoding'] ?? '').toLowerCase();
            if (encoding === 'gzip') bytes = gunzipSync(bytes);
            else if (encoding === 'br') bytes = brotliDecompressSync(bytes);
            else if (encoding === 'deflate') bytes = inflateSync(bytes);
            else if (encoding && encoding !== 'identity') throw new Error('Unsupported HTML encoding');
            const text = bytes.toString('utf8'),
              matches = [...text.matchAll(/<\/body\s*>/gi)],
              last = matches.at(-1)?.index;
            const injected = last === undefined ? text + snippet : text.slice(0, last) + snippet + text.slice(last);
            for (const name of [
              'content-length',
              'content-encoding',
              'content-security-policy',
              'content-security-policy-report-only',
              'etag',
              'content-md5',
            ])
              delete outgoing[name];
            res.writeHead(incoming.statusCode ?? 200, outgoing);
            res.end(injected);
          } catch {
            res.writeHead(502);
            res.end('Could not decode upstream HTML.');
          }
        });
        incoming.on('error', () => res.destroy());
      },
    );
    forwarded.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Dev server is unavailable.');
    });
    res.once('close', () => {
      if (!res.writableEnded) forwarded.destroy();
    });
    req.pipe(forwarded);
  };
  const server = createServer(proxy);
  const connections = new Set<import('node:net').Socket>();
  server.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  const originalClose = server.close.bind(server);
  server.close = (callback?: (error?: Error) => void) => {
    for (const socket of connections) socket.destroy();
    return originalClose(callback);
  };
  server.on('upgrade', (req, socket, head) => {
    if (!authorized(req) || req.url?.startsWith('/__proofmarks/')) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const forward = (upstream.protocol === 'https:' ? httpsRequest : httpRequest)(targetUrl(req.url, upstream), {
      headers: { ...req.headers, host: upstream.host },
    });
    forward.on('upgrade', (response, remote, upstreamHead) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` +
          response.rawHeaders.reduce((all, value, i) => all + value + (i % 2 ? '\r\n' : ': '), '') +
          '\r\n',
      );
      if (head.length) remote.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      remote.pipe(socket);
      socket.pipe(remote);
      remote.on('error', () => socket.destroy());
      socket.on('error', () => remote.destroy());
    });
    forward.on('error', () => socket.destroy());
    forward.on('response', () => socket.destroy());
    forward.end();
  });
  const preferred = options.preferredPort ?? 4849;
  const candidates =
    options.port !== undefined
      ? [options.port]
      : Array.from({ length: 20 }, (_, i) => preferred + i).filter(port => port !== options.helperPort);
  for (const port of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return server;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new UserError(
    options.port !== undefined
      ? `Port ${options.port} is in use. Pass --port <n> to use another.`
      : `Ports ${preferred} to ${preferred + 19} are in use. Pass --port <n> to use another.`,
  );
}
