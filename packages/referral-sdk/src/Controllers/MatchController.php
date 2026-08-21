<?php

declare(strict_types=1);

namespace Sparkle\Referral\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Services\FingerprintMatcher;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * POST /referral/match — called by the mobile app on first launch: the
 * probabilistic fingerprint path (iOS, or Android fallback when the Install
 * Referrer is empty), or the deterministic redeem path (Android install
 * referrer, iOS clipboard — both already know their click_id, so scoring is
 * skipped entirely in favor of a direct lookup + lock). See
 * docs/decisions.md #21.
 *
 * On a successful match the winning click is locked to the device so it can
 * never be matched again.
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
            'click_id'                    => ['nullable', 'string', 'max:36'],
            'method'                      => ['nullable', 'in:install_referrer,clipboard'],
            'fingerprint'                 => ['nullable', 'array'],
            'fingerprint.user_agent'      => ['nullable', 'string'],
            'fingerprint.device_model'    => ['nullable', 'string', 'max:100'],
            'fingerprint.screen_width'    => ['nullable', 'integer'],
            'fingerprint.screen_height'   => ['nullable', 'integer'],
            'fingerprint.timezone'        => ['nullable', 'string', 'max:100'],
            'fingerprint.language'        => ['nullable', 'string', 'max:10'],
        ]);

        $storedDeviceId = ConversionTracker::resolveDeviceId($data['device_id'], $this->config);

        if (!empty($data['click_id'])) {
            $candidate = $this->clicks->findUnmatchedClick($data['click_id']);
            if ($candidate === null) {
                return response()->json(['matched' => false, 'referral_code' => null]);
            }

            $method = $data['method'] ?? 'install_referrer';
            if (!$this->clicks->lockToDevice($data['click_id'], $storedDeviceId, $method)) {
                return response()->json(['matched' => false, 'referral_code' => null]);
            }

            return response()->json([
                'matched'       => true,
                'referral_code' => $candidate['referral_code'],
                'click_id'      => $data['click_id'],
                'match_method'  => $method,
            ]);
        }

        $fingerprint = $data['fingerprint'] ?? [];
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

        return response()->json([
            'matched'       => true,
            'referral_code' => $result['referral_code'],
            'click_id'      => $result['click_id'],
            'confidence'    => $result['confidence'],
            'match_method'  => 'fingerprint',
        ]);
    }
}
