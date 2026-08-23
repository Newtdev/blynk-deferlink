<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use BlynkDeferlink\Referral\Support\ReferralConfig;
use Symfony\Component\HttpFoundation\Response;

/**
 * Throttles referral endpoints.
 *
 *   Route middleware alias: 'referral.throttle'
 *   Usage: ->middleware('referral.throttle:click')  // per-IP, per-hour
 *          ->middleware('referral.throttle:match')  // per-device, per-day
 *          ->middleware('referral.throttle:claim')  // per-device, per-hour
 */
class ReferralRateLimit
{
    public function __construct(private readonly ReferralConfig $config)
    {
    }

    public function handle(Request $request, Closure $next, string $bucket = 'click'): Response
    {
        [$key, $max, $decay] = $this->limits($request, $bucket);

        if (RateLimiter::tooManyAttempts($key, $max)) {
            return response()->json([
                'success'     => false,
                'error'       => 'rate_limited',
                'retry_after' => RateLimiter::availableIn($key),
            ], 429);
        }

        RateLimiter::hit($key, $decay);

        return $next($request);
    }

    /** @return array{0:string,1:int,2:int} [key, maxAttempts, decaySeconds] */
    private function limits(Request $request, string $bucket): array
    {
        if ($bucket === 'match') {
            $deviceId = (string) $request->input('device_id', $request->ip());
            return [
                'referral:match:' . sha1($deviceId),
                $this->config->rateLimitMatchesPerDay,
                86400,
            ];
        }

        if ($bucket === 'claim') {
            $deviceId = (string) $request->input('device_id', $request->ip());
            return [
                'referral:claim:' . sha1($deviceId),
                $this->config->rateLimitClaimsPerHour,
                3600,
            ];
        }

        // Default: click bucket, per IP per hour.
        return [
            'referral:click:' . sha1((string) $request->ip()),
            $this->config->rateLimitClicksPerHour,
            3600,
        ];
    }
}
