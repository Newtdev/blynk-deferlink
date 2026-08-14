<?php

declare(strict_types=1);

namespace Sparkle\Referral\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Support\CodeValidator;

/**
 * POST /referral/click — called by the landing page when a user arrives.
 */
class ClickController
{
    public function __construct(
        private readonly ClickStore $clicks,
        private readonly CodeValidator $codes,
    ) {
    }

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'referral_code'              => ['required', 'string', 'max:50'],
            'fingerprint'                => ['required', 'array'],
            'fingerprint.user_agent'     => ['nullable', 'string'],
            'fingerprint.screen_width'   => ['nullable', 'integer'],
            'fingerprint.screen_height'  => ['nullable', 'integer'],
            'fingerprint.pixel_ratio'    => ['nullable', 'numeric'],
            'fingerprint.timezone'       => ['nullable', 'string', 'max:100'],
            'fingerprint.language'       => ['nullable', 'string', 'max:10'],
            'fingerprint.platform'       => ['nullable', 'string', 'max:50'],
            'fingerprint.referrer'       => ['nullable', 'string'],
        ]);

        $code = $data['referral_code'];

        if (!$this->codes->isValid($code)) {
            return response()->json([
                'success' => false,
                'error'   => 'invalid_or_expired_code',
            ], 422);
        }

        $clickId = $this->clicks->store(
            referralCode: $code,
            fingerprint: $data['fingerprint'],
            ip: (string) $request->ip(),
        );

        return response()->json([
            'success'  => true,
            'click_id' => $clickId,
        ]);
    }
}
