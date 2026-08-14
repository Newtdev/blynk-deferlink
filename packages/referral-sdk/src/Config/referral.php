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
    | Lowest fingerprint score (0-100) accepted as a match. IP alone is worth
    | 40, so 70 forces at least IP + one strong signal.
    */
    'min_confidence' => 70,

    /*
    |--------------------------------------------------------------------------
    | Rate limits
    |--------------------------------------------------------------------------
    */
    'rate_limit_clicks_per_hour' => 10,
    'rate_limit_matches_per_day' => 5,

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
    */
    'scoring' => [
        'ip_match'          => 40,
        'device_model'      => 25,
        'screen_dimensions' => 15,
        'timezone'          => 10,
        'language'          => 10,
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
