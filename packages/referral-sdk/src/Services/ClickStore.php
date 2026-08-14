<?php

declare(strict_types=1);

namespace Sparkle\Referral\Services;

use PDO;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * All click-table reads/writes. Framework-agnostic (PDO only).
 */
final class ClickStore
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly ReferralConfig $config,
    ) {
    }

    /**
     * Store a landing-page click. Returns the generated click_id (UUID v4).
     *
     * @param array<string,mixed> $fingerprint Client-collected fingerprint.
     */
    public function store(string $referralCode, array $fingerprint, string $ip): string
    {
        $clickId  = self::uuid4();
        $expires  = gmdate('Y-m-d H:i:s', time() + $this->config->matchWindowSeconds());

        $stmt = $this->pdo->prepare(
            'INSERT INTO referral_clicks
                (click_id, referral_code, ip_address, user_agent,
                 screen_width, screen_height, pixel_ratio,
                 timezone, language, platform, referrer_url,
                 matched, created_at, expires_at)
             VALUES
                (:click_id, :referral_code, :ip, :ua,
                 :sw, :sh, :pr,
                 :tz, :lang, :platform, :referrer,
                 0, UTC_TIMESTAMP(), :expires)'
        );

        $stmt->execute([
            ':click_id'      => $clickId,
            ':referral_code' => $referralCode,
            ':ip'            => $ip,
            ':ua'            => self::nullableStr($fingerprint['user_agent'] ?? null),
            ':sw'            => self::nullableInt($fingerprint['screen_width'] ?? null),
            ':sh'            => self::nullableInt($fingerprint['screen_height'] ?? null),
            ':pr'            => isset($fingerprint['pixel_ratio']) ? (float) $fingerprint['pixel_ratio'] : null,
            ':tz'            => self::nullableStr($fingerprint['timezone'] ?? null),
            ':lang'          => self::nullableStr($fingerprint['language'] ?? null),
            ':platform'      => self::nullableStr($fingerprint['platform'] ?? null),
            ':referrer'      => self::nullableStr($fingerprint['referrer'] ?? ($fingerprint['referrer_url'] ?? null)),
            ':expires'       => $expires,
        ]);

        return $clickId;
    }

    /**
     * Atomically lock a click to a device so it can never be matched twice.
     * Returns true only if this call is the one that won the lock.
     */
    public function lockToDevice(string $clickId, string $deviceId): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE referral_clicks
             SET matched = 1, matched_device_id = :device_id, matched_at = UTC_TIMESTAMP()
             WHERE click_id = :click_id AND matched = 0'
        );
        $stmt->execute([':device_id' => $deviceId, ':click_id' => $clickId]);

        return $stmt->rowCount() === 1;
    }

    /** Count clicks from an IP within the last hour (rate limiting). */
    public function countRecentClicksByIp(string $ip, int $seconds = 3600): int
    {
        $since = gmdate('Y-m-d H:i:s', time() - $seconds);
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) FROM referral_clicks WHERE ip_address = :ip AND created_at >= :since'
        );
        $stmt->execute([':ip' => $ip, ':since' => $since]);

        return (int) $stmt->fetchColumn();
    }

    /** Delete unmatched clicks past their expiry. Returns rows removed. */
    public function deleteExpired(): int
    {
        $stmt = $this->pdo->query(
            'DELETE FROM referral_clicks WHERE matched = 0 AND expires_at <= UTC_TIMESTAMP()'
        );

        return $stmt === false ? 0 : $stmt->rowCount();
    }

    public static function uuid4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }

    private static function nullableStr(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $v = trim((string) $v);

        return $v === '' ? null : $v;
    }

    private static function nullableInt(mixed $v): ?int
    {
        return $v === null || $v === '' ? null : (int) $v;
    }
}
