const PREFIX = 'deferlink_ref:v1:';

export interface ParsedClipboardReferral {
  code: string;
  issuedAt: number;
  /**
   * Signed proof this click is real and unexpired, if the web landing
   * page's click registration completed before the redirect — null for
   * older payloads or a registration that didn't resolve in time. /claim
   * now requires it; this SDK never decodes or verifies it itself, just
   * carries it straight through. See docs/decisions.md #21/#22.
   */
  token: string | null;
}

/**
 * Parses and validates a clipboard payload written by
 * `writeClipboardReferral()` on the web landing page (see
 * @blynk-deferlink/referral-web). Returns null for anything that doesn't match the
 * expected shape, is malformed, or has aged past `maxAgeSeconds` — a stray
 * clipboard value (a password, an unrelated copied link) is never mistaken
 * for a match. This is what makes the deterministic tier self-validating
 * without a network round trip.
 *
 * Format: `<code>:<issued_unix_ts>` or `<code>:<issued_unix_ts>:<token>` —
 * the token, when present, is always the last field (and is itself an
 * opaque `.`-delimited string — see support/clickToken.ts on the backend —
 * so it never collides with this format's own `:` delimiter). Parsing
 * anchors from the end rather than assuming a fixed field count: the last
 * segment is tried as a timestamp first; only if that fails (not a valid
 * number) is it treated as a token and the segment before it retried as
 * the timestamp. That keeps this robust to a colon *within* the code
 * itself (which shouldn't happen in practice, but degrades gracefully
 * either way) without the two cases being ambiguous — a genuine 2-field
 * payload's last segment always parses as a number, so it never falls
 * into the token branch.
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

  let code = rest.slice(0, lastColon);
  let issuedAtRaw = rest.slice(lastColon + 1);
  let token: string | null = null;

  if (!Number.isFinite(Number(issuedAtRaw))) {
    const secondLastColon = code.lastIndexOf(':');
    if (secondLastColon === -1) return null;
    token = issuedAtRaw;
    issuedAtRaw = code.slice(secondLastColon + 1);
    code = code.slice(0, secondLastColon);
  }

  const issuedAt = Number(issuedAtRaw);
  if (!code || !Number.isFinite(issuedAt)) return null;

  const ageSeconds = now / 1000 - issuedAt;
  // Negative age means the payload claims to be from the future — clock
  // skew between the web client and this device, not something to trust.
  if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) return null;

  return { code, issuedAt, token };
}
