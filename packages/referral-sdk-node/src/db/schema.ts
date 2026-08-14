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
    matchMethod: varchar('match_method', { length: 20 }).notNull(), // 'install_referrer' | 'fingerprint'
    matchConfidence: doublePrecision('match_confidence'),
    userId: varchar('user_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_conversions_device').on(t.deviceId), // one referral per device, lifetime
    index('idx_conversions_user').on(t.userId),
    index('idx_conversions_code').on(t.referralCode),
  ],
);

/**
 * Generic fixed-window rate-limit hit log — one row per request that counted
 * against a bucket. There's no in-memory cache here (unlike the PHP SDK's
 * Laravel `RateLimiter`, which is cache-backed) because a stateless Vercel
 * function can't hold memory between invocations; a DB row is the one thing
 * that works identically whether this app runs long-running or serverless.
 */
export const referralRateLimitHits = pgTable(
  'referral_rate_limit_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    bucketKey: varchar('bucket_key', { length: 191 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_bucket_created').on(t.bucketKey, t.createdAt)],
);
