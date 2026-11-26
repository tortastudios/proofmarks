import { loadConfig } from '../config/index.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
/** Token remains server-side; the browser can only use the guarded Next route. */
export async function companion(
  action: 'status' | 'review' | 'rewrite' | 'cancel-rewrite',
  base: string,
  reviewId?: string,
  findingId?: string,
) {
  try {
    const session = JSON.parse(await readFile(path.join(base, '.proofmarks/session.json'), 'utf8')) as {
      token: string;
      port: number;
      origin: string;
    };
    if (
      !/^[a-f0-9]{64}$/.test(session.token) ||
      !Number.isInteger(session.port) ||
      session.port < 1 ||
      session.port > 65535
    )
      throw new Error('Invalid session');
    const document =
      action === 'review' ? (await loadConfig(base)).documents.find(entry => entry.id === reviewId) : undefined;
    if (action === 'review' && (!document || !document.write))
      return { ok: false, reason: 'Review is outside the writable config.' };
    const response = await fetch(
      `http://127.0.0.1:${session.port}${action === 'rewrite' ? '/rewrite' : `/__proofmarks/${action}`}`,
      {
        method: action === 'status' ? 'GET' : 'POST',
        cache: 'no-store',
        signal: AbortSignal.timeout(action === 'status' ? 2000 : 120000),
        headers: { 'X-Proofmarks-Token': session.token, 'Content-Type': 'application/json' },
        ...(action === 'review'
          ? { body: JSON.stringify({ reviewId }) }
          : action !== 'status'
            ? { body: JSON.stringify({ reviewId, findingId }) }
            : {}),
      },
    );
    if (!response.ok) return { ok: false, connected: false, reason: 'The companion could not complete this request.' };
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, connected: false, reason: 'Proofmarks companion is not running. Start proofmarks serve.' };
  }
}
