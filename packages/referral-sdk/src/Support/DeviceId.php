<?php

declare(strict_types=1);

namespace Sparkle\Referral\Support;

/**
 * Applies `hash_device_ids` consistently everywhere a device_id is
 * persisted — `referral_clicks.matched_device_id` (see
 * ClickStore::lockToDevice, called from MatchController/ClaimController)
 * and `referral_conversions.device_id` (ConversionTracker) both need to
 * agree on the same stored form, or a lock-ownership check compares a
 * hash against a raw value and never matches. See decisions.md #21 (the
 * bug this was originally caught fixing).
 */
final class DeviceId
{
    public static function hash(string $deviceId): string
    {
        // One-way, for dedup only. Never reversed.
        return hash('sha256', $deviceId);
    }

    public static function resolve(string $deviceId, ReferralConfig $config): string
    {
        return $config->hashDeviceIds ? self::hash($deviceId) : $deviceId;
    }
}
