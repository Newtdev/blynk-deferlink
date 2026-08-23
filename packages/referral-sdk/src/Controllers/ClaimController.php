<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use BlynkDeferlink\Referral\Services\ConversionTracker;

/**
 * POST /referral/claim — called by the mobile app after a successful match
 * and user signup. Records the conversion and distributes rewards.
 */
class ClaimController
{
    public function __construct(
        private readonly ConversionTracker $conversions,
    ) {
    }

    public function __invoke(Request $request): JsonResponse
    {
        // No referral_code, no click_id: both are derived server-side from
        // the click a verified token references, never trusted from the
        // request. `method` is only meaningful if that click hasn't been
        // matched yet — a labeling detail, not a security check either
        // way. See docs/decisions.md #21/#22.
        $data = $request->validate([
            'device_id' => ['required', 'string', 'max:255'],
            'platform'  => ['required', 'in:ios,android'],
            'token'     => ['required', 'string', 'max:512'],
            'method'    => ['nullable', 'in:install_referrer,clipboard,fingerprint'],
            'user_id'   => ['nullable', 'string', 'max:255'],
        ]);

        $result = $this->conversions->claim(
            deviceId: $data['device_id'],
            platform: $data['platform'],
            token: $data['token'],
            method: $data['method'] ?? null,
            userId: $data['user_id'] ?? null,
        );

        if (!($result['success'] ?? false)) {
            if ($result['unverified'] ?? false) {
                // Token failed verification (forged/tampered/expired),
                // doesn't reference a real click, or references a click
                // locked to a different device — no real /click + /match
                // happened for this device. See docs/decisions.md #22.
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
