import { prepareBrowserAssets } from './browser-assets';
import { findConfig } from './config';
import { createProofmarksRoutes, type RouteOptions } from '../server/index';
import { nodeFetch } from '../server/node';
import { allowedRequest, corsHeaders, equalToken, limitedJson } from '../server/security';
import { ReviewService } from './service';
import { HeadlessRunner, type RunText } from '../hosts/headless/index';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, realpath, chmod, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { JudgeProvider } from '../judge/types';
import { telemetryOn } from '../judge/relay';
const withinRoot = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
import { reviewFile, RULES_VERSION } from './review';
async function serveLegacy(options: {
  provider: JudgeProvider;
  roots: string[];
  port?: number;
  origin?: string;
  sessionDir?: string;
  cacheDir?: string;
  headlessRun?: RunText;
}) {
  const roots = await Promise.all(options.roots.map(root => realpath(root)));
  if (!roots.length) throw new Error('At least one document root required');
  const service = await ReviewService.create({
    root: roots[0]!,
    provider: options.provider,
    cacheDir: options.cacheDir,
  });
  const runner = new HeadlessRunner(service, options.headlessRun);
  const token = randomBytes(32).toString('hex');
  const origin = options.origin ?? 'http://127.0.0.1:3731';
  const directory = options.sessionDir ?? path.join(homedir(), '.proofmarks');
  let lastReviewTime: string | null = null,
    busy = false;
  const server = createServer(async (request, response) => {
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    if (
      Buffer.byteLength(auth) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(auth), Buffer.from(expected)) ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      send(403, { ok: false, reason: 'Not authorized' });
      return;
    }
    if (request.method === 'GET' && request.url === '/status') {
      send(200, {
        connected: true,
        provider: options.provider.id,
        model: options.provider.model,
        rulesVersion: RULES_VERSION,
        lastReviewTime,
      });
      return;
    }
    if (request.method !== 'POST' || !['/review', '/rewrite', '/cancel-rewrite'].includes(request.url ?? '')) {
      send(404, { ok: false });
      return;
    }
    if (busy && request.url === '/review') {
      send(409, { ok: false, reason: 'Review in progress' });
      return;
    }
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    let acquired = false;
    try {
      if (!request.headers['content-type']?.startsWith('application/json')) {
        send(415, { ok: false });
        return;
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) {
          send(413, { ok: false });
          return;
        }
      }
      const payload = JSON.parse(body) as { path?: unknown; reviewId?: unknown; findingId?: unknown };
      if (request.url !== '/review') {
        if (
          typeof payload.reviewId !== 'string' ||
          typeof payload.findingId !== 'string' ||
          Object.keys(payload).some(key => !['reviewId', 'findingId'].includes(key))
        ) {
          send(400, { ok: false, reason: 'Only review and finding identities are accepted' });
          return;
        }
        send(
          200,
          request.url === '/rewrite'
            ? await runner.start(payload.reviewId, payload.findingId)
            : await runner.cancel(payload.reviewId, payload.findingId),
        );
        return;
      }
      if (typeof payload.path !== 'string') {
        send(400, { ok: false });
        return;
      }
      const file = await realpath(payload.path);
      if (!roots.some(root => withinRoot(root, file))) {
        send(403, { ok: false, reason: 'Document root not allowed' });
        return;
      }
      if (busy) {
        send(409, { ok: false, reason: 'Review in progress' });
        return;
      }
      busy = true;
      acquired = true;
      const review = await reviewFile(file, options.provider, {
        root: roots.find(root => withinRoot(root, file)),
        cacheDir: options.cacheDir,
        signal: controller.signal,
      });
      lastReviewTime = new Date().toISOString();
      send(200, { ok: true, review });
    } catch {
      send(409, { ok: false, reason: 'Review failed; check document path and judge connection' });
    } finally {
      if (acquired) busy = false;
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4848, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const sessionFile = path.join(directory, 'session.json');
  await writeFile(sessionFile, JSON.stringify({ token, port, origin }), { mode: 0o600 });
  await chmod(sessionFile, 0o600);
  server.once('close', () => {
    void runner.close();
    void unlink(sessionFile).catch(() => {});
  });
  return server;
}

export type ServeOptions = Parameters<typeof serveLegacy>[0] & {
  projectRoot?: string;
  onDecision?: RouteOptions['onDecision'];
};
/** The page API never accepts a source path. Configured identities select every file. */
export async function serve(options: ServeOptions) {
  const config = await findConfig(options.projectRoot ?? options.roots[0]!);
  if (!config) return serveLegacy(options);
  const browser = await prepareBrowserAssets();
  const service = await ReviewService.create({
    root: config.roots[0]!,
    provider: options.provider,
    cacheDir: options.cacheDir,
  });
  const runner = new HeadlessRunner(service, options.headlessRun);
  const token = randomBytes(32).toString('hex');
  let lastReviewTime: string | null = null;
  const api = createProofmarksRoutes({
    projectRoot: config.projectRoot,
    token,
    onDecision: options.onDecision,
    companionRequest: async (action, _base, reviewId, findingId) => {
      if (action === 'status')
        return {
          connected: true,
          provider: options.provider.id,
          model: options.provider.model,
          rulesVersion: RULES_VERSION,
          lastReviewTime,
          // What this helper does about usage counts, with its own environment, its owners' and the saved choice.
          usageCounts: telemetryOn(),
        };
      if (!reviewId) return { ok: false, reason: 'Review identity required.' };
      const document = config.documents.find(entry => entry.id === reviewId);
      if (!document?.write) return { ok: false, reason: 'Review is outside the writable config.' };
      if (action === 'review') {
        const result = await service.review(document.sourcePath);
        lastReviewTime = new Date().toISOString();
        return { ok: true, ...result };
      }
      if (!findingId) return { ok: false, reason: 'Finding identity required.' };
      return action === 'rewrite' ? runner.start(reviewId, findingId) : runner.cancel(reviewId, findingId);
    },
  });
  const server = createServer((request, response) => {
    void nodeFetch(request, response, async incoming => {
      const pathname = new URL(incoming.url).pathname;
      if (!allowedRequest(incoming, config))
        return Response.json({ ok: false, reason: 'Host/origin not allowed' }, { status: 403 });
      const asset = pathname.startsWith('/__proofmarks/') ? pathname.slice('/__proofmarks/'.length) : '';
      const content =
        asset === 'script.js'
          ? browser.script
          : asset === 'proofmarks-font.js'
            ? browser.font
            : Object.hasOwn(browser.modules, asset)
              ? browser.modules[asset]
              : undefined;
      if (incoming.method === 'GET' && content !== undefined) {
        return new Response(content, {
          headers: {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            ...corsHeaders(incoming),
          },
        });
      }
      if (pathname === '/rewrite' && incoming.method === 'POST') {
        if (!equalToken(incoming.headers.get('x-proofmarks-token'), token))
          return Response.json({ ok: false }, { status: 403 });
        try {
          const body = await limitedJson(incoming);
          if (
            Object.keys(body).some(key => !['reviewId', 'findingId'].includes(key)) ||
            typeof body.reviewId !== 'string' ||
            typeof body.findingId !== 'string'
          )
            return Response.json(
              { ok: false, reason: 'Only review and finding identities are accepted.' },
              { status: 400 },
            );
          return Response.json(await runner.start(body.reviewId, body.findingId));
        } catch {
          return Response.json({ ok: false, reason: 'Rewrite could not start.' }, { status: 409 });
        }
      }
      if (!pathname.startsWith('/__proofmarks/')) return new Response(null, { status: 404 });
      return api.handle(incoming);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4848, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  const directory = options.sessionDir ?? path.join(config.projectRoot, '.proofmarks');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const sessionFile = path.join(directory, 'session.json');
  await writeFile(sessionFile, JSON.stringify({ token, port, pid: process.pid }), { mode: 0o600 });
  await chmod(sessionFile, 0o600);
  server.once('close', () => {
    void runner.close();
    void unlink(sessionFile).catch(() => {});
  });
  return server;
}
