<?php

declare(strict_types=1);

namespace Sparkle\Referral\Tests;

use PHPUnit\Framework\TestCase;
use Sparkle\Referral\Services\FingerprintMatcher;
use Sparkle\Referral\Support\ReferralConfig;

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

    private function storedIosClick(): array
    {
        return [
            'ip_address'    => '102.89.1.1',
            'user_agent'    => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
            'screen_width'  => 390,
            'screen_height' => 844,
            'timezone'      => 'Africa/Lagos',
            'language'      => 'en-NG',
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
        $score = $this->matcher()->score($this->storedIosClick(), $this->iosDeviceFingerprint());
        $this->assertSame(100.0, $score);
    }

    public function test_ip_change_drops_below_threshold(): void
    {
        // Scenario C: user switched WiFi. IP no longer matches.
        $incoming = $this->iosDeviceFingerprint();
        $incoming['ip'] = '197.210.9.9';

        $score = $this->matcher()->score($this->storedIosClick(), $incoming);

        // device(25) + screen(15) + tz(10) + lang(10) = 60 < 70
        $this->assertSame(60.0, $score);
        $this->assertLessThan(70.0, $score);
    }

    public function test_ip_alone_is_insufficient(): void
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

        $score = $this->matcher()->score($stored, $incoming);

        $this->assertSame(40.0, $score);
        $this->assertLessThan(70.0, $score);
    }

    public function test_screen_orientation_is_ignored(): void
    {
        $stored = $this->storedIosClick();
        $incoming = $this->iosDeviceFingerprint();
        // Swap width/height — should still count.
        [$incoming['screen_width'], $incoming['screen_height']] = [844, 390];

        $this->assertSame(100.0, $this->matcher()->score($stored, $incoming));
    }

    public function test_language_primary_subtag_matches(): void
    {
        $stored = $this->storedIosClick();
        $stored['language'] = 'en-GB';
        $incoming = $this->iosDeviceFingerprint();
        $incoming['language'] = 'en-NG';

        // en == en, still a full match.
        $this->assertSame(100.0, $this->matcher()->score($stored, $incoming));
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

        $this->assertSame(100.0, $this->matcher()->score($stored, $incoming));
    }
}
