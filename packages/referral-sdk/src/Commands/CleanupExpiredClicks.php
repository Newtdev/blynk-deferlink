<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Commands;

use Illuminate\Console\Command;
use BlynkDeferlink\Referral\Services\ClickStore;

/**
 * Deletes unmatched clicks past their 48h (configurable) expiry, taking their
 * fingerprint/IP data with them. Schedule hourly.
 *
 *   $schedule->command('referral:cleanup-expired')->hourly();
 */
class CleanupExpiredClicks extends Command
{
    protected $signature = 'referral:cleanup-expired';

    protected $description = 'Delete expired, unmatched referral clicks and their fingerprint data.';

    public function handle(ClickStore $clicks): int
    {
        $deleted = $clicks->deleteExpired();

        $this->info("Removed {$deleted} expired referral click(s).");

        return self::SUCCESS;
    }
}
