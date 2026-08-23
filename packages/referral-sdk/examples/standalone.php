<?php

declare(strict_types=1);

/**
 * Standalone usage — no framework. Wire the core services to a PDO handle and
 * call them from your own router. Run `composer dump-autoload` first, or
 * require the classes manually.
 *
 * Mirrors exactly what ClickController/MatchController/ConversionTracker's
 * claim() do under Laravel (see src/Controllers/*.php) — same signed-token
 * flow, same signatures. See docs/decisions.md #21/#22 for why /claim needs
 * a token rather than trusting whatever the request body says happened.
 */

require __DIR__ . '/../vendor/autoload.php';

use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Services\FingerprintMatcher;
use Sparkle\Referral\Support\ClickToken;
use Sparkle\Referral\Support\CodeValidator;
use Sparkle\Referral\Support\ReferralConfig;

$pdo = new PDO('mysql:host=127.0.0.1;dbname=app;charset=utf8mb4', 'user', 'pass', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$config = new ReferralConfig([
    'match_window_hours' => 48,
    'min_confidence'     => 70,
    // Required — every /click mints a signed token with this. Generate one
    // with `openssl rand -hex 32` and load it from the environment in real
    // code; hardcoded here only because this file has no framework config
    // layer to read an env var from.
    'click_token_secret' => getenv('REFERRAL_CLICK_TOKEN_SECRET') ?: 'change-me-before-deploying',
    // 'code_validator'  => fn (string $c) => MyCodes::exists($c),
]);

$clicks      = new ClickStore($pdo, $config);
$matcher     = new FingerprintMatcher($pdo, $config);
$conversions = new ConversionTracker($pdo, $config, $clicks);

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
$stored = $clicks->store(
    referralCode: $body['referral_code'] ?? '',
    fingerprint: $body['fingerprint'] ?? [],
    ip: $requestIp,
);
// Signed for free, right here — this is what lets the deterministic
// recovery paths (Android referrer, iOS clipboard) stay fully local and
// network-free later; the mobile SDK reads it straight off the
// referrer/clipboard and only ever sends it back at /claim.
$token = ClickToken::sign($stored['click_id'], $stored['expires_at'], $config->requireClickTokenSecret());
echo json_encode(['success' => true, 'click_id' => $stored['click_id'], 'token' => $token]);

// --- POST /api/referral/match ---------------------------------------------
$deviceId = ConversionTracker::resolveDeviceId($body['device_id'] ?? '', $config);
$fingerprint = ($body['fingerprint'] ?? []) + ['platform' => $body['platform'] ?? null];
$match = $matcher->match($fingerprint, $requestIp);
// Lock atomically — if another request won the race, report no match
// rather than handing the same click to two devices.
if ($match && $clicks->lockToDevice($match['click_id'], $deviceId, 'fingerprint', $match['confidence'])) {
    $token = ClickToken::sign($match['click_id'], $match['expires_at'], $config->requireClickTokenSecret());
    echo json_encode([
        'matched'       => true,
        'referral_code' => $match['referral_code'],
        'click_id'      => $match['click_id'],
        'token'         => $token,
        'confidence'    => $match['confidence'],
        'match_method'  => 'fingerprint',
    ]);
} else {
    echo json_encode(['matched' => false, 'referral_code' => null]);
}

// --- POST /api/referral/claim ---------------------------------------------
// `token` is the entire proof this is legitimate — no referral_code or
// click_id in the request at all; both are derived from the click the
// verified token references. See ConversionTracker::claim().
$result = $conversions->claim(
    deviceId: $body['device_id'] ?? '',
    platform: $body['platform'] ?? 'android',
    token: $body['token'] ?? '',
    method: $body['method'] ?? null,
    userId: $body['user_id'] ?? null,
);
echo json_encode($result);
