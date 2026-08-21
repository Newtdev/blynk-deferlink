<?php

declare(strict_types=1);

namespace Sparkle\Referral\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Support\ClickToken;
use Sparkle\Referral\Support\CodeValidator;
use Sparkle\Referral\Support\ReferralConfig;

/**
 * POST /referral/click — called by the landing page when a user arrives.
 */
class ClickController
{
    public function __construct(
        private readonly ClickStore $clicks,
        private readonly CodeValidator $codes,
        private readonly ReferralConfig $config,
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

        $stored = $this->clicks->store(
            referralCode: $code,
            fingerprint: $data['fingerprint'],
            ip: (string) $request->ip(),
        );

        // Signed for free, right here — this is what lets the deterministic
        // recovery paths (Android referrer, iOS clipboard) stay fully local
        // and network-free: the mobile SDK reads this token straight off
        // the referrer/clipboard and only ever sends it back at /claim, not
        // at recovery time. See docs/decisions.md #22.
        $token = ClickToken::sign($stored['click_id'], $stored['expires_at'], $this->config->requireClickTokenSecret());

        return response()->json([
            'success'  => true,
            'click_id' => $stored['click_id'],
            'token'    => $token,
        ]);
    }
}
