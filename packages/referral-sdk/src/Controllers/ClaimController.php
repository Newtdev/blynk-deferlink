<?php

declare(strict_types=1);

namespace Sparkle\Referral\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Support\CodeValidator;

/**
 * POST /referral/claim — called by the mobile app after a successful match
 * and user signup. Records the conversion and distributes rewards.
 */
class ClaimController
{
    public function __construct(
        private readonly ConversionTracker $conversions,
        private readonly CodeValidator $codes,
    ) {
    }

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'referral_code' => ['required', 'string', 'max:50'],
            'device_id'     => ['required', 'string', 'max:255'],
            'platform'      => ['required', 'in:ios,android'],
            'method'        => ['required', 'in:install_referrer,fingerprint'],
            'user_id'       => ['nullable', 'string', 'max:255'],
            'click_id'      => ['nullable', 'string', 'max:36'],
            'confidence'    => ['nullable', 'numeric'],
        ]);

        if (!$this->codes->isValid($data['referral_code'])) {
            return response()->json([
                'success' => false,
                'error'   => 'invalid_or_expired_code',
            ], 422);
        }

        $result = $this->conversions->claim(
            referralCode: $data['referral_code'],
            deviceId: $data['device_id'],
            platform: $data['platform'],
            matchMethod: $data['method'],
            clickId: $data['click_id'] ?? null,
            userId: $data['user_id'] ?? null,
            confidence: isset($data['confidence']) ? (float) $data['confidence'] : null,
        );

        if (!($result['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'error'   => ($result['duplicate'] ?? false) ? 'already_claimed' : 'claim_failed',
            ], 409);
        }

        return response()->json([
            'success' => true,
            'reward'  => $result['reward'] ?? null,
        ]);
    }
}
