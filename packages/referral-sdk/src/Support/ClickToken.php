<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Support;

/**
 * Signs a proof that a specific `click_id` is real and hasn't expired, so
 * /claim can verify it with a cheap HMAC compare instead of requiring a
 * separate network round trip ("redeem") just to turn a locally-readable
 * click_id into a claim-ready one before the app can even display a code.
 *
 * Minted once, at /click time (and again at /match on a successful lock,
 * for the fingerprint path) — free, since both already run anyway. Read
 * purely locally by the mobile SDK from the Android referrer param / iOS
 * clipboard payload; only sent back over the network once, at /claim,
 * which is when server verification should happen. See docs/decisions.md
 * #22 for why this replaced an earlier design that made recovery itself
 * depend on a round trip.
 *
 * Format: `<click_id>.<exp_unix_seconds>.<hmac_sha256_hex>` — plain
 * delimited text, not JWT: a UUID click_id and a digits-only exp never
 * contain `.`, so this needs no encoding step, matching this codebase's
 * existing hand-rolled formats rather than a new dependency.
 */
final class ClickToken
{
    public static function sign(string $clickId, \DateTimeInterface $expiresAt, string $secret): string
    {
        $exp = $expiresAt->getTimestamp();
        $payload = "{$clickId}.{$exp}";
        $signature = hash_hmac('sha256', $payload, $secret);

        return "{$payload}.{$signature}";
    }

    /**
     * Verifies signature and expiry; returns the embedded click_id only if
     * both hold. Constant-time signature comparison (`hash_equals`) — this
     * is the one thing standing between "any string" and "a real,
     * unexpired click," so it's worth doing correctly from the start here.
     *
     * @return array{click_id: string}|null
     */
    public static function verify(string $token, string $secret, ?\DateTimeInterface $now = null): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$clickId, $expRaw, $signature] = $parts;
        if ($clickId === '' || $signature === '' || !is_numeric($expRaw)) {
            return null;
        }
        $exp = (int) $expRaw;

        $expected = hash_hmac('sha256', "{$clickId}.{$expRaw}", $secret);
        if (!hash_equals($expected, $signature)) {
            return null;
        }

        $nowTs = ($now ?? new \DateTimeImmutable())->getTimestamp();
        if ($nowTs > $exp) {
            return null;
        }

        return ['click_id' => $clickId];
    }
}
