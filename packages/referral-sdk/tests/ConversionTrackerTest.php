<?php

declare(strict_types=1);

namespace Sparkle\Referral\Tests;

use PHPUnit\Framework\TestCase;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Support\ClickToken;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * Exercises the security property docs/decisions.md #21/#22 fix: claim()
 * must reject anything that isn't backed by a real, valid, device-owned
 * click token — not just accept whatever the request body claims happened.
 *
 * `now()` is always passed explicitly to claim() (its `$now` param exists
 * specifically for this) rather than relying on the real wall clock — a
 * fixed test date will eventually be in the past relative to whenever the
 * suite actually runs, which would make every "should verify" case here
 * fail for the wrong reason (expiry) without anyone noticing, since a
 * verification failure and a device/lock mismatch return the identical
 * `unverified` shape. Caught by hand while manually smoke-testing this
 * exact bug (no PHPUnit runner available in this environment) before
 * trusting either backend's tests.
 */
final class ConversionTrackerTest extends TestCase
{
    private const SECRET = 'test-secret-do-not-use-in-prod';

    private function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-14T12:00:00Z');
    }

    private function futureExpiry(): \DateTimeImmutable
    {
        return $this->now()->modify('+60 seconds');
    }

    private function config(): ReferralConfig
    {
        return new ReferralConfig(['click_token_secret' => self::SECRET]);
    }

    /** @param array{referral_code: string, matched: bool, matched_device_id: ?string, match_method: ?string, match_confidence: ?float, expires_at: \DateTimeImmutable}|null $click */
    private function stubClicks(?array $click, bool $lockResult = true): ClickStore
    {
        return new class ($click, $lockResult) extends ClickStore {
            public function __construct(private readonly ?array $click, private readonly bool $lockResult)
            {
                // Deliberately skip the parent constructor — no PDO needed
                // for a stub that only overrides findClickForClaim()/lockToDevice().
            }

            public function findClickForClaim(string $clickId): ?array
            {
                return $this->click;
            }

            public function lockToDevice(string $clickId, string $deviceId, string $method, ?float $confidence = null): bool
            {
                return $this->lockResult;
            }
        };
    }

    private function baseClick(array $overrides = []): array
    {
        return array_merge([
            'referral_code'     => 'CODE1',
            'matched'           => false,
            'matched_device_id' => null,
            'match_method'      => null,
            'match_confidence'  => null,
            'expires_at'        => $this->futureExpiry(),
        ], $overrides);
    }

    public function test_claim_rejects_a_fabricated_token_with_no_matching_click_at_all(): void
    {
        // The original finding's exact failure scenario: a token that
        // doesn't verify (or references nothing) — no prior /click ever
        // happened.
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks(null));
        $result = $tracker->claim(
            deviceId: bin2hex(random_bytes(16)),
            platform: 'ios',
            token: 'attacker-click-id.9999999999.' . str_repeat('deadbeef', 8),
            now: $this->now(),
        );
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_a_tampered_token(): void
    {
        $token = ClickToken::sign('click-1', $this->futureExpiry(), self::SECRET);
        [, $exp, $sig] = explode('.', $token);
        $tampered = "attacker-click-id.{$exp}.{$sig}";
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks($this->baseClick()));
        $result = $tracker->claim(deviceId: 'device-1', platform: 'ios', token: $tampered, now: $this->now());
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_an_expired_token(): void
    {
        $pastExp = $this->now()->modify('-1 second');
        $token = ClickToken::sign('click-1', $pastExp, self::SECRET);
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks($this->baseClick(['expires_at' => $pastExp])));
        $result = $tracker->claim(deviceId: 'device-1', platform: 'ios', token: $token, now: $this->now());
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_when_the_click_row_itself_has_since_expired(): void
    {
        // Defense in depth vs. the token's own (already-passed) expiry check.
        $token = ClickToken::sign('click-1', $this->futureExpiry(), self::SECRET);
        $staleClick = $this->baseClick(['expires_at' => $this->now()->modify('-1 second')]);
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks($staleClick));
        $result = $tracker->claim(deviceId: 'device-1', platform: 'ios', token: $token, now: $this->now());
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_an_already_matched_click_when_the_device_does_not_match_the_lock(): void
    {
        $token = ClickToken::sign('click-1', $this->futureExpiry(), self::SECRET);
        $locked = $this->baseClick([
            'matched'           => true,
            'matched_device_id' => ConversionTracker::hashDeviceId('the-real-device'),
            'match_method'      => 'fingerprint',
            'match_confidence'  => 85.0,
        ]);
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks($locked));
        $result = $tracker->claim(
            deviceId: 'attacker-fabricated-device-id', // never went through /click or /match
            platform: 'ios',
            token: $token,
            now: $this->now(),
        );
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_a_not_yet_matched_click_when_the_atomic_lock_is_lost_to_a_race(): void
    {
        $token = ClickToken::sign('click-1', $this->futureExpiry(), self::SECRET);
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks($this->baseClick(), lockResult: false));
        $result = $tracker->claim(deviceId: 'device-1', platform: 'android', token: $token, method: 'install_referrer', now: $this->now());
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_passes_verification_for_an_already_matched_click_owned_by_this_device(): void
    {
        // Proves the "happy path" actually clears verification, not just
        // that failures fail — an unguarded `pdo: null` throws once
        // claim() reaches the DB-touching part of the success path, which
        // is exactly the point: it did NOT return an unverified result.
        $token = ClickToken::sign('click-1', $this->futureExpiry(), self::SECRET);
        $locked = $this->baseClick([
            'matched'           => true,
            'matched_device_id' => ConversionTracker::hashDeviceId('good-device'),
            'match_method'      => 'fingerprint',
            'match_confidence'  => 92.5,
        ]);
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks($locked));
        $this->expectException(\LogicException::class);
        $tracker->claim(deviceId: 'good-device', platform: 'ios', token: $token, now: $this->now());
    }

    public function test_claim_passes_verification_for_a_not_yet_matched_click_when_the_lock_succeeds(): void
    {
        $token = ClickToken::sign('click-1', $this->futureExpiry(), self::SECRET);
        $tracker = new ConversionTracker(null, $this->config(), $this->stubClicks($this->baseClick(), lockResult: true));
        $this->expectException(\LogicException::class);
        $tracker->claim(deviceId: 'device-1', platform: 'android', token: $token, method: 'install_referrer', now: $this->now());
    }

    public function test_resolve_device_id_hashes_consistently_with_what_lock_to_device_would_store(): void
    {
        // The exact bug caught while implementing #21: claim() compares its
        // resolved device_id against the click row's matched_device_id,
        // which MatchController populates via this same helper before
        // calling lockToDevice — if the two ever compute the stored form
        // differently, a legitimate claim fails verification even though
        // nothing is wrong.
        $raw = 'device-abc-123';
        $config = new ReferralConfig();
        $this->assertSame(ConversionTracker::hashDeviceId($raw), ConversionTracker::resolveDeviceId($raw, $config));

        $noHash = new ReferralConfig(['hash_device_ids' => false]);
        $this->assertSame($raw, ConversionTracker::resolveDeviceId($raw, $noHash));
    }
}
