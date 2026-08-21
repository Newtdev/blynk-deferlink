<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records what actually matched a click, on the click row itself, at the
 * moment it's locked (see ClickStore::lockToDevice). /claim reads these
 * columns instead of trusting whatever method/confidence a claim request
 * itself claims — see docs/decisions.md #21.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('referral_clicks', function (Blueprint $table) {
            $table->enum('match_method', ['install_referrer', 'fingerprint', 'clipboard'])
                ->nullable()
                ->after('matched_at');
            $table->decimal('match_confidence', 5, 2)->nullable()->after('match_method');
        });
    }

    public function down(): void
    {
        Schema::table('referral_clicks', function (Blueprint $table) {
            $table->dropColumn(['match_method', 'match_confidence']);
        });
    }
};
