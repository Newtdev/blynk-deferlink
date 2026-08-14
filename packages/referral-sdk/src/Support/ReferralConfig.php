<?php

declare(strict_types=1);

namespace Sparkle\Referral\Support;

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
    public readonly bool $hashDeviceIds;

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
        $this->hashDeviceIds          = (bool) ($c['hash_device_ids'] ?? true);

        $scoring = (array) ($c['scoring'] ?? []);
        $this->scoring = [
            'ip_match'          => (int) ($scoring['ip_match'] ?? 40),
            'device_model'      => (int) ($scoring['device_model'] ?? 25),
            'screen_dimensions' => (int) ($scoring['screen_dimensions'] ?? 15),
            'timezone'          => (int) ($scoring['timezone'] ?? 10),
            'language'          => (int) ($scoring['language'] ?? 10),
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
}
