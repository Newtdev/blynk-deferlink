<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two independent fixes, one migration:
 *
 * - `referral_clicks.language` widens from VARCHAR(10) to VARCHAR(35) —
 *   Node's schema was already 35 (real device locale identifiers run
 *   longer than a bare BCP-47 primary tag; iOS Simulator reports
 *   "en_US_POSIX", 11 chars), so a real value the Node backend accepts
 *   was silently rejected by this backend's own validation. See
 *   docs/decisions.md #23.
 * - `referral_conversions.reward_status` — see ConversionTracker::claim().
 *
 * The `language` column change needs `doctrine/dbal` installed in the
 * host app (Laravel's `->change()` requires it) — add it as a dev
 * dependency if this migration fails with a missing-class error.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('referral_clicks', function (Blueprint $table) {
            $table->string('language', 35)->nullable()->change();
        });

        Schema::table('referral_conversions', function (Blueprint $table) {
            $table->string('reward_status', 10)->default('granted')->after('match_confidence');
        });
    }

    public function down(): void
    {
        Schema::table('referral_clicks', function (Blueprint $table) {
            $table->string('language', 10)->nullable()->change();
        });

        Schema::table('referral_conversions', function (Blueprint $table) {
            $table->dropColumn('reward_status');
        });
    }
};
