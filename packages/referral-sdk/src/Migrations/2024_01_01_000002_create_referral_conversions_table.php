<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('referral_conversions', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('click_id', 36);
            $table->string('referral_code', 50);
            $table->string('device_id', 255)->unique();
            $table->enum('platform', ['ios', 'android']);
            $table->enum('match_method', ['install_referrer', 'fingerprint', 'clipboard']);
            $table->decimal('match_confidence', 5, 2)->nullable();
            $table->string('user_id', 255)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index('device_id', 'idx_device');
            $table->index('user_id', 'idx_user');
            $table->index('referral_code', 'idx_code');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('referral_conversions');
    }
};
