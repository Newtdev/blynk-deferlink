import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Mirrors packages/referral-sdk's (PHP) `referral_clicks` table
 * (see packages/referral-sdk/database/schema.sql) so both backends are
 * interchangeable — same columns, same semantics, just Postgres types
 * instead of MySQL's.
 */
export const referralClicks = pgTable(
  'referral_clicks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    clickId: varchar('click_id', { length: 36 }).notNull().unique(),
    referralCode: varchar('referral_code', { length: 50 }).notNull(),

    // Fingerprint data
    ipAddress: varchar('ip_address', { length: 45 }).notNull(),
    userAgent: text('user_agent'),
    screenWidth: integer('screen_width'),
    screenHeight: integer('screen_height'),
    pixelRatio: numeric('pixel_ratio', { precision: 3, scale: 2 }),
    timezone: varchar('timezone', { length: 100 }),
    // 35, not 10: real device locale identifiers run longer than a bare
    // BCP-47 primary tag — iOS Simulator reports "en_US_POSIX" (11 chars).
    language: varchar('language', { length: 35 }),
    platform: varchar('platform', { length: 50 }),
    referrerUrl: text('referrer_url'),

    // Matching state
    matched: boolean('matched').notNull().default(false),
    matchedDeviceId: varchar('matched_device_id', { length: 255 }),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    // What actually matched it — recorded here, at lock time, specifically so
    // /claim can pull method/confidence from this row instead of trusting
    // whatever the claim request itself claims happened (see decisions.md #21).
    matchMethod: varchar('match_method', { length: 20 }),
    matchConfidence: doublePrecision('match_confidence'),

    // Meta
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // Postgres index names are unique per-schema (not per-table like MySQL),
    // so every index here is prefixed by table to avoid collisions with
    // referral_conversions' indexes below.
    index('idx_clicks_ip_created').on(t.ipAddress, t.createdAt),
    index('idx_clicks_code').on(t.referralCode),
    index('idx_clicks_expires').on(t.expiresAt),
    index('idx_clicks_match_scan').on(t.matched, t.expiresAt, t.createdAt),
  ],
);

/** Mirrors `referral_conversions` from the PHP SDK. */
export const referralConversions = pgTable(
  'referral_conversions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    clickId: varchar('click_id', { length: 36 }).notNull(),
    referralCode: varchar('referral_code', { length: 50 }).notNull(),
    deviceId: varchar('device_id', { length: 255 }).notNull(),
    platform: varchar('platform', { length: 10 }).notNull(), // 'ios' | 'android'
    matchMethod: varchar('match_method', { length: 20 }).notNull(), // 'install_referrer' | 'fingerprint' | 'clipboard'
    matchConfidence: doublePrecision('match_confidence'),
    userId: varchar('user_id', { length: 255 }),
    /**
     * Optimistic default — set to 'failed' only if `on_claim_callback`
     * throws (see ConversionTracker.distributeReward). The conversion
     * itself is still recorded and `claim()` still reports success either
     * way (the dedup guarantee is real regardless of whether the reward
     * side effect landed) — this column exists so a failure is queryable
     * for reconciliation instead of silently lost behind an unhandled
     * exception. See decisions.md #23.
     */
    rewardStatus: varchar('reward_status', { length: 10 }).notNull().default('granted'), // 'granted' | 'failed'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_conversions_device').on(t.deviceId), // one referral per device, lifetime
    index('idx_conversions_user').on(t.userId),
    index('idx_conversions_code').on(t.referralCode),
  ],
);

/**
 * Fixed-window rate-limit counter — one row per bucket per window, upserted
 * atomically (`INSERT ... ON CONFLICT (bucket_key, window_start) DO UPDATE
 * SET count = count + 1 RETURNING count`) so a burst of concurrent requests
 * can't all read a stale pre-increment count and all pass (see decisions.md
 * #21 — the original one-row-per-hit design was a SELECT-count-then-INSERT
 * check-then-act race). There's no in-memory cache here (unlike the PHP
 * SDK's Laravel `RateLimiter`, which is cache-backed) because a stateless
 * Vercel function can't hold memory between invocations; a DB row is the one
 * thing that works identically whether this app runs long-running or
 * serverless.
 *
 * Fixed-window, not sliding: `windowStart` is the window's floor
 * (`Math.floor(now / decayMs) * decayMs`), not "now minus decaySeconds".
 * That's what makes the upsert's conflict target meaningful — trades away
 * the sliding window's smoother edge behavior (a request right after a
 * window boundary can theoretically see close to 2x max in a short span)
 * for real atomicity, which matters more here.
 */
export const referralRateLimitHits = pgTable(
  'referral_rate_limit_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    bucketKey: varchar('bucket_key', { length: 191 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
  },
  (t) => [uniqueIndex('idx_bucket_window').on(t.bucketKey, t.windowStart)],
);

/**
 * One row per /match request, success or failure — added specifically
 * because a genuine low-confidence scoring miss and a client
 * config/network error were otherwise indistinguishable from outside the
 * request (see docs/decisions.md #15). Stores the incoming fingerprint
 * plus the best candidate score found (even when it didn't clear
 * minConfidence), so a failed real-device match can actually be debugged
 * after the fact instead of reproduced blind.
 */
export const referralMatchAttempts = pgTable(
  'referral_match_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: varchar('device_id', { length: 255 }).notNull(),
    platform: varchar('platform', { length: 10 }).notNull(),

    // What was actually submitted, for comparing against the click row it
    // scored best against.
    ipAddress: varchar('ip_address', { length: 45 }).notNull(),
    userAgent: text('user_agent'),
    deviceModel: varchar('device_model', { length: 100 }),
    screenWidth: integer('screen_width'),
    screenHeight: integer('screen_height'),
    timezone: varchar('timezone', { length: 100 }),
    language: varchar('language', { length: 35 }),

    // Outcome
    matched: boolean('matched').notNull(),
    candidateCount: integer('candidate_count').notNull(),
    bestScore: doublePrecision('best_score'),
    bestClickId: varchar('best_click_id', { length: 36 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_match_attempts_device_created').on(t.deviceId, t.createdAt)],
);
