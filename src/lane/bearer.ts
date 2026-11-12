/**
 * The bearer a lane request carries: `Authorization: Bearer <jwt>`.
 *
 * The lane never verifies the signature. It holds no secret: PostgREST verifies the token on every store
 * call. What this module does is refuse, before any store call, a request with no bearer or with one that
 * cannot be a tenant token. Claims read here are unverified, so they may only ever refuse a request. They
 * never grant anything, and nothing but a log line reads the tenant id this returns.
 */

/** Longer bearers are refused unread. A tenant token is a few hundred bytes. */
export const MAX_BEARER_LENGTH = 8192;

const BEARER = /^bearer[ \t]+(\S+)$/i;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export type LaneBearerProblem = 'missing' | 'malformed';

export type LaneBearer =
  | {
      ok: true;
      /** The token as sent. Never log it. */
      jwt: string;
      /** The tenant_id claim, decoded without verifying. For log lines only. */
      tenantIdForLog: string;
    }
  | { ok: false; problem: LaneBearerProblem };

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A claim value as a log line may carry it: printable, short. */
function forLog(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, '?').slice(0, 64);
}

/**
 * Reads the bearer from an Authorization header value.
 *
 * Refused as `missing`: no Authorization header. Refused as `malformed`: anything but `Bearer` and one
 * token, a token over MAX_BEARER_LENGTH, a token that is not three non-empty base64url segments (so an
 * unsigned token is refused here), a header or payload that is not a JSON object, a `role` claim other
 * than `authenticated`, or a `tenant_id` claim that is not a non-empty string.
 */
export function readLaneBearer(header: string | string[] | undefined): LaneBearer {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.trim() === '') return { ok: false, problem: 'missing' };
  const match = BEARER.exec(raw.trim());
  if (!match) return { ok: false, problem: 'malformed' };
  const jwt = match[1];
  if (jwt.length > MAX_BEARER_LENGTH) return { ok: false, problem: 'malformed' };

  const segments = jwt.split('.');
  if (segments.length !== 3 || !segments.every((s) => SEGMENT.test(s))) {
    return { ok: false, problem: 'malformed' };
  }
  const head = decodeSegment(segments[0]);
  const claims = decodeSegment(segments[1]);
  if (!head || !claims) return { ok: false, problem: 'malformed' };

  // Unverified, so these checks only refuse. PostgREST checks the signature and expiry, and runs the
  // request as the role the verified token names.
  if (claims.role !== 'authenticated') return { ok: false, problem: 'malformed' };
  const tenantId = claims.tenant_id;
  if (typeof tenantId !== 'string' || tenantId.trim() === '') return { ok: false, problem: 'malformed' };

  return { ok: true, jwt, tenantIdForLog: forLog(tenantId) };
}
