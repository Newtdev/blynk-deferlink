<?php

declare(strict_types=1);

namespace Sparkle\Referral\Services;

use PDO;
use RuntimeException;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * Records referral conversions and distributes rewards. Enforces one referral
 * per device for the device's lifetime.
 */
final class ConversionTracker
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly ReferralConfig $config,
    ) {
    }

    /**
     * Record a conversion after a successful match + signup.
     *
     * @return array{success: bool, duplicate?: bool, reward?: array<string,mixed>}
     */
    public function claim(
        string $referralCode,
        string $deviceId,
        string $platform,
        string $matchMethod,
        ?string $clickId = null,
        ?string $userId = null,
        ?float $confidence = null,
    ): array {
        $storedDeviceId = $this->config->hashDeviceIds ? self::hashDeviceId($deviceId) : $deviceId;

        if ($this->deviceHasConverted($storedDeviceId)) {
            return ['success' => false, 'duplicate' => true];
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO referral_conversions
                (click_id, referral_code, device_id, platform, match_method,
                 match_confidence, user_id, created_at)
             VALUES
                (:click_id, :referral_code, :device_id, :platform, :match_method,
                 :confidence, :user_id, UTC_TIMESTAMP())'
        );

        try {
            $stmt->execute([
                ':click_id'      => $clickId ?? ClickStore::uuid4(),
                ':referral_code' => $referralCode,
                ':device_id'     => $storedDeviceId,
                ':platform'      => $platform,
                ':match_method'  => $matchMethod,
                ':confidence'    => $confidence,
                ':user_id'       => $userId,
            ]);
        } catch (\PDOException $e) {
            // Unique index on device_id — lost a concurrent race. Treat as dupe.
            if ($this->isUniqueViolation($e)) {
                return ['success' => false, 'duplicate' => true];
            }
            throw $e;
        }

        $reward = $this->distributeReward($referralCode, $userId);

        return ['success' => true, 'reward' => $reward];
    }

    public function deviceHasConverted(string $storedDeviceId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT 1 FROM referral_conversions WHERE device_id = :device_id LIMIT 1'
        );
        $stmt->execute([':device_id' => $storedDeviceId]);

        return $stmt->fetchColumn() !== false;
    }

    /** @return array<string,mixed> */
    private function distributeReward(string $referralCode, ?string $userId): array
    {
        $reward = [
            'type'   => $this->config->rewards['reward_type'],
            'amount' => $this->config->rewards['referee_reward'],
        ];

        if (!($this->config->rewards['enabled'] ?? false)) {
            return ['type' => 'none', 'amount' => 0];
        }

        // Optional project-supplied callback for actually crediting accounts.
        // Signature: (string $referralCode, ?string $userId, array $config): void
        $callback = $this->config->rewards['on_claim_callback'] ?? null;
        if (is_string($callback) && class_exists($callback) && method_exists($callback, 'handle')) {
            (new $callback())->handle($referralCode, $userId, $this->config->rewards);
        } elseif (is_callable($callback)) {
            $callback($referralCode, $userId, $this->config->rewards);
        }

        return $reward;
    }

    public static function hashDeviceId(string $deviceId): string
    {
        // One-way, for dedup only. Never reversed.
        return hash('sha256', $deviceId);
    }

    private function isUniqueViolation(\PDOException $e): bool
    {
        // SQLSTATE 23000 (MySQL) / 23505 (Postgres) integrity constraint.
        $sqlState = $e->getCode();

        return $sqlState === '23000' || $sqlState === '23505';
    }
}
