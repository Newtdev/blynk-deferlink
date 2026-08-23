<?php

declare(strict_types=1);

namespace Sparkle\Referral\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Services\FingerprintMatcher;
use Sparkle\Referral\Support\ClickToken;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * POST /referral/match — called by the mobile app on first launch (iOS
 * path, or Android fallback when the Install Referrer is empty — its
 * primary path is fully local, no call to this endpoint at all, see
 * docs/decisions.md #22).
 *
 * On a successful match the winning click is locked to the device so it
 * can never be matched again, and the response carries a signed token
 * (same as /click's) so /claim can verify it without a second lookup.
 */
class MatchController
{
    public function __construct(
        private readonly FingerprintMatcher $matcher,
        private readonly ClickStore $clicks,
        private readonly ReferralConfig $config,
    ) {
    }

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_id'                   => ['required', 'string', 'max:255'],
            'platform'                    => ['required', 'in:ios,android'],
            'fingerprint'                 => ['required', 'array'],
            'fingerprint.user_agent'      => ['nullable', 'string'],
            'fingerprint.device_model'    => ['nullable', 'string', 'max:100'],
            'fingerprint.screen_width'    => ['nullable', 'integer'],
            'fingerprint.screen_height'   => ['nullable', 'integer'],
            'fingerprint.timezone'        => ['nullable', 'string', 'max:100'],
            // 35, not 10: real device locale identifiers run longer than a
            // bare BCP-47 primary tag — see decisions.md #23.
            'fingerprint.language'        => ['nullable', 'string', 'max:35'],
        ]);

        $storedDeviceId = ConversionTracker::resolveDeviceId($data['device_id'], $this->config);

        $fingerprint = $data['fingerprint'];
        $fingerprint['platform'] = $data['platform'];

        $result = $this->matcher->match($fingerprint, (string) $request->ip());

        if ($result === null) {
            return response()->json([
                'matched'       => false,
                'referral_code' => null,
            ]);
        }

        // Lock atomically. If another request won the race, report no match
        // rather than handing the same click to two devices.
        if (!$this->clicks->lockToDevice($result['click_id'], $storedDeviceId, 'fingerprint', $result['confidence'])) {
            return response()->json([
                'matched'       => false,
                'referral_code' => null,
            ]);
        }

        $token = ClickToken::sign($result['click_id'], $result['expires_at'], $this->config->requireClickTokenSecret());

        return response()->json([
            'matched'       => true,
            'referral_code' => $result['referral_code'],
            'click_id'      => $result['click_id'],
            'token'         => $token,
            'confidence'    => $result['confidence'],
            'match_method'  => 'fingerprint',
        ]);
    }
}
