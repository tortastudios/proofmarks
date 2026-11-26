import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Anonymous install tokens: `pm1.<id>.<telemetry>.<signature>`. The id is random, the telemetry flag (1 or 0) records the
 * install's choice when the token was issued, and the HMAC lets the relay check a token with no database. Nothing in a
 * token identifies a person.
 */
export type Install = { id: string; telemetry: boolean };

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64url').slice(0, 32);

export function issueToken(secret: string, telemetry: boolean) {
  const id = randomBytes(16).toString('base64url'),
    body = `pm1.${id}.${telemetry ? 1 : 0}`;
  return { token: `${body}.${sign(secret, body)}`, install: { id, telemetry } };
}

export function verifyToken(secret: string, token: string | undefined): Install | undefined {
  const match = /^pm1\.([A-Za-z0-9_-]{22})\.([01])\.([A-Za-z0-9_-]{32})$/.exec(token ?? '');
  if (!match) return undefined;
  const expected = Buffer.from(sign(secret, `pm1.${match[1]}.${match[2]}`)),
    given = Buffer.from(match[3]!);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? { id: match[1]!, telemetry: match[2] === '1' }
    : undefined;
}

/** The id analytics may see: a one-way hash, so even the analytics store never holds a working token. */
export const analyticsId = (install: Install) =>
  'install_' + createHash('sha256').update(install.id).digest('hex').slice(0, 20);
