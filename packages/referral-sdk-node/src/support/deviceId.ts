import { createHash } from 'node:crypto';
import type { ReferralConfig } from '../config.js';

/** One-way, for dedup only. Never reversed. */
export function hashDeviceId(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex');
}

/**
 * Applies `hash_device_ids` consistently everywhere a device_id is
 * persisted — `referral_clicks.matched_device_id` (see
 * ClickStore.lockToDevice, called from routes/referral.ts),
 * `referral_conversions.device_id` (conversionTracker.ts), and
 * `referral_match_attempts.device_id` (fingerprintMatcher.ts) all need to
 * agree on the same stored form, or a lock-ownership check compares a
 * hash against a raw value and never matches. See decisions.md #21 (the
 * bug this was originally caught fixing) and #23 (match-attempts logging
 * pulled into this same rule — it was storing the raw value regardless
 * of `hash_device_ids`, contradicting the config's own documented promise).
 */
export function resolveDeviceId(deviceId: string, config: ReferralConfig): string {
  return config.hashDeviceIds ? hashDeviceId(deviceId) : deviceId;
}
