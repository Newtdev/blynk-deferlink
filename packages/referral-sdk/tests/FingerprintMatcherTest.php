<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Tests;

use PHPUnit\Framework\TestCase;
use BlynkDeferlink\Referral\Services\FingerprintMatcher;
use BlynkDeferlink\Referral\Support\ReferralConfig;

/**
 * Exercises the pure score() function — no database required. A dummy PDO is
 * passed only to satisfy the constructor; score() never touches it.
 */
final class FingerprintMatcherTest extends TestCase
{
    private function matcher(): FingerprintMatcher
    {
        // score() is pure — no PDO needed.
        return new FingerprintMatcher(null, new ReferralConfig());
    }

    /** Fixed instant so recency tests are deterministic. */
    private function now(): int
    {
        return strtotime('2026-08-14T12:00:00Z');
    }

    private function storedIosClick(): array
    {
        return [
            'ip_address'    => '102.89.1.1',
            'user_agent'    => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
            'screen_width'  => 390,
            'screen_height' => 844,
            'timezone'      => 'Africa/Lagos',
            'language'      => 'en-NG',
            // Fresh by default — recency contributes full weight.
            'created_at'    => gmdate('Y-m-d H:i:s', $this->now()),
        ];
    }

    private function iosDeviceFingerprint(): array
    {
        return [
            'ip'            => '102.89.1.1',
            'device_model'  => 'iPhone14,5',
            'platform'      => 'ios',
            'screen_width'  => 390,
            'screen_height' => 844,
            'timezone'      => 'Africa/Lagos',
            'language'      => 'en-NG',
        ];
    }

    public function test_perfect_match_scores_100(): void
    {
        $score = $this->matcher()->score($this->storedIosClick(), $this->iosDeviceFingerprint(), $this->now());
        $this->assertSame(100.0, $score);
    }

    public function test_ip_change_no_longer_fails_a_fresh_match(): void
    {
        // Scenario C: user switched WiFi. IP no longer matches.
        $incoming = $this->iosDeviceFingerprint();
        $incoming['ip'] = '197.210.9.9';

        $score = $this->matcher()->score($this->storedIosClick(), $incoming, $this->now());

        // device(25) + screen(15) + tz(10) + lang(10) + recency(15, fresh) = 75 >= 70
        // This is the whole point of recency: a network switch between click
        // and install no longer fails the match outright, as long as the
        // install happens promptly.
        $this->assertSame(75.0, $score);
        $this->assertGreaterThanOrEqual(70.0, $score);
    }

    public function test_ip_change_on_a_stale_click_still_fails(): void
    {
        $stored = $this->storedIosClick(); // created_at: now()
        $incoming = $this->iosDeviceFingerprint();
        $incoming['ip'] = '197.210.9.9';

        $config = new ReferralConfig();
        $wayLater = $this->now() + $config->matchWindowSeconds(); // window edge — recency is 0

        $score = $this->matcher()->score($stored, $incoming, $wayLater);

        // device(25) + screen(15) + tz(10) + lang(10) + recency(0) = 60 < 70
        $this->assertSame(60.0, $score);
        $this->assertLessThan(70.0, $score);
    }

    public function test_recency_decays_linearly_across_the_match_window(): void
    {
        $stored = $this->storedIosClick(); // created_at: now()
        $config = new ReferralConfig();
        $halfway = $this->now() + intdiv($config->matchWindowSeconds(), 2);

        // Everything else mismatched so only recency contributes.
        $incoming = [
            'ip'            => '0.0.0.0',
            'device_model'  => 'Pixel 7',
            'platform'      => 'android',
            'screen_width'  => 1,
            'screen_height' => 1,
            'timezone'      => 'nowhere',
            'language'      => 'zz',
        ];

        $score = $this->matcher()->score($stored, $incoming, $halfway);
        $this->assertSame(7.5, $score); // half of recency's 15
    }

    public function test_ip_alone_is_insufficient_even_fresh(): void
    {
        $stored = $this->storedIosClick();
        $incoming = [
            'ip'            => '102.89.1.1', // matches
            'device_model'  => 'Pixel 7',    // android — OS mismatch
            'platform'      => 'android',
            'screen_width'  => 1080,
            'screen_height' => 2400,
            'timezone'      => 'America/New_York',
            'language'      => 'fr-FR',
        ];

        $score = $this->matcher()->score($stored, $incoming, $this->now());

        // ip(25) + recency(15, fresh) = 40 < 70
        $this->assertSame(40.0, $score);
        $this->assertLessThan(70.0, $score);
    }

    public function test_screen_orientation_is_ignored(): void
    {
        $stored = $this->storedIosClick();
        $incoming = $this->iosDeviceFingerprint();
        // Swap width/height — should still count.
        [$incoming['screen_width'], $incoming['screen_height']] = [844, 390];

        $this->assertSame(100.0, $this->matcher()->score($stored, $incoming, $this->now()));
    }

    public function test_language_primary_subtag_matches(): void
    {
        $stored = $this->storedIosClick();
        $stored['language'] = 'en-GB';
        $incoming = $this->iosDeviceFingerprint();
        $incoming['language'] = 'en-NG';

        // en == en, still a full match.
        $this->assertSame(100.0, $this->matcher()->score($stored, $incoming, $this->now()));
    }

    public function test_android_model_matches_by_os_family(): void
    {
        $stored = [
            'ip_address'    => '10.0.0.1',
            'user_agent'    => 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A) AppleWebKit/537.36',
            'screen_width'  => 412,
            'screen_height' => 915,
            'timezone'      => 'Africa/Lagos',
            'language'      => 'en',
            'created_at'    => gmdate('Y-m-d H:i:s', $this->now()),
        ];
        $incoming = [
            'ip'            => '10.0.0.1',
            'device_model'  => 'Pixel 7',
            'platform'      => 'android',
            'screen_width'  => 412,
            'screen_height' => 915,
            'timezone'      => 'Africa/Lagos',
            'language'      => 'en',
        ];

        $this->assertSame(100.0, $this->matcher()->score($stored, $incoming, $this->now()));
    }

    /**
     * Both backends' score() functions are meant to agree on every input —
     * "ported field-for-field" — but nothing mechanically enforced that
     * until now. The ip_match weight-drift (decisions.md #21/#22) and the
     * language-split divergence (decisions.md #23 — this backend's own
     * hardcoded tests above never had an underscore-locale case, because
     * until #23's fix there was no way to write one that passed) both
     * shipped and went live before an outside review caught them; neither
     * suite's hardcoded cases (which only ever exercised each backend
     * against itself) could have caught either. This fixture is loaded by
     * both this file and fingerprintMatcher.parity.test.ts (Node) — a case
     * added here and not mirrored there, or vice versa, is a real gap.
     */
    public function test_parity_fixture_matches_node(): void
    {
        $path = __DIR__ . '/../../../docs/fixtures/fingerprint-match-cases.json';
        $cases = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);

        foreach ($cases as $case) {
            $stored = $case['stored'];
            $incoming = $case['incoming'];
            $now = strtotime($case['now']);

            $score = $this->matcher()->score($stored, $incoming, $now);

            $this->assertSame(
                (float) $case['expected_score'],
                $score,
                "parity fixture case failed: {$case['name']}"
            );
        }
    }
}
