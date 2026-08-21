import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ReferralConfig } from '../config.js';
import { FingerprintMatcher } from './fingerprintMatcher.js';

/**
 * Both backends' score() functions are meant to agree on every input —
 * "ported field-for-field", per fingerprintMatcher.ts's own class doc —
 * but nothing mechanically enforced that until now. The ip_match
 * weight-drift (decisions.md #21/#22, 115-point ceiling vs 100) and the
 * language-split divergence (decisions.md #23) both shipped and went
 * live before an outside review caught them; neither test suite's
 * hardcoded cases (which only ever exercised each backend against
 * itself) could have caught either. This fixture is loaded by both
 * FingerprintMatcherTest.php and this file — a case added here and not
 * mirrored in the PHP suite (or vice versa) is a real gap, not a
 * hypothetical one. See decisions.md #23.
 */
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/fixtures/fingerprint-match-cases.json',
);

interface FixtureCase {
  name: string;
  stored: {
    ip_address: string;
    user_agent: string;
    screen_width: number;
    screen_height: number;
    timezone: string;
    language: string;
    created_at: string;
  };
  incoming: {
    ip: string;
    device_model: string;
    platform: string;
    screen_width: number;
    screen_height: number;
    timezone: string;
    language: string;
  };
  now: string;
  expected_score: number;
}

const cases: FixtureCase[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

function matcher(): FingerprintMatcher {
  return new FingerprintMatcher(null as never, new ReferralConfig());
}

for (const c of cases) {
  test(`parity fixture: ${c.name}`, () => {
    const stored = {
      ipAddress: c.stored.ip_address,
      userAgent: c.stored.user_agent,
      screenWidth: c.stored.screen_width,
      screenHeight: c.stored.screen_height,
      timezone: c.stored.timezone,
      language: c.stored.language,
      createdAt: new Date(c.stored.created_at),
    };
    const incoming = {
      ip: c.incoming.ip,
      deviceModel: c.incoming.device_model,
      platform: c.incoming.platform,
      screenWidth: c.incoming.screen_width,
      screenHeight: c.incoming.screen_height,
      timezone: c.incoming.timezone,
      language: c.incoming.language,
    };
    const score = matcher().score(stored, incoming, new Date(c.now));
    assert.equal(score, c.expected_score);
  });
}
