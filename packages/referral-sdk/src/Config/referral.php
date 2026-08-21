<?php

declare(strict_types=1);

return [
    /*
    |--------------------------------------------------------------------------
    | Match window
    |--------------------------------------------------------------------------
    | How long a stored click stays eligible for matching after it is created.
    */
    'match_window_hours' => 48,

    /*
    |--------------------------------------------------------------------------
    | Minimum confidence
    |--------------------------------------------------------------------------
    | Lowest fingerprint score (0-100) accepted as a match. IP alone (25) plus
    | a fresh recency credit (15) still isn't enough on its own — 70 forces
    | at least one more independent signal (device model, screen, timezone,
    | or language) to agree too.
    */
    'min_confidence' => 70,

    /*
    |--------------------------------------------------------------------------
    | Rate limits
    |--------------------------------------------------------------------------
    */
    'rate_limit_clicks_per_hour' => 10,
    'rate_limit_matches_per_day' => 5,
    // Previously unthrottled entirely — see docs/decisions.md #21.
    'rate_limit_claims_per_hour' => 10,

    /*
    |--------------------------------------------------------------------------
    | Privacy
    |--------------------------------------------------------------------------
    | Hash device IDs (SHA-256, one-way) before storing. Used for dedup only.
    */
    'hash_device_ids' => true,

    /*
    |--------------------------------------------------------------------------
    | Route registration
    |--------------------------------------------------------------------------
    */
    'routes' => [
        'enabled'    => true,
        'prefix'     => 'api/referral',
        'middleware' => ['api'],
    ],

    /*
    |--------------------------------------------------------------------------
    | Scoring weights (must sum to 100)
    |--------------------------------------------------------------------------
    | ip_match was 40 before `recency` existed; lowered to 25 once recency
    | started picking up the slack — a network switch between click and
    | install no longer fails the match outright on its own. This file used
    | to omit `recency` entirely, which silently fell back to
    | ReferralConfig's own default (15) on top of the old ip_match=40,
    | pushing the real ceiling to 115 instead of 100 — see decisions.md #21.
    */
    'scoring' => [
        'ip_match'          => 25,
        'device_model'      => 25,
        'screen_dimensions' => 15,
        'timezone'          => 10,
        'language'          => 10,
        'recency'           => 15,
    ],

    /*
    |--------------------------------------------------------------------------
    | Referral-code validation
    |--------------------------------------------------------------------------
    | A callable or a class name with a public `validate(string $code): bool`.
    | Leave null to accept any non-empty code (development only).
    |
    |   'code_validator' => \App\Referral\CodeValidator::class,
    */
    'code_validator' => null,

    /*
    |--------------------------------------------------------------------------
    | Rewards
    |--------------------------------------------------------------------------
    | `on_claim_callback` is a callable or a class with a public
    | `handle(string $code, ?string $userId, array $config): void` used to
    | actually credit accounts when a claim succeeds.
    */
    'rewards' => [
        'enabled'           => true,
        'referrer_reward'   => 500,
        'referee_reward'    => 500,
        'reward_type'       => 'credit', // 'credit' | 'points' | 'custom'
        'on_claim_callback' => null,
    ],
];
