import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralRateLimitHits } from '../db/schema.js';

export type RateLimitBucket = 'click' | 'match' | 'claim';

export interface RateLimitCheck {
  limited: boolean;
  retryAfter: number;
}

/**
 * Throttles referral endpoints. DB-backed fixed window (see schema.ts for
 * why), functionally equivalent to
 * packages/referral-sdk/src/Middleware/ReferralRateLimit.php:
 *   'click' bucket — per IP,       max `rate_limit_clicks_per_hour`,  1h window
 *   'match' bucket — per device,   max `rate_limit_matches_per_day`,  24h window
 *   'claim' bucket — per device,   max `rate_limit_claims_per_hour`,  1h window
 *
 * Each check is a single atomic upsert (`INSERT ... ON CONFLICT (bucket_key,
 * window_start) DO UPDATE SET count = count + 1 RETURNING count`) — not a
 * SELECT-count-then-INSERT. The earlier version let concurrent requests all
 * read a stale under-the-limit count and all pass; see decisions.md #21.
 */
export class RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
  ) {}

  async check(bucket: RateLimitBucket, identity: string): Promise<RateLimitCheck> {
    const { key, max, decaySeconds } = this.limits(bucket, identity);
    const decayMs = decaySeconds * 1000;
    const windowStart = new Date(Math.floor(Date.now() / decayMs) * decayMs);

    const [row] = await this.db
      .insert(referralRateLimitHits)
      .values({ bucketKey: key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [referralRateLimitHits.bucketKey, referralRateLimitHits.windowStart],
        set: { count: sql`${referralRateLimitHits.count} + 1` },
      })
      .returning({ count: referralRateLimitHits.count });

    const count = row?.count ?? 1;
    if (count > max) {
      const retryAfter = Math.max(0, Math.ceil((windowStart.getTime() + decayMs - Date.now()) / 1000));
      return { limited: true, retryAfter };
    }

    return { limited: false, retryAfter: 0 };
  }

  private limits(bucket: RateLimitBucket, identity: string) {
    if (bucket === 'match') {
      return {
        key: `match:${sha1(identity)}`,
        max: this.config.rateLimitMatchesPerDay,
        decaySeconds: 86400,
      };
    }
    if (bucket === 'claim') {
      return {
        key: `claim:${sha1(identity)}`,
        max: this.config.rateLimitClaimsPerHour,
        decaySeconds: 3600,
      };
    }
    return {
      key: `click:${sha1(identity)}`,
      max: this.config.rateLimitClicksPerHour,
      decaySeconds: 3600,
    };
  }
}

function sha1(v: string): string {
  return createHash('sha1').update(v).digest('hex');
}
