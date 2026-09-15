<?php

declare(strict_types=1);

/**
 * Zero-dependency sanity check for the scoring engine and for the
 * attribution rules around it.
 * Run with:  php tests/run.php
 * No composer install / PHPUnit required.
 *
 * The attribution section at the bottom needs a database, which it gets
 * from in-memory SQLite with UTC_TIMESTAMP() registered as a custom
 * function — so it still provisions nothing and installs nothing.
 */

require __DIR__ . '/../src/Support/UserAgentParser.php';
require __DIR__ . '/../src/Support/ReferralConfig.php';
require __DIR__ . '/../src/Services/FingerprintMatcher.php';
require __DIR__ . '/../src/Services/ClickStore.php';

use BlynkDeferlink\Referral\Services\ClickStore;
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

// ---------------------------------------------------------------------------
// Attribution rules (docs/decisions.md #30, issue #17)
//
// These need a database, because the bug they guard was never in the scoring
// function — scoring was always correct. It was in which rows the candidate
// query could see. A pure-scoring suite structurally cannot reach it.
// ---------------------------------------------------------------------------

echo "\nAttribution rules\n";

$assertSame = function (string $name, ?string $expected, ?string $actual) use (&$pass, &$fail): void {
    if ($expected === $actual) {
        echo "  ✓ {$name}\n";
        $pass++;
    } else {
        echo "  ✗ {$name}  (expected " . var_export($expected, true)
            . ', got ' . var_export($actual, true) . ")\n";
        $fail++;
    }
};

$freshDb = function (): PDO {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // The SQL is MySQL-flavored; shim the one function it depends on.
    @$pdo->sqliteCreateFunction('UTC_TIMESTAMP', static fn () => gmdate('Y-m-d H:i:s'), 0);
    $pdo->exec(
        'CREATE TABLE referral_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, click_id TEXT NOT NULL,
            referral_code TEXT NOT NULL, ip_address TEXT, user_agent TEXT,
            screen_width INTEGER, screen_height INTEGER, pixel_ratio REAL,
            timezone TEXT, language TEXT, platform TEXT, referrer_url TEXT,
            matched INTEGER DEFAULT 0, matched_device_id TEXT, matched_at TEXT,
            match_method TEXT, match_confidence REAL, created_at TEXT, expires_at TEXT)'
    );
    return $pdo;
};

$phoneUa   = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15';
$phoneClick = [
    'user_agent' => $phoneUa, 'screen_width' => 390, 'screen_height' => 844,
    'timezone' => 'Africa/Lagos', 'language' => 'en-NG',
];
$phoneDevice = [
    'device_model' => 'iPhone', 'platform' => 'ios',
    'screen_width' => 390, 'screen_height' => 844,
    'timezone' => 'Africa/Lagos', 'language' => 'en-NG',
];

// Reinstalling changes the device id on iOS (identifierForVendor is cleared
// when the last vendor app is removed), so each cycle arrives looking like a
// device the table has never seen. Five cycles because the original bug
// returned the code on the first and nothing on every one after.
$pdo = $freshDb();
$matcher = new FingerprintMatcher($pdo, new ReferralConfig());
$store = new ClickStore($pdo, new ReferralConfig());
$store->store('FRIEND99', $phoneClick, '102.89.1.1');

for ($cycle = 1; $cycle <= 5; $cycle++) {
    $deviceId = "device-install-{$cycle}";
    $result = $matcher->match($phoneDevice, '102.89.1.1', $deviceId);
    $assertSame("reinstall #{$cycle} still recovers the clicked code", 'FRIEND99', $result['referral_code'] ?? null);
    if ($result !== null) {
        $store->bindMatch($result['click_id'], $deviceId, $result['confidence']);
    }
}

// Two referrers in the window. Repeating the match must keep returning the
// device's actual referrer, not fall through to the runner-up.
$pdo = $freshDb();
$matcher = new FingerprintMatcher($pdo, new ReferralConfig());
$store = new ClickStore($pdo, new ReferralConfig());
$store->store('ALICE01', $phoneClick, '102.89.1.1');
$store->store('BOB0002', [
    'user_agent' => $phoneUa, 'screen_width' => 430, 'screen_height' => 932,
    'timezone' => 'Africa/Lagos', 'language' => 'en-NG',
], '102.89.1.1');

for ($attempt = 1; $attempt <= 3; $attempt++) {
    $result = $matcher->match($phoneDevice, '102.89.1.1', 'stable-device');
    $assertSame("repeat match #{$attempt} keeps the same referrer", 'ALICE01', $result['referral_code'] ?? null);
    if ($result !== null) {
        $store->bindMatch($result['click_id'], 'stable-device', $result['confidence']);
    }
}

// Attribution is last-click-wins: a newer click that clears the threshold
// takes over an existing binding.
$pdo = $freshDb();
$matcher = new FingerprintMatcher($pdo, new ReferralConfig());
$store = new ClickStore($pdo, new ReferralConfig());
$store->store('ALICE01', $phoneClick, '102.89.1.1');
$first = $matcher->match($phoneDevice, '102.89.1.1', 'dev-1');
$store->bindMatch($first['click_id'], 'dev-1', $first['confidence']);
sleep(1); // created_at has one-second resolution; the new click must be newer
$store->store('CAROL77', $phoneClick, '102.89.1.1');
$second = $matcher->match($phoneDevice, '102.89.1.1', 'dev-1');
$assertSame('a newer qualifying click takes the attribution over', 'CAROL77', $second['referral_code'] ?? null);

// ...but only if it qualifies. An unrelated click must not steal an
// attribution merely by being recent.
$pdo = $freshDb();
$matcher = new FingerprintMatcher($pdo, new ReferralConfig());
$store = new ClickStore($pdo, new ReferralConfig());
$store->store('ALICE01', $phoneClick, '102.89.1.1');
$first = $matcher->match($phoneDevice, '102.89.1.1', 'dev-1');
$store->bindMatch($first['click_id'], 'dev-1', $first['confidence']);
sleep(1);
$store->store('MALLORY1', [
    'user_agent' => 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A) AppleWebKit/537.36',
    'screen_width' => 412, 'screen_height' => 915,
    'timezone' => 'Europe/Berlin', 'language' => 'de',
], '8.8.8.8');
$third = $matcher->match($phoneDevice, '102.89.1.1', 'dev-1');
$assertSame('a newer non-qualifying click does not steal the attribution', 'ALICE01', $third['referral_code'] ?? null);

// A device with no binding and nothing worth matching gets nothing — the
// threshold still has to mean something.
$pdo = $freshDb();
$matcher = new FingerprintMatcher($pdo, new ReferralConfig());
$store = new ClickStore($pdo, new ReferralConfig());
$store->store('NOBODY1', [
    'user_agent' => 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A) AppleWebKit/537.36',
    'screen_width' => 412, 'screen_height' => 915,
    'timezone' => 'Europe/Berlin', 'language' => 'de',
], '8.8.8.8');
$none = $matcher->match($phoneDevice, '102.89.1.1', 'unknown-device');
$assertSame('an unrelated device still matches nothing', null, $none['referral_code'] ?? null);

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);
