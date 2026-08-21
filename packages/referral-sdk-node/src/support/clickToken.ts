import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Required, not optional like CRON_SECRET/ANALYTICS_SECRET — every /click
 * needs this to mint a token, so an unconfigured deploy should fail loudly
 * and immediately (same pattern as db/client.ts's DATABASE_URL check)
 * rather than silently mint tokens no one can ever verify, or worse, fall
 * back to something predictable.
 */
export function getClickTokenSecret(): string {
  const secret = process.env.CLICK_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      'CLICK_TOKEN_SECRET is not set. Generate one (e.g. `openssl rand -hex 32`) ' +
        'and set it in your environment — every /click mints a signed proof ' +
        'with it, and /claim can\'t verify anything without the same value.',
    );
  }
  return secret;
}

/**
 * Signs a proof that a specific `click_id` is real and hasn't expired, so
 * `/claim` can verify it with a cheap HMAC compare instead of requiring a
 * separate network round trip ("redeem") just to turn a locally-readable
 * `click_id` into a claim-ready one before the app can even display a code.
 *
 * Minted once, at `/click` time (and again at `/match` on a successful
 * lock, for the fingerprint path) — free, since both already run anyway.
 * Read purely locally by the mobile SDK from the Android referrer param /
 * iOS clipboard payload; only sent back over the network once, at
 * `/claim`, which is when server verification should happen. See
 * docs/decisions.md #22 for why this replaced an earlier design that made
 * recovery itself depend on a round trip.
 *
 * Format: `<click_id>.<exp_unix_seconds>.<hmac_sha256_hex>` — plain
 * delimited text, not JWT: a UUID click_id and a digits-only exp never
 * contain `.`, so this needs no encoding step, matching this codebase's
 * existing hand-rolled formats (clipboardPayload.ts's `:`-delimited
 * payload, hashDeviceId's hex digest) rather than a new dependency.
 */
export function signClickToken(clickId: string, expiresAt: Date, secret: string): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const payload = `${clickId}.${exp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/**
 * Verifies signature and expiry; returns the embedded `click_id` only if
 * both hold. Constant-time signature comparison (`timingSafeEqual`) —
 * this is the one thing standing between "any string" and "a real,
 * unexpired click," so it's worth doing correctly from the start here.
 */
export function verifyClickToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): { clickId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [clickId, expRaw, signature] = parts;
  const exp = Number(expRaw);
  if (!clickId || !signature || !Number.isFinite(exp)) return null;

  const expected = createHmac('sha256', secret).update(`${clickId}.${expRaw}`).digest('hex');
  const signatureBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  if (Math.floor(now.getTime() / 1000) > exp) return null;

  return { clickId };
}
