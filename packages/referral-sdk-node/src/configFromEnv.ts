import type { ReferralConfigInput } from './config.js';

/**
 * Builds a ReferralConfig from environment variables, for the two shipped
 * entrypoints (src/server.ts, api/index.ts) that run this package as a
 * standalone deployed service rather than an embedded library. Projects
 * that `npm install @blynk-deferlink/referral-sdk-node` into their own app and call
 * `createApp(config)` directly can ignore this and pass a config object
 * (including `code_validator` / `rewards.on_claim_callback` functions,
 * which can't be expressed as env vars) in code instead.
 */
export function configFromEnv(): ReferralConfigInput {
  return {
    match_window_hours: numOr(process.env.REFERRAL_MATCH_WINDOW_HOURS, 48),
    min_confidence: numOr(process.env.REFERRAL_MIN_CONFIDENCE, 70),
    rate_limit_clicks_per_hour: numOr(process.env.REFERRAL_RATE_LIMIT_CLICKS_PER_HOUR, 10),
    rate_limit_matches_per_day: numOr(process.env.REFERRAL_RATE_LIMIT_MATCHES_PER_DAY, 5),
    rate_limit_claims_per_hour: numOr(process.env.REFERRAL_RATE_LIMIT_CLAIMS_PER_HOUR, 10),
    hash_device_ids: boolOr(process.env.REFERRAL_HASH_DEVICE_IDS, true),
    retention_days: numOr(process.env.REFERRAL_RETENTION_DAYS, 30),
    rewards: {
      enabled: boolOr(process.env.REFERRAL_REWARDS_ENABLED, true),
      referrer_reward: numOr(process.env.REFERRAL_REFERRER_REWARD, 500),
      referee_reward: numOr(process.env.REFERRAL_REFEREE_REWARD, 500),
      reward_type: (process.env.REFERRAL_REWARD_TYPE as 'credit' | 'points' | 'custom') ?? 'credit',
    },
    // No code_validator by default — any non-empty code is accepted, same as
    // the PHP SDK's default and this repo's mock backend. Point it at a real
    // lookup (e.g. against your campaigns table) before going to production;
    // that requires editing this file or calling createApp() from your own
    // code, since a validator function can't come from an env var.
  };
}

function numOr(v: string | undefined, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}
