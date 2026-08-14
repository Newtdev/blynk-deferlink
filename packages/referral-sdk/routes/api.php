<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;
use Sparkle\Referral\Controllers\ClaimController;
use Sparkle\Referral\Controllers\ClickController;
use Sparkle\Referral\Controllers\MatchController;

/*
| Referral SDK routes. Registered automatically by ReferralServiceProvider
| when `referral.routes.enabled` is true. Prefix and middleware come from
| config('referral.routes').
*/

Route::post('/click', ClickController::class)
    ->middleware('referral.throttle:click')
    ->name('referral.click');

Route::post('/match', MatchController::class)
    ->middleware('referral.throttle:match')
    ->name('referral.match');

Route::post('/claim', ClaimController::class)
    ->name('referral.claim');
