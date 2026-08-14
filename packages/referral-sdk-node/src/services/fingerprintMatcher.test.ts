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

const NOW = new Date('2026-08-14T12:00:00Z');

function storedIosClick(): StoredClickFingerprint {
  return {
    ipAddress: '102.89.1.1',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
    screenWidth: 390,
    screenHeight: 844,
    timezone: 'Africa/Lagos',
    language: 'en-NG',
    createdAt: NOW, // fresh by default — recency contributes full weight
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
  const score = matcher().score(storedIosClick(), iosDeviceFingerprint(), NOW);
  assert.equal(score, 100);
});

test('IP change no longer fails a fresh match (Scenario C: WiFi switch)', () => {
  const incoming = { ...iosDeviceFingerprint(), ip: '197.210.9.9' };
  const score = matcher().score(storedIosClick(), incoming, NOW);
  // device(25) + screen(15) + tz(10) + lang(10) + recency(15, fresh) = 75 >= 70
  // This is the whole point of recency: a network switch between click and
  // install no longer fails the match outright on its own, as long as the
  // install happens promptly.
  assert.equal(score, 75);
  assert.ok(score >= 70);
});

test('IP change on a stale click still fails (recency has decayed away)', () => {
  const stored = storedIosClick(); // createdAt: NOW
  const incoming = { ...iosDeviceFingerprint(), ip: '197.210.9.9' };
  const windowMs = new ReferralConfig().matchWindowSeconds() * 1000;
  const wayLater = new Date(NOW.getTime() + windowMs); // at the window edge — recency is 0
  const score = matcher().score(stored, incoming, wayLater);
  // device(25) + screen(15) + tz(10) + lang(10) + recency(0) = 60 < 70
  assert.equal(score, 60);
  assert.ok(score < 70);
});

test('recency decays linearly across the match window', () => {
  const stored = storedIosClick(); // createdAt: NOW
  const windowMs = new ReferralConfig().matchWindowSeconds() * 1000;
  const halfway = new Date(NOW.getTime() + windowMs / 2);
  // Everything else mismatched so only recency contributes.
  const incoming: IncomingFingerprint = {
    ip: '0.0.0.0',
    deviceModel: 'Pixel 7',
    platform: 'android',
    screenWidth: 1,
    screenHeight: 1,
    timezone: 'nowhere',
    language: 'zz',
  };
  assert.equal(matcher().score(stored, incoming, halfway), 7.5); // half of recency's 15
});

test('IP alone is insufficient, even fresh', () => {
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
  const score = matcher().score(stored, incoming, NOW);
  // ip(25) + recency(15, fresh) = 40 < 70
  assert.equal(score, 40);
  assert.ok(score < 70);
});

test('screen orientation is ignored', () => {
  const stored = storedIosClick();
  const incoming = { ...iosDeviceFingerprint(), screenWidth: 844, screenHeight: 390 };
  assert.equal(matcher().score(stored, incoming, NOW), 100);
});

test('language primary subtag matches (en-GB ~ en-NG)', () => {
  const stored = { ...storedIosClick(), language: 'en-GB' };
  const incoming = { ...iosDeviceFingerprint(), language: 'en-NG' };
  assert.equal(matcher().score(stored, incoming, NOW), 100);
});

test('underscore-separated locale matches hyphenated (iOS Simulator reports en_US_POSIX)', () => {
  const stored = { ...storedIosClick(), language: 'en-NG' };
  const incoming = { ...iosDeviceFingerprint(), language: 'en_US_POSIX' };
  assert.equal(matcher().score(stored, incoming, NOW), 100);
});

test('android model matches by OS family', () => {
  const stored: StoredClickFingerprint = {
    ipAddress: '10.0.0.1',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A) AppleWebKit/537.36',
    screenWidth: 412,
    screenHeight: 915,
    timezone: 'Africa/Lagos',
    language: 'en',
    createdAt: NOW,
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
  assert.equal(matcher().score(stored, incoming, NOW), 100);
});
