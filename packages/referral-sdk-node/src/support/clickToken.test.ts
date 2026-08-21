import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signClickToken, verifyClickToken } from './clickToken.js';

const SECRET = 'test-secret-do-not-use-in-prod';
const NOW = new Date('2026-08-14T12:00:00Z');

test('signs and verifies a valid token round-trip', () => {
  const expiresAt = new Date(NOW.getTime() + 60_000);
  const token = signClickToken('click-abc-123', expiresAt, SECRET);
  const result = verifyClickToken(token, SECRET, NOW);
  assert.deepEqual(result, { clickId: 'click-abc-123' });
});

test('rejects a tampered click_id (signature no longer matches)', () => {
  const expiresAt = new Date(NOW.getTime() + 60_000);
  const token = signClickToken('click-abc-123', expiresAt, SECRET);
  const [, exp, sig] = token.split('.');
  const tampered = `click-attacker-999.${exp}.${sig}`;
  assert.equal(verifyClickToken(tampered, SECRET, NOW), null);
});

test('rejects a tampered expiry (signature no longer matches)', () => {
  const expiresAt = new Date(NOW.getTime() + 60_000);
  const token = signClickToken('click-abc-123', expiresAt, SECRET);
  const [clickId, exp, sig] = token.split('.');
  const tampered = `${clickId}.${Number(exp) + 999999}.${sig}`;
  assert.equal(verifyClickToken(tampered, SECRET, NOW), null);
});

test('rejects a token signed with a different secret', () => {
  const expiresAt = new Date(NOW.getTime() + 60_000);
  const token = signClickToken('click-abc-123', expiresAt, SECRET);
  assert.equal(verifyClickToken(token, 'wrong-secret', NOW), null);
});

test('rejects an expired token', () => {
  const expiresAt = new Date(NOW.getTime() - 1000); // already in the past
  const token = signClickToken('click-abc-123', expiresAt, SECRET);
  assert.equal(verifyClickToken(token, SECRET, NOW), null);
});

test('accepts a token exactly at the expiry boundary', () => {
  const expiresAt = new Date(NOW.getTime()); // now === exp
  const token = signClickToken('click-abc-123', expiresAt, SECRET);
  const result = verifyClickToken(token, SECRET, NOW);
  assert.deepEqual(result, { clickId: 'click-abc-123' });
});

test('rejects malformed tokens', () => {
  assert.equal(verifyClickToken('', SECRET, NOW), null);
  assert.equal(verifyClickToken('not-a-token', SECRET, NOW), null);
  assert.equal(verifyClickToken('only.two-parts', SECRET, NOW), null);
  assert.equal(verifyClickToken('a.b.c.d', SECRET, NOW), null); // too many parts
  assert.equal(verifyClickToken('click-id.not-a-number.deadbeef', SECRET, NOW), null);
});

test('a completely fabricated token (the exact fraud scenario) is rejected', () => {
  // No prior /click ever happened — an attacker just makes something up.
  const fabricated = 'attacker-click-id.9999999999.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  assert.equal(verifyClickToken(fabricated, SECRET, NOW), null);
});
