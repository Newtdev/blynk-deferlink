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
        // `method`/`confidence` are no longer accepted here at all — they're
        // derived server-side from the click row `click_id` references, not
        // trusted from the request. See docs/decisions.md #21.
        $data = $request->validate([
            'referral_code' => ['required', 'string', 'max:50'],
            'device_id'     => ['required', 'string', 'max:255'],
            'platform'      => ['required', 'in:ios,android'],
            'click_id'      => ['required', 'string', 'max:36'],
            'user_id'       => ['nullable', 'string', 'max:255'],
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
            clickId: $data['click_id'],
            userId: $data['user_id'] ?? null,
        );

        if (!($result['success'] ?? false)) {
            if ($result['unverified'] ?? false) {
                // click_id doesn't reference a click locked to this
                // device+code — no real /click + /match (or deterministic
                // redeem) happened.
                return response()->json([
                    'success' => false,
                    'error'   => 'unverified_claim',
                ], 403);
            }
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
