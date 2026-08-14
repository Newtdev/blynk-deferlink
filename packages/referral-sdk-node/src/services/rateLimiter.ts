import { createHash } from 'node:crypto';
import { and, count, eq, gte } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralRateLimitHits } from '../db/schema.js';

export type RateLimitBucket = 'click' | 'match';

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
 */
export class RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
  ) {}

  async check(bucket: RateLimitBucket, identity: string): Promise<RateLimitCheck> {
    const { key, max, decaySeconds } = this.limits(bucket, identity);
    const since = new Date(Date.now() - decaySeconds * 1000);

    const [row] = await this.db
      .select({ n: count() })
      .from(referralRateLimitHits)
      .where(and(eq(referralRateLimitHits.bucketKey, key), gte(referralRateLimitHits.createdAt, since)));

    if ((row?.n ?? 0) >= max) {
      return { limited: true, retryAfter: decaySeconds };
    }

    await this.db.insert(referralRateLimitHits).values({ bucketKey: key });
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
