import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReferralConfig } from '../config.js';
import type { ClickStore } from './clickStore.js';
import { ConversionTracker, hashDeviceId, resolveDeviceId } from './conversionTracker.js';

/**
 * Exercises the security property decisions.md #21 fixes: claim() must
 * reject anything that isn't backed by a real, matching, device-owned
 * click lock — not just accept whatever the request body claims happened.
 * These cases all resolve before ConversionTracker ever touches `db` (the
 * unverified path returns before the insert/select), so `db` is never
 * actually called — same pattern as fingerprintMatcher.test.ts's `null as
 * never` for an argument a given code path never touches.
 */
function stubClicks(locked: Awaited<ReturnType<ClickStore['findLockedClick']>>): ClickStore {
  return { findLockedClick: async () => locked } as unknown as ClickStore;
}

const CONFIG = new ReferralConfig(); // hash_device_ids: true by default

test('claim() rejects when click_id references no locked click', async () => {
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(null));
  const result = await tracker.claim({
    referralCode: 'CODE1',
    deviceId: 'device-1',
    platform: 'ios',
    clickId: 'nonexistent-click-id',
  });
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects when the locked click belongs to a different referral code', async () => {
  const locked = {
    referralCode: 'REAL-CODE',
    matchedDeviceId: hashDeviceId('device-1'),
    matchMethod: 'fingerprint' as const,
    matchConfidence: 85,
  };
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(locked));
  const result = await tracker.claim({
    referralCode: 'FORGED-CODE', // attacker knows a code, not the one this click locked
    deviceId: 'device-1',
    platform: 'ios',
    clickId: 'some-click-id',
  });
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects when the locked click belongs to a different device', async () => {
  const locked = {
    referralCode: 'CODE1',
    matchedDeviceId: hashDeviceId('the-real-device'),
    matchMethod: 'fingerprint' as const,
    matchConfidence: 85,
  };
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(locked));
  const result = await tracker.claim({
    referralCode: 'CODE1',
    deviceId: 'attacker-fabricated-device-id', // never went through /click or /match
    platform: 'ios',
    clickId: 'some-click-id',
  });
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects a bare fabricated claim with no prior click/match at all', async () => {
  // The original finding's exact failure scenario: POST /claim with an
  // arbitrary referral_code + freshly-generated device_id + no real click.
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(null));
  const result = await tracker.claim({
    referralCode: 'ANY-CODE-I-KNOW',
    deviceId: crypto.randomUUID(),
    platform: 'ios',
    clickId: crypto.randomUUID(), // guessed — doesn't reference a real row
  });
  assert.deepEqual(result, { success: false, unverified: true });
});

test('resolveDeviceId hashes consistently with what lockToDevice would have stored', () => {
  // This is the exact bug caught while implementing #21: claim() compares
  // its resolved device_id against the click row's matched_device_id, which
  // routes/referral.ts populates via this same helper before calling
  // lockToDevice — if the two ever compute the stored form differently, a
  // legitimate claim fails verification even though nothing is wrong.
  const raw = 'device-abc-123';
  assert.equal(resolveDeviceId(raw, CONFIG), hashDeviceId(raw));

  const noHash = new ReferralConfig({ hash_device_ids: false });
  assert.equal(resolveDeviceId(raw, noHash), raw);
});
