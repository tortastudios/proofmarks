import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createJev, MODEL, sanitizedError } from './jev';
import type { JudgeProvider } from './types';

/**
 * Jev through Torta's relay: people need no key of their own. The relay holds Torta's Jev key, forwards the
 * passages being judged and keeps no text. This install is known to it only by an anonymous token, saved in
 * ~/.proofmarks/install.json. Setting TYPESAFE_API_KEY skips the relay and talks to Jev directly.
 */
export const DEFAULT_RELAY = 'https://proofmarks-relay.tortastudios.com';
export const relayUrl = (env: NodeJS.ProcessEnv = process.env) =>
  (env.PROOFMARKS_RELAY_URL || DEFAULT_RELAY).replace(/\/$/, '');
/** Where this machine's choice about usage counts is kept: `proofmarks telemetry on` or `off`. */
export const telemetryFile = (home = homedir()) => path.join(home, '.proofmarks', 'telemetry.json');
const said = (value: string | undefined, words: string[]) => words.includes((value ?? '').trim().toLowerCase());
const YES = ['1', 'on', 'true', 'yes'],
  NO = ['0', 'off', 'false', 'no'];

/**
 * Whether usage counts are on, and what decided it. They're off until the person turns them on, and any
 * off wins: DO_NOT_TRACK=1, then `proofmarks telemetry off`, then PROOFMARKS_TELEMETRY=0. PROOFMARKS_TELEMETRY=1 then
 * turns them on for its process, even in CI. Otherwise a CI run keeps them off, and the saved choice decides. The
 * saved choice is read before every request to the relay, retries included, and before each count, so `proofmarks
 * telemetry off` reaches helpers that are already running, even one started with PROOFMARKS_TELEMETRY=1.
 */
export function telemetryState(env: NodeJS.ProcessEnv = process.env, file = telemetryFile()) {
  if (ownersOff()) return { on: false, by: 'owner' } as const;
  let saved: boolean | undefined;
  try {
    const value = (JSON.parse(readFileSync(file, 'utf8')) as { on?: unknown }).on;
    if (typeof value === 'boolean') saved = value;
  } catch {
    /* No choice saved yet. */
  }
  if (said(env.DO_NOT_TRACK, YES)) return { on: false, by: 'DO_NOT_TRACK' } as const;
  if (saved === false) return { on: false, by: 'saved' } as const;
  if (said(env.PROOFMARKS_TELEMETRY, NO)) return { on: false, by: 'PROOFMARKS_TELEMETRY' } as const;
  if (said(env.PROOFMARKS_TELEMETRY, YES)) return { on: true, by: 'PROOFMARKS_TELEMETRY' } as const;
  if (env.CI?.trim() && !said(env.CI, NO)) return { on: false, by: 'CI' } as const;
  if (saved) return { on: true, by: 'saved' } as const;
  return { on: false, by: 'default' } as const;
}
export const telemetryOn = (env: NodeJS.ProcessEnv = process.env, file = telemetryFile()) =>
  telemetryState(env, file).on;

/** Whether this process's environment turns usage counts off: DO_NOT_TRACK=1, PROOFMARKS_TELEMETRY=0 or a CI run. */
export const envTurnsOff = (env: NodeJS.ProcessEnv = process.env) =>
  said(env.DO_NOT_TRACK, YES) ||
  said(env.PROOFMARKS_TELEMETRY, NO) ||
  (!said(env.PROOFMARKS_TELEMETRY, YES) && !!env.CI?.trim() && !said(env.CI, NO));
let ownersOff = () => false;
/**
 * A helper shared by several processes (an agent's MCP server, `proofmarks dev`) counts nothing while any of them
 * turns counts off in its environment: each one's lease says so, and the helper checks them.
 */
export function setOwnersOff(check: () => boolean) {
  ownersOff = check;
}

/** Saves `proofmarks telemetry on` or `off` for every Proofmarks process on this machine. */
export async function saveTelemetry(on: boolean, file = telemetryFile()) {
  await save(file, { on, decided: new Date().toISOString() });
}
const UNREACHABLE =
  "Couldn't reach Torta's relay. Try again in a moment, or set TYPESAFE_API_KEY to use your own Jev key.";
export const RESTING =
  "Proofmarks' shared judge has reached today's limit and resets at midnight UTC. To keep going now, set TYPESAFE_API_KEY to your own Jev key.";

export type InstallOptions = {
  relay?: string;
  telemetry?: boolean;
  version: string;
  route: string;
  via?: string;
  file?: string;
  request?: typeof fetch;
};
type Saved = { token: string; relay: string; telemetry: boolean; via?: string };
/** A listing's short name, such as mcp-registry: lowercase letters, digits and hyphens. */
export const validVia = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
export const installFile = () => path.join(homedir(), '.proofmarks', 'install.json');

async function stored(file: string): Promise<Partial<Saved>> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return value && typeof value === 'object' ? (value as Partial<Saved>) : {};
  } catch {
    return {};
  }
}
const complete = (value: Partial<Saved>) =>
  typeof value.token === 'string' && typeof value.relay === 'string' && typeof value.telemetry === 'boolean'
    ? (value as Saved)
    : undefined;
async function save(file: string, value: object) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Its own temporary file: concurrent saves in one process must not rename each other's.
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => {});
}

/**
 * Remembers the listing this install came from (init --via), so the first install count can say where people
 * found Proofmarks. A listing's MCP config can set PROOFMARKS_VIA instead. It's sent only while usage counts are on.
 */
export async function rememberVia(via: string, file = installFile()) {
  if (!validVia(via)) throw new Error('Invalid listing name');
  await save(file, { ...(await stored(file)), via });
}

/**
 * This install's token for the relay, asked for once and kept; a new choice about usage counts gets a new token. The
 * token is a key to the shared judge, not a tracking ID: it's random, and while counts are off the relay is told
 * nothing about the install.
 */
export async function installToken(
  {
    relay = relayUrl(),
    telemetry = telemetryOn(),
    version,
    route,
    via = process.env.PROOFMARKS_VIA,
    file = installFile(),
    request = fetch,
  }: InstallOptions,
  fresh = false,
) {
  const kept = await stored(file),
    existing = complete(kept);
  if (!fresh && existing && existing.relay === relay && existing.telemetry === telemetry) return existing.token;
  const listing = validVia(via) ? via : validVia(kept.via) ? kept.via : undefined;
  const response = await request(`${relay}/v1/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      telemetry
        ? { version, route, os: `${process.platform}-${process.arch}`, ...(listing ? { via: listing } : {}), telemetry }
        : { telemetry: false },
    ),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${UNREACHABLE} (Judge failed: status=${response.status} name=RelayInstall)`);
  const { token } = (await response.json()) as { token?: unknown };
  if (typeof token !== 'string') throw new Error(`${UNREACHABLE} (Judge failed: status=unknown name=RelayInstall)`);
  await save(file, { token, relay, telemetry, ...(listing ? { via: listing } : {}) } satisfies Saved);
  return token;
}

/** Jev, reached through the relay with this install's token. Asks for the token on first use, and once more if the relay no longer knows it. */
export function createRelayJev(options: InstallOptions): JudgeProvider {
  let token: Promise<string> | undefined, counted: boolean | undefined;
  const relay = options.relay ?? relayUrl();
  return {
    id: 'jev',
    model: MODEL,
    capabilities: { maxQuestionsPerCall: 32, pricing: 'per-token' },
    async judge(input, questions, opts) {
      for (let attempt = 0; ; attempt++) {
        let asking: Promise<string> | undefined;
        // The choice about counts is read before every request, retries included: one made while this process runs
        // (`proofmarks telemetry off`) gets a token that says so, and so does a new token after a 401. It's read again
        // once the token is in hand, since the choice can change while a new token is on its way.
        const key = async (signal?: AbortSignal) => {
          for (;;) {
            if (signal?.aborted) throw sanitizedError({ name: 'AbortError' });
            const telemetry = options.telemetry ?? telemetryOn();
            if (counted !== telemetry) token = undefined;
            counted = telemetry;
            asking = token ??= installToken({ ...options, relay, telemetry }, attempt > 0).catch(error => {
              token = undefined;
              throw error;
            });
            const value = await asking;
            if ((options.telemetry ?? telemetryOn()) === telemetry) return value;
          }
        };
        try {
          return await createJev(key, undefined, relay).judge(input, questions, opts);
        } catch (error) {
          const message = (error as Error).message;
          if (/status=401\b/.test(message) && attempt === 0) {
            // Calls refused together share one new token: only the first to notice asks for it.
            if (token === asking) token = undefined;
            continue;
          }
          if (/status=503\b/.test(message)) throw new Error(RESTING);
          throw error;
        }
      }
    },
  };
}

/** For `proofmarks status`: whether the relay answers, without asking for a token. */
export async function relayHealth(relay = relayUrl(), request: typeof fetch = fetch) {
  try {
    const response = await request(`${relay}/health`, { signal: AbortSignal.timeout(10000) });
    const body = (await response.json()) as { judging?: unknown };
    return response.ok && body.judging === true;
  } catch {
    return false;
  }
}
