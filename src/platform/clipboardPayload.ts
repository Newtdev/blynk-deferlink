const PREFIX = 'sparkle_ref:v1:';

export interface ParsedClipboardReferral {
  code: string;
  issuedAt: number;
}

/**
 * Parses and validates a clipboard payload written by
 * `writeClipboardReferral()` on the web landing page (see
 * @sparkle/referral-web). Returns null for anything that doesn't match the
 * expected shape, is malformed, or has aged past `maxAgeSeconds` — a stray
 * clipboard value (a password, an unrelated copied link) is never mistaken
 * for a match. This is what makes the deterministic tier self-validating
 * without a network round trip.
 *
 * `now` defaults to the real current time; tests pass an explicit value —
 * same pattern as fingerprintMatcher.ts's recency scoring, for the same
 * reason (deterministic boundary behavior without wall-clock flakiness).
 */
export function parseClipboardReferralPayload(
  raw: string | null | undefined,
  maxAgeSeconds: number,
  now: number = Date.now(),
): ParsedClipboardReferral | null {
  if (!raw?.startsWith(PREFIX)) return null;

  const rest = raw.slice(PREFIX.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon === -1) return null;

  const code = rest.slice(0, lastColon);
  const issuedAtRaw = rest.slice(lastColon + 1);
  const issuedAt = Number(issuedAtRaw);

  if (!code || !Number.isFinite(issuedAt)) return null;

  const ageSeconds = now / 1000 - issuedAt;
  // Negative age means the payload claims to be from the future — clock
  // skew between the web client and this device, not something to trust.
  if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) return null;

  return { code, issuedAt };
}
