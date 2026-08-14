/** Public entrypoint for `@sparkle/referral-sdk-node`. */
export { createApp } from './app.js';
export { configFromEnv } from './configFromEnv.js';
export { ReferralConfig, type ReferralConfigInput, type RewardsConfig, type ScoringWeights } from './config.js';

export { ClickStore, type FingerprintInput } from './services/clickStore.js';
export { ConversionTracker, hashDeviceId, type ClaimInput, type ClaimResult, type Reward } from './services/conversionTracker.js';
export {
  FingerprintMatcher,
  type IncomingFingerprint,
  type MatchResult,
  type StoredClickFingerprint,
} from './services/fingerprintMatcher.js';
export { RateLimiter, type RateLimitBucket, type RateLimitCheck } from './services/rateLimiter.js';

export { getDb, type Db } from './db/client.js';
export * as schema from './db/schema.js';
