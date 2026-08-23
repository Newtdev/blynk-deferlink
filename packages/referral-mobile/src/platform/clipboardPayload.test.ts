import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClipboardReferralPayload } from './clipboardPayload.js';

const NOW = Date.parse('2026-08-14T12:00:00Z');
const NOW_SECONDS = NOW / 1000;
const WINDOW = 172800; // 48h, matching the backend's default match window

test('parses a well-formed, fresh payload (no token)', () => {
  const raw = `sparkle_ref:v1:ABC123:${NOW_SECONDS}`;
  const result = parseClipboardReferralPayload(raw, WINDOW, NOW);
  assert.deepEqual(result, { code: 'ABC123', issuedAt: NOW_SECONDS, token: null });
});

test('parses a well-formed payload with a token', () => {
  const raw = `sparkle_ref:v1:ABC123:${NOW_SECONDS}:click-id.1755000000.deadbeef`;
  const result = parseClipboardReferralPayload(raw, WINDOW, NOW);
  assert.deepEqual(result, {
    code: 'ABC123',
    issuedAt: NOW_SECONDS,
    token: 'click-id.1755000000.deadbeef',
  });
});

test('rejects a payload without the expected prefix', () => {
  assert.equal(parseClipboardReferralPayload(`ABC123:${NOW_SECONDS}`, WINDOW, NOW), null);
});

test('rejects null/undefined/empty input', () => {
  assert.equal(parseClipboardReferralPayload(null, WINDOW, NOW), null);
  assert.equal(parseClipboardReferralPayload(undefined, WINDOW, NOW), null);
  assert.equal(parseClipboardReferralPayload('', WINDOW, NOW), null);
});

test('rejects a payload missing the timestamp segment', () => {
  assert.equal(parseClipboardReferralPayload('sparkle_ref:v1:ABC123', WINDOW, NOW), null);
});

test('rejects a payload with a non-numeric timestamp', () => {
  assert.equal(parseClipboardReferralPayload('sparkle_ref:v1:ABC123:not-a-number', WINDOW, NOW), null);
});

test('rejects a payload older than maxAgeSeconds', () => {
  const stale = NOW_SECONDS - WINDOW - 1;
  assert.equal(parseClipboardReferralPayload(`sparkle_ref:v1:ABC123:${stale}`, WINDOW, NOW), null);
});

test('accepts a payload exactly at the age boundary', () => {
  const atEdge = NOW_SECONDS - WINDOW;
  const result = parseClipboardReferralPayload(`sparkle_ref:v1:ABC123:${atEdge}`, WINDOW, NOW);
  assert.equal(result?.code, 'ABC123');
});

test('rejects a payload claiming to be from the future (clock skew)', () => {
  const future = NOW_SECONDS + 60;
  assert.equal(parseClipboardReferralPayload(`sparkle_ref:v1:ABC123:${future}`, WINDOW, NOW), null);
});

test('a referral code itself may contain colons without breaking parsing', () => {
  // Codes shouldn't contain colons in practice, but the parser splits on the
  // *last* colon specifically so it degrades gracefully rather than mis-parsing.
  const raw = `sparkle_ref:v1:AB:C123:${NOW_SECONDS}`;
  const result = parseClipboardReferralPayload(raw, WINDOW, NOW);
  assert.equal(result?.code, 'AB:C123');
  assert.equal(result?.token, null);
});

test('a colon-containing code and a dot-delimited token together still parse correctly', () => {
  // The token itself is `.`-delimited (see support/clickToken.ts on the
  // backend) — confirms that never collides with this format's `:` delimiter.
  const raw = `sparkle_ref:v1:AB:C123:${NOW_SECONDS}:click-id.1755000000.deadbeef`;
  const result = parseClipboardReferralPayload(raw, WINDOW, NOW);
  assert.deepEqual(result, { code: 'AB:C123', issuedAt: NOW_SECONDS, token: 'click-id.1755000000.deadbeef' });
});
