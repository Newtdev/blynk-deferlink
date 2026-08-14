<?php

declare(strict_types=1);

namespace Sparkle\Referral\Services;

use PDO;
use Sparkle\Referral\Support\ReferralConfig;
use Sparkle\Referral\Support\UserAgentParser;

/**
 * Scores an incoming device fingerprint against stored clicks and returns the
 * best match above the configured confidence threshold.
 *
 * Scoring (default weights, configurable):
 *   IP match          +40
 *   Device model/UA   +25
 *   Screen dimensions +15
 *   Timezone          +10
 *   Language          +10
 *   ----------------------
 *   Total possible    100   |   Minimum to match: 70
 *
 * IP alone (40) is never enough. score() is pure and DB-free so it can be
 * unit-tested directly; match() layers the 48h windowed query on top.
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
     * Find the best matching unclaimed click for a device.
     *
     * @param array<string,mixed> $incoming Fingerprint sent by the app on first launch.
     * @param string              $requestIp Server-observed IP of the match request.
     * @return array{click_id: string, referral_code: string, confidence: float}|null
     */
    public function match(array $incoming, string $requestIp): ?array
    {
        if ($this->pdo === null) {
            throw new \LogicException('FingerprintMatcher::match() requires a PDO connection.');
        }

        $incoming['ip'] = $requestIp;

        $windowStart = gmdate('Y-m-d H:i:s', time() - $this->config->matchWindowSeconds());

        // Only consider fresh, unmatched clicks. Newest first: last-click-wins on ties.
        $stmt = $this->pdo->prepare(
            'SELECT click_id, referral_code, ip_address, user_agent,
                    screen_width, screen_height, timezone, language, platform
             FROM referral_clicks
             WHERE matched = 0
               AND expires_at > UTC_TIMESTAMP()
               AND created_at >= :window_start
             ORDER BY created_at DESC'
        );
        $stmt->bindValue(':window_start', $windowStart);
        $stmt->execute();

        $best = null;
        $bestScore = 0.0;

        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $score = $this->score($row, $incoming);
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $row;
            }
        }

        if ($best === null || $bestScore < $this->config->minConfidence) {
            return null;
        }

        return [
            'click_id'      => (string) $best['click_id'],
            'referral_code' => (string) $best['referral_code'],
            'confidence'    => round($bestScore, 2),
        ];
    }

    /**
     * Pure scoring function. No DB, no side effects — safe to unit-test.
     *
     * @param array<string,mixed> $stored   A stored click row.
     * @param array<string,mixed> $incoming The device fingerprint being matched.
     */
    public function score(array $stored, array $incoming): float
    {
        $w = $this->config->scoring;
        $score = 0.0;

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

        return (float) $score;
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
        $primary = static fn (string $l): string => strtolower(explode('-', $l)[0]);

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
