import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

export interface AnalyticsOptions {
  /** Only include clicks created at or after this time. Omit for all-time. */
  since?: Date;
}

export interface PlatformStat {
  platform: string | null;
  clicks: number;
  matched: number;
}

export interface ReferralCodeStat {
  referralCode: string;
  clicks: number;
  matched: number;
}

export interface AnalyticsStats {
  since: string | null;
  totals: { clicks: number; matched: number; matchRate: number };
  byPlatform: PlatformStat[];
  byReferralCode: ReferralCodeStat[];
}

/**
 * Aggregate-only analytics — no per-row click/device data is returned, only
 * counts. There's deliberately no "by match method" breakdown: Android's
 * Install Referrer path resolves entirely on-device and never touches this
 * backend, so every match recorded here is inherently 'fingerprint' — a
 * method breakdown from this data alone would be misleading, not just
 * incomplete.
 */
export class AnalyticsService {
  constructor(private readonly db: Db) {}

  async getStats(opts: AnalyticsOptions = {}): Promise<AnalyticsStats> {
    const since = opts.since ?? null;

    const totalsResult = await this.db.execute<{ clicks: string; matched: string }>(
      sql`
        SELECT count(*) AS clicks, count(*) FILTER (WHERE matched) AS matched
        FROM referral_clicks
        ${since ? sql`WHERE created_at >= ${since}` : sql``}
      `,
    );
    const totalsRow = totalsResult.rows[0];
    const clicks = Number(totalsRow?.clicks ?? 0);
    const matched = Number(totalsRow?.matched ?? 0);

    const platformResult = await this.db.execute<{ platform: string | null; clicks: string; matched: string }>(
      sql`
        SELECT platform, count(*) AS clicks, count(*) FILTER (WHERE matched) AS matched
        FROM referral_clicks
        ${since ? sql`WHERE created_at >= ${since}` : sql``}
        GROUP BY platform
        ORDER BY clicks DESC
      `,
    );

    const codeResult = await this.db.execute<{ referral_code: string; clicks: string; matched: string }>(
      sql`
        SELECT referral_code, count(*) AS clicks, count(*) FILTER (WHERE matched) AS matched
        FROM referral_clicks
        ${since ? sql`WHERE created_at >= ${since}` : sql``}
        GROUP BY referral_code
        ORDER BY clicks DESC
        LIMIT 50
      `,
    );

    return {
      since: since ? since.toISOString() : null,
      totals: {
        clicks,
        matched,
        matchRate: clicks > 0 ? Math.round((matched / clicks) * 10000) / 100 : 0,
      },
      byPlatform: platformResult.rows.map((r) => ({
        platform: r.platform,
        clicks: Number(r.clicks),
        matched: Number(r.matched),
      })),
      byReferralCode: codeResult.rows.map((r) => ({
        referralCode: r.referral_code,
        clicks: Number(r.clicks),
        matched: Number(r.matched),
      })),
    };
  }
}
