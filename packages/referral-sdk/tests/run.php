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

use Sparkle\Referral\Services\FingerprintMatcher;
use Sparkle\Referral\Support\ReferralConfig;

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

$storedIos = [
    'ip_address'    => '102.89.1.1',
    'user_agent'    => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
    'screen_width'  => 390,
    'screen_height' => 844,
    'timezone'      => 'Africa/Lagos',
    'language'      => 'en-NG',
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

$assert('perfect match = 100', 100.0, $matcher->score($storedIos, $iosDevice));

$wifiChanged = $iosDevice;
$wifiChanged['ip'] = '197.210.9.9';
$assert('IP change = 60 (no match)', 60.0, $matcher->score($storedIos, $wifiChanged));

$ipOnly = [
    'ip' => '102.89.1.1', 'device_model' => 'Pixel 7', 'platform' => 'android',
    'screen_width' => 1080, 'screen_height' => 2400,
    'timezone' => 'America/New_York', 'language' => 'fr-FR',
];
$assert('IP alone = 40 (insufficient)', 40.0, $matcher->score($storedIos, $ipOnly));

$swapped = $iosDevice;
[$swapped['screen_width'], $swapped['screen_height']] = [844, 390];
$assert('screen orientation ignored = 100', 100.0, $matcher->score($storedIos, $swapped));

$storedGb = $storedIos;
$storedGb['language'] = 'en-GB';
$assert('language primary subtag = 100', 100.0, $matcher->score($storedGb, $iosDevice));

$storedAndroid = [
    'ip_address'    => '10.0.0.1',
    'user_agent'    => 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A) AppleWebKit/537.36',
    'screen_width'  => 412, 'screen_height' => 915,
    'timezone'      => 'Africa/Lagos', 'language' => 'en',
];
$androidDevice = [
    'ip' => '10.0.0.1', 'device_model' => 'Pixel 7', 'platform' => 'android',
    'screen_width' => 412, 'screen_height' => 915,
    'timezone' => 'Africa/Lagos', 'language' => 'en',
];
$assert('android OS-family match = 100', 100.0, $matcher->score($storedAndroid, $androidDevice));

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);
