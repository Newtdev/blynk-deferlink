import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReferralConfig } from '../config.js';
import { signClickToken } from '../support/clickToken.js';
import type { ClickStore } from './clickStore.js';
import { ConversionTracker, hashDeviceId, resolveDeviceId } from './conversionTracker.js';

process.env.CLICK_TOKEN_SECRET ??= 'test-secret-do-not-use-in-prod';

/**
 * Exercises the security property decisions.md #21/#22 fix: claim() must
 * reject anything that isn't backed by a real, valid, device-owned click
 * token — not just accept whatever the request body claims happened.
 *
 * `NOW` is always passed explicitly to claim() (its `now` param exists
 * specifically for this) rather than relying on the real wall clock — a
 * fixed test date will eventually be in the past relative to whenever the
 * suite actually runs, which would make every "should verify" case here
 * fail for the wrong reason (expiry) without anyone noticing, since a
 * verification failure and a device/lock mismatch return the identical
 * `{ unverified: true }` shape. Caught by hand while manually smoke-testing
 * this exact bug in the PHP port before trusting either port's tests.
 */
type Click = Awaited<ReturnType<ClickStore['findClickForClaim']>>;

function stubClicks(click: Click, lockResult = true): ClickStore {
  return {
    findClickForClaim: async () => click,
    lockToDevice: async () => lockResult,
  } as unknown as ClickStore;
}

const CONFIG = new ReferralConfig(); // hash_device_ids: true by default
const SECRET = process.env.CLICK_TOKEN_SECRET;
const NOW = new Date('2026-08-14T12:00:00Z');
const FUTURE_EXP = new Date(NOW.getTime() + 60_000);

function baseClick(overrides: Partial<NonNullable<Click>> = {}): NonNullable<Click> {
  return {
    referralCode: 'CODE1',
    matched: false,
    matchedDeviceId: null,
    matchMethod: null,
    matchConfidence: null,
    expiresAt: FUTURE_EXP,
    ...overrides,
  };
}

test('claim() rejects a fabricated token with no matching click at all', async () => {
  // The original finding's exact failure scenario: a token that doesn't
  // verify (or references nothing) — no prior /click ever happened.
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(null));
  const result = await tracker.claim(
    {
      deviceId: crypto.randomUUID(),
      platform: 'ios',
      token: 'attacker-click-id.9999999999.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    },
    NOW,
  );
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects a tampered token (signature no longer matches)', async () => {
  const token = signClickToken('click-1', FUTURE_EXP, SECRET);
  const [, exp, sig] = token.split('.');
  const tampered = `attacker-click-id.${exp}.${sig}`;
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(baseClick()));
  const result = await tracker.claim({ deviceId: 'device-1', platform: 'ios', token: tampered }, NOW);
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects an expired token', async () => {
  const pastExp = new Date(NOW.getTime() - 1000);
  const token = signClickToken('click-1', pastExp, SECRET);
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(baseClick({ expiresAt: pastExp })));
  const result = await tracker.claim({ deviceId: 'device-1', platform: 'ios', token }, NOW);
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects when the click row itself has since expired (defense in depth vs. the token)', async () => {
  const token = signClickToken('click-1', FUTURE_EXP, SECRET);
  const staleClick = baseClick({ expiresAt: new Date(NOW.getTime() - 1) });
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(staleClick));
  const result = await tracker.claim({ deviceId: 'device-1', platform: 'ios', token }, NOW);
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects an already-matched click when the device does not match the lock', async () => {
  const token = signClickToken('click-1', FUTURE_EXP, SECRET);
  const locked = baseClick({
    matched: true,
    matchedDeviceId: hashDeviceId('the-real-device'),
    matchMethod: 'fingerprint',
    matchConfidence: 85,
  });
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(locked));
  const result = await tracker.claim(
    {
      deviceId: 'attacker-fabricated-device-id', // never went through /click or /match
      platform: 'ios',
      token,
    },
    NOW,
  );
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() rejects a not-yet-matched click when the atomic lock is lost to a race', async () => {
  const token = signClickToken('click-1', FUTURE_EXP, SECRET);
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(baseClick(), /* lockResult */ false));
  const result = await tracker.claim(
    {
      deviceId: 'device-1',
      platform: 'android',
      token,
      method: 'install_referrer',
    },
    NOW,
  );
  assert.deepEqual(result, { success: false, unverified: true });
});

test('claim() passes verification for an already-matched click owned by this device', async () => {
  // Proves the "happy path" actually clears verification, not just that
  // failures fail — an unguarded `db: null` throws once claim() reaches
  // the DB-touching part of the success path, which is exactly the point:
  // it did NOT return { unverified: true }.
  const token = signClickToken('click-1', FUTURE_EXP, SECRET);
  const locked = baseClick({
    matched: true,
    matchedDeviceId: hashDeviceId('good-device'),
    matchMethod: 'fingerprint',
    matchConfidence: 92.5,
  });
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(locked));
  await assert.rejects(() => tracker.claim({ deviceId: 'good-device', platform: 'ios', token }, NOW));
});

test('claim() passes verification for a not-yet-matched click when the lock succeeds', async () => {
  const token = signClickToken('click-1', FUTURE_EXP, SECRET);
  const tracker = new ConversionTracker(null as never, CONFIG, stubClicks(baseClick(), /* lockResult */ true));
  await assert.rejects(() =>
    tracker.claim({ deviceId: 'device-1', platform: 'android', token, method: 'install_referrer' }, NOW),
  );
});

test('resolveDeviceId hashes consistently with what lockToDevice would have stored', () => {
  // The exact bug caught while implementing #21: claim() compares its
  // resolved device_id against the click row's matched_device_id, which
  // routes/referral.ts populates via this same helper before calling
  // lockToDevice — if the two ever compute the stored form differently, a
  // legitimate claim fails verification even though nothing is wrong.
  const raw = 'device-abc-123';
  assert.equal(resolveDeviceId(raw, CONFIG), hashDeviceId(raw));

  const noHash = new ReferralConfig({ hash_device_ids: false });
  assert.equal(resolveDeviceId(raw, noHash), raw);
});
