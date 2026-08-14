<?php

declare(strict_types=1);

/**
 * Standalone usage — no framework. Wire the core services to a PDO handle and
 * call them from your own router. Run `composer dump-autoload` first, or
 * require the classes manually.
 */

require __DIR__ . '/../vendor/autoload.php';

use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Services\FingerprintMatcher;
use Sparkle\Referral\Support\CodeValidator;
use Sparkle\Referral\Support\ReferralConfig;

$pdo = new PDO('mysql:host=127.0.0.1;dbname=app;charset=utf8mb4', 'user', 'pass', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$config = new ReferralConfig([
    'match_window_hours' => 48,
    'min_confidence'     => 70,
    // 'code_validator'  => fn (string $c) => MyCodes::exists($c),
]);

$clicks      = new ClickStore($pdo, $config);
$matcher     = new FingerprintMatcher($pdo, $config);
$conversions = new ConversionTracker($pdo, $config);

// Validate codes against your own table. Return true to accept a click.
$codes = new CodeValidator(fn (string $code): bool => /* MyCodes::exists($code) */ $code !== '');

$requestIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$body      = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];

// --- POST /api/referral/click ---------------------------------------------
if (!$codes->isValid($body['referral_code'] ?? '')) {
    http_response_code(422);
    echo json_encode(['success' => false, 'error' => 'invalid_or_expired_code']);
    exit;
}
$clickId = $clicks->store(
    referralCode: $body['referral_code'] ?? '',
    fingerprint: $body['fingerprint'] ?? [],
    ip: $requestIp,
);
echo json_encode(['success' => true, 'click_id' => $clickId]);

// --- POST /api/referral/match ---------------------------------------------
$fingerprint = ($body['fingerprint'] ?? []) + ['platform' => $body['platform'] ?? null];
$match = $matcher->match($fingerprint, $requestIp);
if ($match && $clicks->lockToDevice($match['click_id'], $body['device_id'] ?? '')) {
    echo json_encode([
        'matched'       => true,
        'referral_code' => $match['referral_code'],
        'confidence'    => $match['confidence'],
        'match_method'  => 'fingerprint',
    ]);
} else {
    echo json_encode(['matched' => false, 'referral_code' => null]);
}

// --- POST /api/referral/claim ---------------------------------------------
$result = $conversions->claim(
    referralCode: $body['referral_code'] ?? '',
    deviceId: $body['device_id'] ?? '',
    platform: $body['platform'] ?? 'android',
    matchMethod: $body['method'] ?? 'fingerprint',
    userId: $body['user_id'] ?? null,
);
echo json_encode($result);
