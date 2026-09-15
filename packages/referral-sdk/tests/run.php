<?php

declare(strict_types=1);

/**
 * Zero-dependency sanity check for the scoring engine.
 * Run with:  php tests/run.php
 * No composer install / PHPUnit required.
 */

require __DIR__ . '/../src/Support/UserAgentParser.php';
require __DIR__ . '/../src/Support/ReferralConfig.php';
require __DIR__ . '/../src/Services/FingerprintMatcher.php';

use BlynkDeferlink\Referral\Services\FingerprintMatcher;
use BlynkDeferlink\Referral\Support\ReferralConfig;

$matcher = new FingerprintMatcher(null, new ReferralConfig());

$pass = 0;
$fail = 0;
$assert = function (string $name, float $expected, float $actual) use (&$pass, &$fail): void {
    if (abs($expected - $actual) < 0.001) {
        echo "  ✓ {$name}\n";
        $pass++;
    } else {
        echo "  ✗ {$name}  (expected {$expected}, got {$actual})\n";
        $fail++;
    }
};

// Fixed instant so recency-dependent assertions are deterministic.
$now = strtotime('2026-08-14T12:00:00Z');
$windowSeconds = (new ReferralConfig())->matchWindowSeconds();

$storedIos = [
    'ip_address'    => '102.89.1.1',
    'user_agent'    => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
    'screen_width'  => 390,
    'screen_height' => 844,
    'timezone'      => 'Africa/Lagos',
    'language'      => 'en-NG',
    // Fresh by default — recency contributes full weight.
    'created_at'    => gmdate('Y-m-d H:i:s', $now),
];

$iosDevice = [
    'ip'            => '102.89.1.1',
    'device_model'  => 'iPhone14,5',
    'platform'      => 'ios',
    'screen_width'  => 390,
    'screen_height' => 844,
    'timezone'      => 'Africa/Lagos',
    'language'      => 'en-NG',
];

echo "FingerprintMatcher scoring\n";

$assert('perfect match = 100', 100.0, $matcher->score($storedIos, $iosDevice, $now));

// device(25) + screen(15) + tz(10) + lang(10) + recency(15, fresh) = 75 >= 70
// A network switch between click and install no longer fails the match
// outright on its own, as long as the install happens promptly.
$wifiChanged = $iosDevice;
$wifiChanged['ip'] = '197.210.9.9';
$assert('IP change, fresh = 75 (still matches)', 75.0, $matcher->score($storedIos, $wifiChanged, $now));

// Same IP change, but recency has fully decayed by the window edge.
// device(25) + screen(15) + tz(10) + lang(10) + recency(0) = 60 < 70
$assert('IP change, stale = 60 (no match)', 60.0, $matcher->score($storedIos, $wifiChanged, $now + $windowSeconds));

// ip(25) + recency(15, fresh) = 40 < 70
$ipOnly = [
    'ip' => '102.89.1.1', 'device_model' => 'Pixel 7', 'platform' => 'android',
    'screen_width' => 1080, 'screen_height' => 2400,
    'timezone' => 'America/New_York', 'language' => 'fr-FR',
];
$assert('IP alone, fresh = 40 (insufficient)', 40.0, $matcher->score($storedIos, $ipOnly, $now));

// Everything else mismatched — halfway through the window, only half of
// recency's 15 points should land.
$nothingElseMatches = [
    'ip' => '0.0.0.0', 'device_model' => 'Pixel 7', 'platform' => 'android',
    'screen_width' => 1, 'screen_height' => 1,
    'timezone' => 'nowhere', 'language' => 'zz',
];
$assert('recency decays to half at window midpoint = 7.5', 7.5, $matcher->score($storedIos, $nothingElseMatches, $now + intdiv($windowSeconds, 2)));

$swapped = $iosDevice;
[$swapped['screen_width'], $swapped['screen_height']] = [844, 390];
$assert('screen orientation ignored = 100', 100.0, $matcher->score($storedIos, $swapped, $now));

$storedGb = $storedIos;
$storedGb['language'] = 'en-GB';
$assert('language primary subtag = 100', 100.0, $matcher->score($storedGb, $iosDevice, $now));

$storedAndroid = [
    'ip_address'    => '10.0.0.1',
    'user_agent'    => 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A) AppleWebKit/537.36',
    'screen_width'  => 412, 'screen_height' => 915,
    'timezone'      => 'Africa/Lagos', 'language' => 'en',
    'created_at'    => gmdate('Y-m-d H:i:s', $now),
];
$androidDevice = [
    'ip' => '10.0.0.1', 'device_model' => 'Pixel 7', 'platform' => 'android',
    'screen_width' => 412, 'screen_height' => 915,
    'timezone' => 'Africa/Lagos', 'language' => 'en',
];
$assert('android OS-family match = 100', 100.0, $matcher->score($storedAndroid, $androidDevice, $now));

// Recency must not depend on the host's timezone. Every assertion above
// runs in whichever single timezone the machine happens to be set to, and
// is self-consistent either way — so they all pass on a UTC host and say
// nothing about any other. (Before the fix these same cases did fail off
// UTC — 7 of 8, scoring 99.6875 on UTC+1, matching what a live UTC+1
// deployment actually returned — but only if you happened to run them
// there.) These cases force the variation instead of depending on it.
//
// The shared parity fixture can't cover this: its created_at carries an
// explicit "Z", which strtotime() honours on any host, so it passes
// everywhere. Production MySQL returns a *naive* string, which is the
// shape that breaks. Node is unaffected (Drizzle returns real Date
// objects), so this is a PHP-only bug, not a parity break — deliberately
// tested here rather than added to the cross-runtime fixture.
$tzBefore = date_default_timezone_get();
foreach (['UTC', 'Africa/Lagos', 'America/New_York'] as $tz) {
    date_default_timezone_set($tz);

    // Naive string with no zone designator — exactly what a MySQL
    // TIMESTAMP column hands back, unlike the fixture's ISO-8601 form.
    $freshUtc = $storedIos;
    $freshUtc['created_at'] = gmdate('Y-m-d H:i:s', $now);
    $assert("perfect match = 100 under {$tz}", 100.0, $matcher->score($freshUtc, $iosDevice, $now));

    // A click at the far edge of the window must still be scored as old.
    // On a negative UTC offset the naive parse pushed $elapsed negative,
    // tripping the "clock skew" clamp and paying full recency credit to a
    // 47-hour-old click (86.5625 instead of 85.3125 under America/New_York).
    $staleUtc = $storedIos;
    $staleUtc['created_at'] = gmdate('Y-m-d H:i:s', $now - 47 * 3600);
    $assert("47h-old click = 85.3125 under {$tz}", 85.3125, $matcher->score($staleUtc, $iosDevice, $now));
}
date_default_timezone_set($tzBefore);

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);
