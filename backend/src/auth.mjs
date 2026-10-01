// Minimal signed admin session token: base64url(payload).base64url(hmac-sha256).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(String(s)).digest();

export function passwordMatches(input, expected) {
  if (!expected) return false;
  return timingSafeEqual(sha256(input), sha256(expected));
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createToken(secret, ttlMs, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + ttlMs })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  const [payload, signature] = String(token ?? '').split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}
