<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Support;

/**
 * Immutable configuration holder. Hydrated from a plain array so the same
 * object works whether config comes from Laravel's config() or a bare
 * require of a PHP file in a standalone project.
 */
final class ReferralConfig
{
    public readonly int $matchWindowHours;
    public readonly float $minConfidence;
    public readonly int $rateLimitClicksPerHour;
    public readonly int $rateLimitMatchesPerDay;
    public readonly int $rateLimitClaimsPerHour;
    public readonly bool $hashDeviceIds;
    public readonly ?string $clickTokenSecret;

    /** @var array<string,int> */
    public readonly array $scoring;

    /** @var array<string,mixed> */
    public readonly array $rewards;

    /** @param array<string,mixed> $c */
    public function __construct(array $c = [])
    {
        $this->matchWindowHours       = (int) ($c['match_window_hours'] ?? 48);
        $this->minConfidence          = (float) ($c['min_confidence'] ?? 70);
        $this->rateLimitClicksPerHour = (int) ($c['rate_limit_clicks_per_hour'] ?? 10);
        $this->rateLimitMatchesPerDay = (int) ($c['rate_limit_matches_per_day'] ?? 5);
        $this->rateLimitClaimsPerHour = (int) ($c['rate_limit_claims_per_hour'] ?? 10);
        $this->hashDeviceIds          = (bool) ($c['hash_device_ids'] ?? true);
        $this->clickTokenSecret       = $c['click_token_secret'] ?? null;

        $scoring = (array) ($c['scoring'] ?? []);
        $this->scoring = [
            // Lowered from 40 now that recency picks up the slack — a
            // network switch between click and install no longer fails
            // the match outright.
            'ip_match'          => (int) ($scoring['ip_match'] ?? 25),
            'device_model'      => (int) ($scoring['device_model'] ?? 25),
            'screen_dimensions' => (int) ($scoring['screen_dimensions'] ?? 15),
            'timezone'          => (int) ($scoring['timezone'] ?? 10),
            'language'          => (int) ($scoring['language'] ?? 10),
            'recency'           => (int) ($scoring['recency'] ?? 15),
        ];

        $rewards = (array) ($c['rewards'] ?? []);
        $this->rewards = [
            'enabled'          => (bool) ($rewards['enabled'] ?? true),
            'referrer_reward'  => $rewards['referrer_reward'] ?? 500,
            'referee_reward'   => $rewards['referee_reward'] ?? 500,
            'reward_type'      => (string) ($rewards['reward_type'] ?? 'credit'),
            'on_claim_callback' => $rewards['on_claim_callback'] ?? null,
        ];
    }

    public function matchWindowSeconds(): int
    {
        return $this->matchWindowHours * 3600;
    }

    /**
     * Required, not optional — every /click needs this to mint a token, so
     * an unconfigured deploy should fail loudly and immediately (at the
     * point something actually tries to sign/verify one, not at
     * construction — score()'s existing unit tests build a bare
     * `new ReferralConfig()` with no secret and must keep working
     * untouched) rather than silently mint tokens no one can ever verify.
     */
    public function requireClickTokenSecret(): string
    {
        if ($this->clickTokenSecret === null || $this->clickTokenSecret === '') {
            throw new \RuntimeException(
                'click_token_secret is not set. Generate one (e.g. `openssl rand -hex 32`) ' .
                'and set REFERRAL_CLICK_TOKEN_SECRET in your environment — every /click mints ' .
                'a signed proof with it, and /claim can\'t verify anything without the same value.',
            );
        }

        return $this->clickTokenSecret;
    }
}
