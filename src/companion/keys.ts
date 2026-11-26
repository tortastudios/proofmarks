import { UserError } from './user-error';
import { relayHealth, telemetryOn } from '../judge/relay';
import { MODEL } from '../judge/jev';

// Do not let child processes inherit provider credentials.
export function childEnv() {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  return env;
}
/** A person's own Jev key, from the environment only. Without one, Proofmarks uses Torta's relay and needs no key. */
export const ownKey = () => process.env.TYPESAFE_API_KEY || undefined;
export async function checkJevKey(key: string, request: typeof fetch = fetch) {
  try {
    const response = await request('https://api.typesafe.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('rejected');
    const body = (await response.json()) as { models?: unknown };
    if (!Array.isArray(body.models)) throw new Error('invalid response');
  } catch {
    throw new UserError('Jev rejected the key or could not be reached');
  }
}
/**
 * proofmarks status: how Proofmarks reaches Jev, whether it answers, and whether usage counts are on. Never any key
 * material. When this project's helper is running, `helper` says the same for it, since its environment and owners can
 * differ from this shell's.
 */
export async function judgeStatus(
  deps: {
    key?: string;
    check?: (key: string) => Promise<void>;
    health?: () => Promise<boolean>;
    helper?: () => Promise<{ route: string; usageCounts?: boolean } | undefined>;
  } = {},
) {
  const key = 'key' in deps ? deps.key : ownKey();
  let connected = false;
  if (key) {
    try {
      await (deps.check ?? checkJevKey)(key);
      connected = true;
    } catch {
      /* Do not expose provider payloads or credentials. */
    }
  } else connected = await (deps.health ?? relayHealth)();
  const helper = await deps.helper?.();
  return {
    provider: 'jev',
    model: MODEL,
    route: key ? 'your key' : "Torta's relay",
    connected,
    usageCounts: telemetryOn(),
    ...(helper ? { helper } : {}),
  };
}
