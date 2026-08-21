<?php

declare(strict_types=1);

namespace Sparkle\Referral\Tests;

use PHPUnit\Framework\TestCase;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * Exercises the security property docs/decisions.md #21 fixes: claim() must
 * reject anything that isn't backed by a real, matching, device-owned click
 * lock — not just accept whatever the request claims happened. All cases
 * here resolve before ConversionTracker ever touches its PDO (the unverified
 * path returns before the insert/select), so `null` is passed for it — same
 * pattern FingerprintMatcherTest already uses for a constructor argument a
 * given code path never touches.
 */
final class ConversionTrackerTest extends TestCase
{
    /** @param array{referral_code: string, matched_device_id: ?string, match_method: ?string, match_confidence: ?float}|null $locked */
    private function stubClicks(?array $locked): ClickStore
    {
        return new class ($locked) extends ClickStore {
            public function __construct(private readonly ?array $locked)
            {
                // Deliberately skip the parent constructor — no PDO needed
                // for a stub that only overrides findLockedClick().
            }

            public function findLockedClick(string $clickId): ?array
            {
                return $this->locked;
            }
        };
    }

    public function test_claim_rejects_when_click_id_references_no_locked_click(): void
    {
        $tracker = new ConversionTracker(null, new ReferralConfig(), $this->stubClicks(null));
        $result = $tracker->claim(
            referralCode: 'CODE1',
            deviceId: 'device-1',
            platform: 'ios',
            clickId: 'nonexistent-click-id',
        );
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_when_locked_click_belongs_to_a_different_referral_code(): void
    {
        $locked = [
            'referral_code'     => 'REAL-CODE',
            'matched_device_id' => ConversionTracker::hashDeviceId('device-1'),
            'match_method'      => 'fingerprint',
            'match_confidence'  => 85.0,
        ];
        $tracker = new ConversionTracker(null, new ReferralConfig(), $this->stubClicks($locked));
        $result = $tracker->claim(
            referralCode: 'FORGED-CODE', // attacker knows a code, not the one this click locked
            deviceId: 'device-1',
            platform: 'ios',
            clickId: 'some-click-id',
        );
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_when_locked_click_belongs_to_a_different_device(): void
    {
        $locked = [
            'referral_code'     => 'CODE1',
            'matched_device_id' => ConversionTracker::hashDeviceId('the-real-device'),
            'match_method'      => 'fingerprint',
            'match_confidence'  => 85.0,
        ];
        $tracker = new ConversionTracker(null, new ReferralConfig(), $this->stubClicks($locked));
        $result = $tracker->claim(
            referralCode: 'CODE1',
            deviceId: 'attacker-fabricated-device-id', // never went through /click or /match
            platform: 'ios',
            clickId: 'some-click-id',
        );
        $this->assertSame(['success' => false, 'unverified' => true], $result);
    }

    public function test_claim_rejects_a_bare_fabricated_claim_with_no_prior_click_or_match(): void
    {
        // The original finding's exact failure scenario: POST /claim with an
        // arbitrary referral_code + freshly-generated device_id + no real click.
        $tracker = new ConversionTracker(null, new ReferralConfig(), $this->stubClicks(null));
        $result = $tracker->claim(
            referralCode: 'ANY-CODE-I-KNOW',
            deviceId: bin2hex(random_bytes(16)),
            platform: 'ios',
            clickId: bin2hex(random_bytes(16)), // guessed — doesn't reference a real row
        );
        $this->assertSame(['success' => false, 'unverified' => true], $result);
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
