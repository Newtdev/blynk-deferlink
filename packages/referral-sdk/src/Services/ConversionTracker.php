<?php

declare(strict_types=1);

namespace Sparkle\Referral\Services;

use PDO;
use RuntimeException;
use Sparkle\Referral\Support\ClickToken;
use Sparkle\Referral\Support\DeviceId;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * Records referral conversions and distributes rewards. Enforces one referral
 * per device for the device's lifetime.
 *
 * `claim()` trusts nothing the caller *says* happened — the entire proof is
 * a signed `$token` (see Support/ClickToken.php), verified here, never a
 * client-declared referral_code/click_id/method/confidence. See
 * docs/decisions.md #21/#22: a client-declared device_id/method/confidence
 * with no server-side proof was previously enough to mint a reward with no
 * real click or match ever happening; #22 moved that proof to a signed
 * token minted for free at /click time instead of a redeem round-trip that
 * made ordinary code recovery depend on the network.
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
     * Record a conversion after a successful match + signup. `$method` is
     * only read when the token's click hasn't been matched yet (the
     * deterministic path's first real use) — a labeling detail, not a
     * security check either way; ignored otherwise. `$now` defaults to the
     * real current time; tests pass an explicit value for determinism —
     * a fixed test date will eventually be in the past relative to
     * whenever the suite actually runs, which would make a "should verify"
     * case fail for the wrong reason (expiry) without anyone noticing,
     * since a verification failure and a device/lock mismatch return the
     * identical `unverified` shape.
     *
     * @return array{success: bool, duplicate?: bool, unverified?: bool, reward?: array<string,mixed>}
     */
    public function claim(
        string $deviceId,
        string $platform,
        string $token,
        ?string $method = null,
        ?string $userId = null,
        ?\DateTimeImmutable $now = null,
    ): array {
        $now ??= new \DateTimeImmutable();

        $verified = ClickToken::verify($token, $this->config->requireClickTokenSecret(), $now);
        if ($verified === null) {
            return ['success' => false, 'unverified' => true];
        }

        $click = $this->clicks->findClickForClaim($verified['click_id']);
        if ($click === null || $click['expires_at'] < $now) {
            return ['success' => false, 'unverified' => true];
        }

        $storedDeviceId = self::resolveDeviceId($deviceId, $this->config);

        if ($click['matched']) {
            // Fingerprint path — /match already locked this click. Confirm
            // the lock belongs to this device; nothing to lock here.
            if ($click['matched_device_id'] !== $storedDeviceId) {
                return ['success' => false, 'unverified' => true];
            }
            $matchMethod = $click['match_method'] ?? 'fingerprint';
            $matchConfidence = $click['match_confidence'];
        } else {
            // Deterministic path's first real use — lock it right here,
            // atomically. Lost the race (something else claimed it first)?
            // Reject rather than proceed on a click that isn't actually ours.
            $matchMethod = $method ?? 'fingerprint';
            if (!$this->clicks->lockToDevice($verified['click_id'], $storedDeviceId, $matchMethod, null)) {
                return ['success' => false, 'unverified' => true];
            }
            $matchConfidence = null;
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
                ':click_id'      => $verified['click_id'],
                ':referral_code' => $click['referral_code'],
                ':device_id'     => $storedDeviceId,
                ':platform'      => $platform,
                ':match_method'  => $matchMethod,
                ':confidence'    => $matchConfidence,
                ':user_id'       => $userId,
            ]);
        } catch (\PDOException $e) {
            // Unique index on device_id — lost a concurrent race. Treat as dupe.
            if ($this->isUniqueViolation($e)) {
                return ['success' => false, 'duplicate' => true];
            }
            throw $e;
        }

        $reward = $this->distributeReward($verified['click_id'], $click['referral_code'], $userId);

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

    /**
     * The conversion row is already committed by the time this runs (it
     * has to be — the dedup/unique-device guarantee needs to land before
     * crediting anything). So a failing callback (e.g. Sparkle's own
     * account-crediting call is down) must not throw past that: it used
     * to, leaving a device permanently marked "converted" with no reward
     * and the client staring at a misleading 500. Caught here instead —
     * logged, the row marked `reward_status = 'failed'` (defaults to
     * `'granted'` optimistically on insert) for reconciliation, and
     * claim() still reports success, because the conversion itself — "this
     * device used this code, once" — is real and final regardless of
     * whether the reward side effect landed. See decisions.md #23.
     *
     * @return array<string,mixed>
     */
    private function distributeReward(string $clickId, string $referralCode, ?string $userId): array
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
        try {
            if (is_string($callback) && class_exists($callback) && method_exists($callback, 'handle')) {
                (new $callback())->handle($referralCode, $userId, $this->config->rewards);
            } elseif (is_callable($callback)) {
                $callback($referralCode, $userId, $this->config->rewards);
            }
        } catch (\Throwable $e) {
            error_log(
                "on_claim_callback failed for click {$clickId} (code {$referralCode}) — conversion already " .
                "recorded, reward not confirmed granted. Marked reward_status='failed' for reconciliation. " .
                $e->getMessage()
            );
            $stmt = $this->pdo->prepare(
                "UPDATE referral_conversions SET reward_status = 'failed' WHERE click_id = :click_id"
            );
            $stmt->execute([':click_id' => $clickId]);
        }

        return $reward;
    }

    /** @deprecated Use Support\DeviceId::hash() directly. Kept so existing call sites don't break. */
    public static function hashDeviceId(string $deviceId): string
    {
        return DeviceId::hash($deviceId);
    }

    /** @deprecated Use Support\DeviceId::resolve() directly. Kept so existing call sites don't break. */
    public static function resolveDeviceId(string $deviceId, ReferralConfig $config): string
    {
        return DeviceId::resolve($deviceId, $config);
    }

    private function isUniqueViolation(\PDOException $e): bool
    {
        // SQLSTATE 23000 (MySQL) / 23505 (Postgres) integrity constraint.
        $sqlState = $e->getCode();

        return $sqlState === '23000' || $sqlState === '23505';
    }
}
