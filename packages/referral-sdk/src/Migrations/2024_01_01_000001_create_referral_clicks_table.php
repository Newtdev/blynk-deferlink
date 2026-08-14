<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('referral_clicks', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('click_id', 36)->unique();
            $table->string('referral_code', 50);

            // Fingerprint data
            $table->string('ip_address', 45);
            $table->text('user_agent')->nullable();
            $table->integer('screen_width')->nullable();
            $table->integer('screen_height')->nullable();
            $table->decimal('pixel_ratio', 3, 2)->nullable();
            $table->string('timezone', 100)->nullable();
            $table->string('language', 10)->nullable();
            $table->string('platform', 50)->nullable();
            $table->text('referrer_url')->nullable();

            // Matching state
            $table->boolean('matched')->default(false);
            $table->string('matched_device_id', 255)->nullable();
            $table->timestamp('matched_at')->nullable();

            // Meta
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('expires_at');

            $table->index(['ip_address', 'created_at'], 'idx_ip_created');
            $table->index('referral_code', 'idx_code');
            $table->index('expires_at', 'idx_expires');
            $table->index(['matched', 'expires_at', 'created_at'], 'idx_match_scan');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('referral_clicks');
    }
};
