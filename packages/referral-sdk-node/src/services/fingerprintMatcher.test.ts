import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReferralConfig } from '../config.js';
import { FingerprintMatcher, type IncomingFingerprint, type StoredClickFingerprint } from './fingerprintMatcher.js';

/**
 * Exercises the pure score() function — no database required, same cases as
 * packages/referral-sdk/tests/FingerprintMatcherTest.php so both backends
 * are verified to agree on what counts as a match.
 */
function matcher(): FingerprintMatcher {
  // score() is pure — the Db argument is never touched.
  return new FingerprintMatcher(null as never, new ReferralConfig());
}

function storedIosClick(): StoredClickFingerprint {
  return {
    ipAddress: '102.89.1.1',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
    screenWidth: 390,
    screenHeight: 844,
    timezone: 'Africa/Lagos',
    language: 'en-NG',
  };
}

function iosDeviceFingerprint(): IncomingFingerprint {
  return {
    ip: '102.89.1.1',
    deviceModel: 'iPhone14,5',
    platform: 'ios',
    screenWidth: 390,
    screenHeight: 844,
    timezone: 'Africa/Lagos',
    language: 'en-NG',
  };
}

test('perfect match scores 100', () => {
  const score = matcher().score(storedIosClick(), iosDeviceFingerprint());
  assert.equal(score, 100);
});

test('IP change drops below threshold (Scenario C: WiFi switch)', () => {
  const incoming = { ...iosDeviceFingerprint(), ip: '197.210.9.9' };
  const score = matcher().score(storedIosClick(), incoming);
  // device(25) + screen(15) + tz(10) + lang(10) = 60 < 70
  assert.equal(score, 60);
  assert.ok(score < 70);
});

test('IP alone is insufficient', () => {
  const stored = storedIosClick();
  const incoming: IncomingFingerprint = {
    ip: '102.89.1.1', // matches
    deviceModel: 'Pixel 7', // android — OS mismatch
    platform: 'android',
    screenWidth: 1080,
    screenHeight: 2400,
    timezone: 'America/New_York',
    language: 'fr-FR',
  };
  const score = matcher().score(stored, incoming);
  assert.equal(score, 40);
  assert.ok(score < 70);
});

test('screen orientation is ignored', () => {
  const stored = storedIosClick();
  const incoming = { ...iosDeviceFingerprint(), screenWidth: 844, screenHeight: 390 };
  assert.equal(matcher().score(stored, incoming), 100);
});

test('language primary subtag matches (en-GB ~ en-NG)', () => {
  const stored = { ...storedIosClick(), language: 'en-GB' };
  const incoming = { ...iosDeviceFingerprint(), language: 'en-NG' };
  assert.equal(matcher().score(stored, incoming), 100);
});

test('underscore-separated locale matches hyphenated (iOS Simulator reports en_US_POSIX)', () => {
  const stored = { ...storedIosClick(), language: 'en-NG' };
  const incoming = { ...iosDeviceFingerprint(), language: 'en_US_POSIX' };
  assert.equal(matcher().score(stored, incoming), 100);
});

test('android model matches by OS family', () => {
  const stored: StoredClickFingerprint = {
    ipAddress: '10.0.0.1',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A) AppleWebKit/537.36',
    screenWidth: 412,
    screenHeight: 915,
    timezone: 'Africa/Lagos',
    language: 'en',
  };
  const incoming: IncomingFingerprint = {
    ip: '10.0.0.1',
    deviceModel: 'Pixel 7',
    platform: 'android',
    screenWidth: 412,
    screenHeight: 915,
    timezone: 'Africa/Lagos',
    language: 'en',
  };
  assert.equal(matcher().score(stored, incoming), 100);
});
