<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Read/query convenience for Laravel consumers. Writes go through
 * {@see \BlynkDeferlink\Referral\Services\ClickStore} to keep one code path.
 *
 * @property string $click_id
 * @property string $referral_code
 * @property string $ip_address
 * @property bool   $matched
 * @property \Illuminate\Support\Carbon $expires_at
 */
class ReferralClick extends Model
{
    public $timestamps = false;

    protected $table = 'referral_clicks';

    protected $guarded = [];

    protected $casts = [
        'matched'      => 'boolean',
        'screen_width' => 'integer',
        'screen_height' => 'integer',
        'pixel_ratio'  => 'float',
        'created_at'   => 'datetime',
        'expires_at'   => 'datetime',
        'matched_at'   => 'datetime',
    ];

    public function scopeUnmatched($query)
    {
        return $query->where('matched', false);
    }

    public function scopeFresh($query)
    {
        return $query->where('expires_at', '>', now());
    }
}
