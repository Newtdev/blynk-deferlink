<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @property string  $click_id
 * @property string  $referral_code
 * @property string  $device_id
 * @property string  $platform
 * @property string  $match_method
 * @property ?float  $match_confidence
 * @property ?string $user_id
 */
class ReferralConversion extends Model
{
    public $timestamps = false;

    protected $table = 'referral_conversions';

    protected $guarded = [];

    protected $casts = [
        'match_confidence' => 'float',
        'created_at'       => 'datetime',
    ];
}
