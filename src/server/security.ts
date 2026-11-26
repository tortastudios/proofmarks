import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ProofmarksConfig } from '../config/index';
export const createToken = () => randomBytes(32).toString('hex');
export function equalToken(received: string | null, expected: string) {
  const a = Buffer.from(received ?? ''),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export type SecurityConfig = Pick<ProofmarksConfig, 'origins' | 'tailnetHosts' | 'tailscaleUsers'>;
export function allowedRequest(request: Request, config: SecurityConfig) {
  try {
    const authority = request.headers.get('host') ?? new URL(request.url).host;
    const host = new URL(`http://${authority}`);
    if (host.host !== authority || host.username || host.password || host.pathname !== '/') return false;
    const login = request.headers.get('tailscale-user-login') ?? '';
    const tailnet =
      (config.tailnetHosts.includes(host.hostname) || config.tailnetHosts.includes(host.host)) &&
      config.tailscaleUsers.includes(login);
    if (!loopback(host.hostname) && !tailnet) return false;
    const origin = request.headers.get('origin');
    if (!origin) return true;
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
    if (loopback(url.hostname) || config.origins.includes(origin)) return true;
    return (
      config.tailscaleUsers.includes(login) &&
      (config.tailnetHosts.includes(url.hostname) || config.tailnetHosts.includes(url.host))
    );
  } catch {
    return false;
  }
}
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}
export async function limitedJson(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    throw Object.assign(new Error('JSON required.'), { status: 415 });
  const reader = request.body?.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  if (Number(request.headers.get('content-length')) > 65536)
    throw Object.assign(new Error('Request body exceeds 64 KB.'), { status: 413 });
  if (reader)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) {
        await reader.cancel();
        throw Object.assign(new Error('Request body exceeds 64 KB.'), { status: 413 });
      }
      chunks.push(value);
    }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw Object.assign(new Error('JSON object required.'), { status: 400 });
  return body as Record<string, unknown>;
}
