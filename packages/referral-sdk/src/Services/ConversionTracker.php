<?php

declare(strict_types=1);

namespace Sparkle\Referral\Services;

use PDO;
use RuntimeException;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * Records referral conversions and distributes rewards. Enforces one referral
 * per device for the device's lifetime.
 *
 * `claim()` trusts nothing the caller *says* happened — `match_method` and
 * `match_confidence` are pulled from the click row `/match` (or the
 * deterministic redeem path) already locked, not from the claim request
 * itself. See docs/decisions.md #21: a client-declared device_id/method/
 * confidence with no server-side proof was previously enough to mint a
 * reward with no real click or match ever happening.
 */
final class ConversionTracker
{
    /**
     * @param ?PDO $pdo Only required for claim()'s insert/select paths; the
     *                  unverified-claim rejection path never touches it,
     *                  same nullable-for-testability pattern as
     *                  FingerprintMatcher.
     */
    public function __construct(
        private readonly ?PDO $pdo,
        private readonly ReferralConfig $config,
        private readonly ClickStore $clicks,
    ) {
    }

    /**
     * Record a conversion after a successful match + signup.
     *
     * @return array{success: bool, duplicate?: bool, unverified?: bool, reward?: array<string,mixed>}
     */
    public function claim(
        string $referralCode,
        string $deviceId,
        string $platform,
        string $clickId,
        ?string $userId = null,
    ): array {
        $storedDeviceId = self::resolveDeviceId($deviceId, $this->config);

        // The entire proof: click_id must reference a row this exact device
        // already won the lock on, for the exact code being claimed. A
        // click_id never reaches an arbitrary requester — only the device
        // that performed a real /click + /match (or deterministic redeem)
        // ever sees one.
        $locked = $this->clicks->findLockedClick($clickId);
        if (
            $locked === null
            || $locked['referral_code'] !== $referralCode
            || $locked['matched_device_id'] !== $storedDeviceId
        ) {
            return ['success' => false, 'unverified' => true];
        }

        if ($this->pdo === null) {
            throw new \LogicException('ConversionTracker::claim() requires a PDO connection past the unverified-claim check.');
        }

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
                ':click_id'      => $clickId,
                ':referral_code' => $referralCode,
                ':device_id'     => $storedDeviceId,
                ':platform'      => $platform,
                ':match_method'  => $locked['match_method'] ?? 'fingerprint',
                ':confidence'    => $locked['match_confidence'],
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

    /**
     * Applies `hash_device_ids` consistently everywhere a device_id is
     * persisted — `referral_clicks.matched_device_id` (see
     * ClickStore::lockToDevice, called from MatchController) and
     * `referral_conversions.device_id` (this class) both need to agree on
     * the same stored form, or claim()'s lock-ownership check
     * (`matched_device_id !== storedDeviceId`) compares a hash against a
     * raw value and never matches.
     */
    public static function resolveDeviceId(string $deviceId, ReferralConfig $config): string
    {
        return $config->hashDeviceIds ? self::hashDeviceId($deviceId) : $deviceId;
    }

    private function isUniqueViolation(\PDOException $e): bool
    {
        // SQLSTATE 23000 (MySQL) / 23505 (Postgres) integrity constraint.
        $sqlState = $e->getCode();

        return $sqlState === '23000' || $sqlState === '23505';
    }
}
