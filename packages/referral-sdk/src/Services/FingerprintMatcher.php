<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Services;

use PDO;
use BlynkDeferlink\Referral\Support\ReferralConfig;
use BlynkDeferlink\Referral\Support\UserAgentParser;

/**
 * Scores an incoming device fingerprint against stored clicks and returns the
 * best match above the configured confidence threshold.
 *
 * Scoring (default weights, configurable):
 *   IP match          +25
 *   Device model/UA   +25
 *   Screen dimensions +15
 *   Timezone          +10
 *   Language          +10
 *   Recency           +15  (graduated — full at the click, 0 at the window edge)
 *   ----------------------
 *   Total possible    100   |   Minimum to match: 70
 *
 * Recency exists so an IP mismatch (network switch between click and
 * install) doesn't fail the match outright on its own: a fresh, otherwise
 * clean match can still clear 70 without it. score() is pure and DB-free
 * so it can be unit-tested directly; match() layers the windowed query on
 * top.
 */
final class FingerprintMatcher
{
    /**
     * @param ?PDO $pdo Only required for match(); score() is pure and works
     *                  without a database connection.
     */
    public function __construct(
        private readonly ?PDO $pdo,
        private readonly ReferralConfig $config,
    ) {
    }

    /**
     * Find the best matching click for a device.
     *
     * Matching deliberately does **not** consume a click. `matched` means
     * "last matched by", not "used up" — see docs/decisions.md #30. An
     * already-matched click stays a candidate, which is what lets a
     * reinstall recover (on iOS the device id itself changes when the last
     * vendor app is uninstalled, so the returning device is a *new* device
     * as far as this table is concerned) and what stops a second match from
     * silently falling through to a runner-up and re-attributing the user to
     * a different referrer. Guarding against a referral code being redeemed
     * twice belongs in whatever records signups, not in making the click
     * invisible here.
     *
     * @param array<string,mixed> $incoming  Fingerprint sent by the app on first launch.
     * @param string              $requestIp Server-observed IP of the match request.
     * @param string|null         $deviceId  Already-hashed device id, when known. Lets a
     *                                       device keep an attribution it has already been
     *                                       given if its fingerprint later stops clearing
     *                                       the confidence threshold.
     * @return array{click_id: string, referral_code: string, confidence: float, expires_at: \DateTimeImmutable}|null
     */
    public function match(array $incoming, string $requestIp, ?string $deviceId = null): ?array
    {
        if ($this->pdo === null) {
            throw new \LogicException('FingerprintMatcher::match() requires a PDO connection.');
        }

        $incoming['ip'] = $requestIp;

        $windowStart = gmdate('Y-m-d H:i:s', time() - $this->config->matchWindowSeconds());

        // No `matched = 0` filter: that single clause was the whole of #17.
        // Newest first so ties resolve last-click-wins, and so the first row
        // seen for this device is its most recent binding — ordering by
        // matched_at instead would be unstable, since UTC_TIMESTAMP() has
        // one-second resolution and two locks taken in the same second tie.
        $stmt = $this->pdo->prepare(
            'SELECT click_id, referral_code, ip_address, user_agent,
                    screen_width, screen_height, timezone, language, platform,
                    created_at, expires_at, matched_device_id
             FROM referral_clicks
             WHERE expires_at > UTC_TIMESTAMP()
               AND created_at >= :window_start
             ORDER BY created_at DESC'
        );
        $stmt->bindValue(':window_start', $windowStart);
        $stmt->execute();

        $best = null;
        $bestScore = 0.0;
        $existing = null;
        $now = time();

        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            // Rows arrive newest-first, so the first one bound to this device
            // is its newest binding; later (older) ones are superseded.
            if ($existing === null
                && $deviceId !== null
                && $row['matched_device_id'] !== null
                && hash_equals((string) $row['matched_device_id'], $deviceId)
            ) {
                $existing = $row;
            }

            $score = $this->score($row, $incoming, $now);
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $row;
            }
        }

        // Only a candidate that clears the threshold may take an attribution
        // over. Without this a newer but unrelated click could steal one
        // purely by being recent.
        if ($best !== null && $bestScore < $this->config->minConfidence) {
            $best = null;
        }

        if ($best !== null && $existing !== null) {
            // Attribution is last-click-wins, compared by the *click's* time
            // rather than by confidence: a stale click that happens to score
            // higher is still the wrong answer. A newer click takes over; an
            // older one leaves the existing binding alone.
            $winner = strtotime((string) $best['created_at']) > strtotime((string) $existing['created_at'])
                ? $best
                : $existing;
        } else {
            // Falling back to $existing keeps an attribution the device has
            // already been given when nothing clears the threshold this time
            // — a retry or a relaunch on a weaker signal must not silently
            // lose it.
            $winner = $best ?? $existing;
        }

        if ($winner === null) {
            return null;
        }

        // Re-score the winner rather than reusing $bestScore, which belongs
        // to $best and would be wrong whenever $existing won.
        $confidence = $winner === $best
            ? $bestScore
            : $this->score($winner, $incoming, $now);

        return [
            'click_id'      => (string) $winner['click_id'],
            'referral_code' => (string) $winner['referral_code'],
            'confidence'    => round($confidence, 2),
            'expires_at'    => new \DateTimeImmutable((string) $winner['expires_at'], new \DateTimeZone('UTC')),
        ];
    }

    /**
     * Pure scoring function. No DB, no side effects — safe to unit-test.
     *
     * @param array<string,mixed> $stored   A stored click row.
     * @param array<string,mixed> $incoming The device fingerprint being matched.
     * @param ?int                $now      Unix timestamp to score recency against.
     *                                      Defaults to the real current time; tests
     *                                      pass an explicit value for determinism.
     */
    public function score(array $stored, array $incoming, ?int $now = null): float
    {
        $w = $this->config->scoring;
        $score = 0.0;
        $now ??= time();

        // --- IP (exact) ---
        $storedIp   = self::str($stored['ip_address'] ?? $stored['ip'] ?? null);
        $incomingIp = self::str($incoming['ip'] ?? null);
        if ($storedIp !== '' && $storedIp === $incomingIp) {
            $score += $w['ip_match'];
        }

        // --- Device model / OS family ---
        $storedSig   = UserAgentParser::parse(self::str($stored['user_agent'] ?? null));
        $incomingSig = $this->incomingDeviceSignature($incoming);
        if ($this->deviceMatches($storedSig, $incomingSig)) {
            $score += $w['device_model'];
        }

        // --- Screen dimensions (order-insensitive) ---
        if ($this->screenMatches($stored, $incoming)) {
            $score += $w['screen_dimensions'];
        }

        // --- Timezone (exact) ---
        $storedTz   = self::str($stored['timezone'] ?? null);
        $incomingTz = self::str($incoming['timezone'] ?? null);
        if ($storedTz !== '' && strcasecmp($storedTz, $incomingTz) === 0) {
            $score += $w['timezone'];
        }

        // --- Language (primary subtag, so "en-NG" ~ "en") ---
        if ($this->languageMatches(self::str($stored['language'] ?? null), self::str($incoming['language'] ?? null))) {
            $score += $w['language'];
        }

        // --- Recency (graduated) ---
        $score += $this->recencyScore($stored, $now);

        return (float) $score;
    }

    /**
     * Full credit at the click, decaying linearly to 0 by the edge of the
     * match window. Clock skew that makes the click look like it's in the
     * future is clamped to full credit rather than penalized.
     *
     * @param array<string,mixed> $stored
     */
    private function recencyScore(array $stored, int $now): float
    {
        $weight = (float) ($this->config->scoring['recency'] ?? 0);
        if ($weight <= 0.0) {
            return 0.0;
        }

        $windowSeconds = $this->config->matchWindowSeconds();
        if ($windowSeconds <= 0) {
            return 0.0;
        }

        $createdAtRaw = $stored['created_at'] ?? null;
        // Parsed as UTC explicitly rather than with strtotime(), which
        // resolves a naive string in the *host app's* default timezone.
        // `created_at` is written by UTC_TIMESTAMP() and reads back naive
        // (a MySQL TIMESTAMP carries no zone designator), while the $now
        // it's compared against is a true Unix timestamp — so a naive parse
        // skews every recency score by the host's UTC offset. That isn't
        // just a rounding loss: on a negative offset $elapsed goes negative
        // and trips the `$elapsed <= 0` clamp below, handing *full* freshness
        // credit to a click sitting at the far edge of its match window.
        // Since this package installs into someone else's Laravel app, it
        // can't assume date.timezone is UTC. Mirrors the explicit UTC zone
        // already passed when parsing expires_at in match() above and in
        // ClickStore::findClickForClaim(); this line was the lone outlier.
        // An embedded "Z" still overrides the passed zone, so ISO-8601
        // inputs (what docs/fixtures/fingerprint-match-cases.json supplies)
        // behave exactly as before.
        $createdAt = false;
        if ($createdAtRaw !== null) {
            try {
                $createdAt = (new \DateTimeImmutable(
                    (string) $createdAtRaw,
                    new \DateTimeZone('UTC'),
                ))->getTimestamp();
            } catch (\Exception) {
                $createdAt = false;
            }
        }
        if ($createdAt === false) {
            return 0.0;
        }

        $elapsed = $now - $createdAt;
        if ($elapsed <= 0) {
            return $weight;
        }
        if ($elapsed >= $windowSeconds) {
            return 0.0;
        }

        return $weight * (1 - $elapsed / $windowSeconds);
    }

    /** @return array{os: string, os_version: ?string, model_hint: ?string} */
    private function incomingDeviceSignature(array $incoming): array
    {
        $model    = self::str($incoming['device_model'] ?? null);
        $platform = self::str($incoming['platform'] ?? null);

        if ($model !== '') {
            $parsed = UserAgentParser::parseModel($model, $platform);
            return ['os' => $parsed['os'], 'os_version' => null, 'model_hint' => $parsed['model_hint']];
        }

        // Fall back to the app-reported UA if no native model was provided.
        return UserAgentParser::parse(self::str($incoming['user_agent'] ?? null));
    }

    /**
     * OS family must agree. If both sides expose a comparable model hint or OS
     * version, they must not contradict. On iOS the browser UA can't reveal a
     * model, so an OS-family agreement is the strongest signal available.
     */
    private function deviceMatches(array $stored, array $incoming): bool
    {
        if ($stored['os'] === 'unknown' || $incoming['os'] === 'unknown') {
            return false;
        }
        if ($stored['os'] !== $incoming['os']) {
            return false;
        }

        $sv = $stored['os_version'] ?? null;
        $iv = $incoming['os_version'] ?? null;
        if ($sv !== null && $iv !== null) {
            // Compare major version only; minor drift (17.2 vs 17.3) is fine.
            if (self::major($sv) !== self::major($iv)) {
                return false;
            }
        }

        return true;
    }

    private function screenMatches(array $stored, array $incoming): bool
    {
        $sw = (int) ($stored['screen_width'] ?? 0);
        $sh = (int) ($stored['screen_height'] ?? 0);
        $iw = (int) ($incoming['screen_width'] ?? 0);
        $ih = (int) ($incoming['screen_height'] ?? 0);

        if ($sw === 0 || $sh === 0 || $iw === 0 || $ih === 0) {
            return false;
        }

        // Orientation-insensitive: a browser and a native app may report
        // width/height swapped depending on how each reads the screen.
        return ($sw === $iw && $sh === $ih) || ($sw === $ih && $sh === $iw);
    }

    private function languageMatches(string $a, string $b): bool
    {
        if ($a === '' || $b === '') {
            return false;
        }
        // Browsers/Intl report BCP-47 hyphenated tags ("en-NG"); native iOS
        // APIs report underscore-separated ICU tags ("en_US", or
        // "en_US_POSIX" on the Simulator specifically) — split on either so
        // both reduce to "en". This backend previously split only on '-',
        // silently failing to match against the Node backend's own
        // behavior for the exact same underscore-separated input — a real,
        // live cross-backend divergence caught in decisions.md #23.
        $primary = static fn (string $l): string => strtolower(preg_split('/[-_]/', $l)[0]);

        return $primary($a) === $primary($b);
    }

    private static function major(string $version): string
    {
        return explode('.', $version)[0];
    }

    private static function str(mixed $v): string
    {
        return $v === null ? '' : trim((string) $v);
    }
}
