import { lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { referralMatchAttempts, referralRateLimitHits } from '../db/schema.js';

/**
 * Purges rows from the two tables that grew unbounded forever before this
 * — unlike `referral_clicks` (pruned by `deleteExpired`, since an
 * unmatched expired click has no further use), `referral_match_attempts`
 * and `referral_rate_limit_hits` are pure logs with no functional role
 * once they're old. `retentionDays` comes from `ReferralConfig` (default
 * 30) so a project can tune the debugging/audit window without editing
 * code. See decisions.md #23.
 */
export class RetentionService {
  constructor(private readonly db: Db) {}

  async purgeOld(retentionDays: number): Promise<{ matchAttemptsRemoved: number; rateLimitHitsRemoved: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const matchAttempts = await this.db
      .delete(referralMatchAttempts)
      .where(lt(referralMatchAttempts.createdAt, cutoff))
      .returning({ id: referralMatchAttempts.id });

    const rateLimitHits = await this.db
      .delete(referralRateLimitHits)
      .where(lt(referralRateLimitHits.windowStart, cutoff))
      .returning({ id: referralRateLimitHits.id });

    return { matchAttemptsRemoved: matchAttempts.length, rateLimitHitsRemoved: rateLimitHits.length };
  }
}
