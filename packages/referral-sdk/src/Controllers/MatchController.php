<?php

declare(strict_types=1);

namespace Sparkle\Referral\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\FingerprintMatcher;

/**
 * POST /referral/match — called by the mobile app on first launch (iOS path,
 * or Android fallback when the Install Referrer is empty).
 *
 * On a successful match the winning click is locked to the device so it can
 * never be matched again.
 */
class MatchController
{
    public function __construct(
        private readonly FingerprintMatcher $matcher,
        private readonly ClickStore $clicks,
    ) {
    }

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_id'                   => ['required', 'string', 'max:255'],
            'platform'                    => ['required', 'in:ios,android'],
            'method'                      => ['nullable', 'in:fingerprint,install_referrer'],
            'fingerprint'                 => ['required', 'array'],
            'fingerprint.user_agent'      => ['nullable', 'string'],
            'fingerprint.device_model'    => ['nullable', 'string', 'max:100'],
            'fingerprint.screen_width'    => ['nullable', 'integer'],
            'fingerprint.screen_height'   => ['nullable', 'integer'],
            'fingerprint.timezone'        => ['nullable', 'string', 'max:100'],
            'fingerprint.language'        => ['nullable', 'string', 'max:10'],
        ]);

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
        if (!$this->clicks->lockToDevice($result['click_id'], $data['device_id'])) {
            return response()->json([
                'matched'       => false,
                'referral_code' => null,
            ]);
        }

        return response()->json([
            'matched'       => true,
            'referral_code' => $result['referral_code'],
            'confidence'    => $result['confidence'],
            'match_method'  => 'fingerprint',
        ]);
    }
}
