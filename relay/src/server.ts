import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliDecompress, gunzip, inflate, zstdDecompress } from 'node:zlib';
import { Analytics, type Decision } from './analytics.ts';
import { Limits, defaultLimits, type LimitConfig } from './limits.ts';
import { analyticsId, issueToken, verifyToken } from './token.ts';
import { slackMessage, validFeedback } from './feedback.ts';

/**
 * The Proofmarks relay: Torta's Jev key stays here, so people use Proofmarks with no key of their own.
 * Proofmarks sends the passages it's judging; the relay checks the request is one of Proofmarks' own, forwards it to Jev
 * and returns the answer. It never stores or logs text. What it keeps is in memory: request counts for rate limits and
 * the daily spend cap, which it enforces from its own counters. Usage counts go to PostHog only for installs that turned
 * them on (see analytics.ts), including hourly totals of what people did with marks, which tune each rule's line for
 * everyone. Agents' feedback reports go to Torta's Slack (see feedback.ts).
 */
export type RelayConfig = {
  jevKey?: string;
  tokenSecret?: string;
  upstream: string;
  models: string[];
  pricePerMillion: number;
  posthog: { apiKey?: string; host: string };
  alertWebhook?: string;
  feedbackWebhook?: string;
  limits: LimitConfig;
};
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  // Unset, the relay still starts (so a new deployment passes its health check before its secrets are added) but turns
  // installs away. Set too short, it refuses to start.
  if (env.TOKEN_SECRET !== undefined && env.TOKEN_SECRET.length < 32)
    throw new Error('TOKEN_SECRET must be 32 or more characters');
  const number = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    jevKey: env.TYPESAFE_API_KEY || undefined,
    tokenSecret: env.TOKEN_SECRET || undefined,
    upstream: (env.UPSTREAM_URL || 'https://api.typesafe.ai').replace(/\/$/, ''),
    models: (env.MODELS || 'jev-1.14.0')
      .split(',')
      .map(model => model.trim())
      .filter(Boolean),
    pricePerMillion: number('PRICE_PER_MILLION', 0.042),
    posthog: { apiKey: env.POSTHOG_API_KEY || undefined, host: env.POSTHOG_HOST || 'https://us.i.posthog.com' },
    feedbackWebhook: env.SLACK_FEEDBACK_WEBHOOK_URL || undefined,
    alertWebhook: env.SLACK_ALERT_WEBHOOK_URL || env.SLACK_FEEDBACK_WEBHOOK_URL || undefined,
    limits: {
      ...defaultLimits,
      dollarsPerDay: number('DAILY_SPEND_CAP_USD', defaultLimits.dollarsPerDay),
      dollarsPerInstallPerDay: number('INSTALL_DAILY_SPEND_USD', defaultLimits.dollarsPerInstallPerDay),
    },
  };
}

const MAX_BODY = 64 * 1024;
const RESTING =
  "Proofmarks' shared judge has reached today's limit and resets at midnight UTC. To keep going now, set TYPESAFE_API_KEY to your own Jev key.";
const label = /^[A-Za-z0-9 ._+-]{1,40}$/;
const unit = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;
/** One count of a person's call on a mark, with nothing else in it. */
export function validDecision(body: unknown): body is Decision {
  const value = body as Record<string, unknown>;
  return (
    !!value &&
    typeof value === 'object' &&
    Object.keys(value).every(key => ['rule', 'action', 'score', 'line', 'model', 'rulesVersion'].includes(key)) &&
    typeof value.rule === 'string' &&
    /^[a-z0-9-]{1,40}$/.test(value.rule) &&
    ['kept', 'dismissed', 'undone', 'restored'].includes(String(value.action)) &&
    unit(value.score) &&
    unit(value.line) &&
    typeof value.model === 'string' &&
    label.test(value.model) &&
    typeof value.rulesVersion === 'string' &&
    /^[A-Za-z0-9._-]{1,12}$/.test(value.rulesVersion)
  );
}

/** A Jev request exactly as Proofmarks builds it (src/judge/jev.ts), within size limits; anything else is refused. */
export function validJudgeRequest(body: unknown, models: string[]) {
  const value = body as {
    model?: unknown;
    state?: { target?: unknown; context?: unknown };
    questions?: Record<string, unknown>;
  } | null;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some(key => !['model', 'state', 'questions'].includes(key))
  )
    return false;
  if (typeof value.model !== 'string' || !models.includes(value.model)) return false;
  const state = value.state;
  if (!state || typeof state !== 'object' || Object.keys(state).some(key => !['target', 'context'].includes(key)))
    return false;
  if (typeof state.target !== 'string' || !state.target || state.target.length > 8000) return false;
  if (state.context !== undefined && (typeof state.context !== 'string' || state.context.length > 24000)) return false;
  const questions = value.questions;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) return false;
  const entries = Object.entries(questions);
  if (!entries.length || entries.length > 32) return false;
  return entries.every(([id, question]) => {
    const q = question as {
      type?: unknown;
      instructions?: unknown;
      criteria?: { true?: unknown; false?: unknown };
    } | null;
    if (
      !/^[A-Za-z0-9_.:-]{1,80}$/.test(id) ||
      !q ||
      typeof q !== 'object' ||
      q.type !== 'noul' ||
      typeof q.instructions !== 'string' ||
      q.instructions.length > 4000
    )
      return false;
    if (Object.keys(q).some(key => !['type', 'instructions', 'criteria'].includes(key))) return false;
    return (
      q.criteria === undefined ||
      (typeof q.criteria === 'object' &&
        typeof q.criteria.true === 'string' &&
        typeof q.criteria.false === 'string' &&
        q.criteria.true.length <= 2000 &&
        q.criteria.false.length <= 2000)
    );
  });
}

// The TypeSafe SDK compresses request bodies of 1 KB or more with zstd (Content-Encoding), as Jev's own API accepts.
// The size limit applies to the unpacked body too, so a small compressed request can't unpack into a large one.
const unzstd = promisify(zstdDecompress),
  unzip = promisify(gunzip),
  uninflate = promisify(inflate),
  unbrotli = promisify(brotliDecompress);
const decoders: Record<string, (data: Uint8Array, maxOutputLength: number) => Promise<Uint8Array>> = {
  zstd: (data, maxOutputLength) => unzstd(data, { maxOutputLength }),
  gzip: (data, maxOutputLength) => unzip(data, { maxOutputLength }),
  deflate: (data, maxOutputLength) => uninflate(data, { maxOutputLength }),
  br: (data, maxOutputLength) => unbrotli(data, { maxOutputLength }),
};
async function readJson(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  const encoding = String(request.headers['content-encoding'] ?? 'identity')
    .trim()
    .toLowerCase();
  let body: Uint8Array = Buffer.concat(chunks);
  if (encoding !== 'identity') {
    const decode = decoders[encoding];
    if (!decode) throw Object.assign(new Error('encoding'), { status: 415 });
    try {
      body = await decode(body, MAX_BODY);
    } catch (error) {
      const tooLarge = (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE';
      throw Object.assign(new Error(tooLarge ? 'too large' : 'bad json'), { status: tooLarge ? 413 : 400 });
    }
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}
const send = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
};

export function createRelay(config: RelayConfig, deps: { request?: typeof fetch; now?: () => number } = {}) {
  const request = deps.request ?? fetch,
    limits = new Limits(config.limits, deps.now),
    analytics = new Analytics(config.posthog, request, deps.now);
  const alert = async (text: string) => {
    if (config.alertWebhook)
      await request(config.alertWebhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
  };
  const bearer = (incoming: IncomingMessage) => /^Bearer (\S+)$/.exec(incoming.headers.authorization ?? '')?.[1];

  async function handle(incoming: IncomingMessage, response: ServerResponse) {
    const url = new URL(incoming.url ?? '/', 'http://relay'),
      route = `${incoming.method} ${url.pathname}`;
    try {
      const secret = config.tokenSecret;
      if (route === 'GET /' || route === 'GET /health') {
        send(response, 200, { ok: true, service: 'proofmarks-relay', judging: !!config.jevKey && !!secret });
        return;
      }
      if (!secret) {
        send(response, 503, { error: "The relay isn't set up yet." });
        return;
      }
      if (route === 'POST /v1/install') {
        const body = (await readJson(incoming)) as {
          version?: unknown;
          route?: unknown;
          os?: unknown;
          via?: unknown;
          telemetry?: unknown;
        };
        const address =
          String(incoming.headers['x-forwarded-for'] ?? '')
            .split(',')[0]!
            .trim() ||
          incoming.socket.remoteAddress ||
          'unknown';
        if (!limits.checkInstall(address)) {
          send(response, 429, { error: 'Too many new installs from this network today.' });
          return;
        }
        // Counted only when the install says so: a missing or malformed choice is off.
        const telemetry = body.telemetry === true,
          issued = issueToken(secret, telemetry);
        if (
          telemetry &&
          [body.version, body.route, body.os].every(value => typeof value === 'string' && label.test(value))
        ) {
          // via is the listing the install came from, when the listing said; a malformed one is left out.
          const via =
            typeof body.via === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(body.via) ? { via: body.via } : {};
          analytics.install(analyticsId(issued.install), {
            version: String(body.version),
            route: String(body.route),
            os: String(body.os),
            ...via,
          });
        }
        send(response, 200, { token: issued.token, telemetry });
        return;
      }
      const install = verifyToken(secret, bearer(incoming));
      if (url.pathname.startsWith('/v1/') && !install) {
        send(response, 401, { error: 'Unknown install token.' });
        return;
      }
      if (route === 'GET /v1/models') {
        send(response, 200, { models: config.models.map(id => ({ id })) });
        return;
      }
      if (route === 'POST /v1/feedback' && install) {
        if (!config.feedbackWebhook) {
          send(response, 503, { error: 'Feedback is not set up on the relay.' });
          return;
        }
        const body = await readJson(incoming);
        if (!validFeedback(body)) {
          send(response, 400, { error: "That isn't a Proofmarks feedback report." });
          return;
        }
        if (!limits.checkFeedback(install.id)) {
          send(response, 429, { error: 'Too much feedback from this install today.' }, { 'retry-after': '3600' });
          return;
        }
        const posted = await request(config.feedbackWebhook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(slackMessage(body)),
          signal: AbortSignal.timeout(10000),
        });
        if (!posted.ok) {
          send(response, 502, { error: 'Feedback could not be delivered.' });
          return;
        }
        limits.recordFeedback(install.id);
        if (install.telemetry) analytics.feedback(body.kind);
        send(response, 200, { ok: true });
        return;
      }
      if (route === 'POST /v1/decisions' && install) {
        const body = await readJson(incoming);
        if (!validDecision(body)) {
          send(response, 400, { error: "That isn't a Proofmarks decision count." });
          return;
        }
        if (install.telemetry && limits.takeDecision(install.id))
          analytics.decision({
            rule: body.rule,
            action: body.action,
            score: Math.floor(body.score * 20 + 1e-9) / 20,
            line: Math.round(body.line * 100) / 100,
            model: body.model,
            rulesVersion: body.rulesVersion,
          });
        send(response, 200, { ok: true });
        return;
      }
      if (route === 'POST /v1/systemone' && install) {
        if (!config.jevKey) {
          send(response, 503, { error: 'The relay has no Jev key yet.' });
          return;
        }
        const body = await readJson(incoming);
        if (!validJudgeRequest(body, config.models)) {
          send(response, 400, { error: "That isn't a Proofmarks judge request." });
          return;
        }
        const refused = limits.checkCall(install.id);
        if (refused === 'resting') {
          send(response, 503, { error: RESTING });
          return;
        }
        if (refused) {
          send(response, 429, { error: 'Too many judge calls; slow down.' }, { 'retry-after': '60' });
          return;
        }
        const upstream = await request(`${config.upstream}/v1/systemone`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.jevKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        const text = await upstream.text();
        let inputTokens = 0;
        try {
          const tokens = (JSON.parse(text) as { usage?: { input_tokens?: unknown } }).usage?.input_tokens;
          if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) inputTokens = tokens;
        } catch {
          /* Counted as a call with no tokens. */
        }
        const dollars = (inputTokens * config.pricePerMillion) / 1e6;
        limits.recordCall(install.id, inputTokens, dollars);
        if (install.telemetry) analytics.call(analyticsId(install), inputTokens, dollars);
        for (const share of limits.spendAlerts())
          void alert(
            `Proofmarks relay: ${Math.round(share * 100)}% of today's $${config.limits.dollarsPerDay} Jev budget used.`,
          );
        const headers: Record<string, string> = {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          'cache-control': 'no-store',
        };
        const retry = upstream.headers.get('retry-after');
        if (retry) headers['retry-after'] = retry;
        response.writeHead(upstream.status, headers);
        response.end(text);
        return;
      }
      send(response, 404, { error: 'Not found.' });
    } catch (error) {
      const status = (error as { status?: number }).status;
      // Never log request contents; the error's kind is enough.
      if (!status) console.error(`relay error on ${route}: ${(error as Error).name}`);
      if (!response.headersSent)
        send(response, status ?? 502, {
          error:
            status === 413
              ? 'Request too large.'
              : status === 415
                ? 'Send the request uncompressed, or compressed with zstd, gzip, deflate or br.'
                : status === 400
                  ? 'Request is not JSON.'
                  : 'The judge could not be reached.',
        });
    }
  }
  return { handle, flush: () => analytics.flush(), limits, analytics };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const relay = createRelay(configFromEnv());
  const server = createServer((incoming, response) => void relay.handle(incoming, response));
  const timer = setInterval(() => void relay.flush(), 3_600_000);
  timer.unref();
  server.listen(Number(process.env.PORT ?? 8080), () =>
    console.log(`proofmarks relay listening on ${Number(process.env.PORT ?? 8080)}`),
  );
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      server.close();
      void relay.flush().finally(() => process.exit(0));
    });
}
