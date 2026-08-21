import { randomUUID } from 'node:crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralClicks } from '../db/schema.js';

/** Mirrors the same inline union used in conversionTracker.ts and routes/referral.ts. */
export type MatchMethod = 'install_referrer' | 'fingerprint' | 'clipboard';

export interface FingerprintInput {
  user_agent?: string | null;
  screen_width?: number | null;
  screen_height?: number | null;
  pixel_ratio?: number | null;
  timezone?: string | null;
  language?: string | null;
  platform?: string | null;
  referrer?: string | null;
  referrer_url?: string | null;
}

/**
 * All click-table reads/writes. Ported from
 * packages/referral-sdk/src/Services/ClickStore.php.
 */
export class ClickStore {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
  ) {}

  /**
   * Store a landing-page click. Returns the generated click_id (UUID v4)
   * and its expiry — the caller (routes/referral.ts) signs a click token
   * against that same expiry immediately after, so the token and the row
   * always agree on how long the click is good for.
   */
  async store(
    referralCode: string,
    fingerprint: FingerprintInput,
    ip: string,
  ): Promise<{ clickId: string; expiresAt: Date }> {
    const clickId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.matchWindowSeconds() * 1000);

    await this.db.insert(referralClicks).values({
      clickId,
      referralCode,
      ipAddress: ip,
      userAgent: nullableStr(fingerprint.user_agent),
      screenWidth: nullableInt(fingerprint.screen_width),
      screenHeight: nullableInt(fingerprint.screen_height),
      pixelRatio: fingerprint.pixel_ratio != null ? String(fingerprint.pixel_ratio) : null,
      timezone: nullableStr(fingerprint.timezone),
      language: nullableStr(fingerprint.language),
      platform: nullableStr(fingerprint.platform),
      referrerUrl: nullableStr(fingerprint.referrer ?? fingerprint.referrer_url),
      matched: false,
      expiresAt,
    });

    return { clickId, expiresAt };
  }

  /**
   * Atomically lock a click to a device so it can never be matched twice.
   * Returns true only if this call is the one that won the lock. Records
   * `method`/`confidence` on the click row itself — this is the row /claim
   * consults, so what actually happened is recorded here, at the moment it
   * happened, rather than trusted from whatever the later /claim request
   * says happened (see decisions.md #21).
   */
  async lockToDevice(
    clickId: string,
    deviceId: string,
    method: MatchMethod,
    confidence: number | null = null,
  ): Promise<boolean> {
    const result = await this.db
      .update(referralClicks)
      .set({
        matched: true,
        matchedDeviceId: deviceId,
        matchedAt: new Date(),
        matchMethod: method,
        matchConfidence: confidence,
      })
      .where(and(eq(referralClicks.clickId, clickId), eq(referralClicks.matched, false)))
      .returning({ id: referralClicks.id });

    return result.length === 1;
  }

  /**
   * The row /claim consults after verifying a click token's signature: the
   * token only ever proves *which* click_id is real and unexpired, not
   * what state it's in — this is where /claim finds out whether it's
   * already matched (fingerprint path — confirm the lock belongs to this
   * device) or not yet (deterministic path's first real use — lock it
   * right there). See ConversionTracker.claim() and decisions.md #22.
   */
  async findClickForClaim(clickId: string): Promise<{
    referralCode: string;
    matched: boolean;
    matchedDeviceId: string | null;
    matchMethod: MatchMethod | null;
    matchConfidence: number | null;
    expiresAt: Date;
  } | null> {
    const [row] = await this.db
      .select({
        referralCode: referralClicks.referralCode,
        matched: referralClicks.matched,
        matchedDeviceId: referralClicks.matchedDeviceId,
        matchMethod: referralClicks.matchMethod,
        matchConfidence: referralClicks.matchConfidence,
        expiresAt: referralClicks.expiresAt,
      })
      .from(referralClicks)
      .where(eq(referralClicks.clickId, clickId))
      .limit(1);

    if (!row) return null;
    return {
      referralCode: row.referralCode,
      matched: row.matched,
      matchedDeviceId: row.matchedDeviceId,
      matchMethod: row.matchMethod as MatchMethod | null,
      matchConfidence: row.matchConfidence,
      expiresAt: row.expiresAt,
    };
  }

  /** Delete unmatched clicks past their expiry. Returns rows removed. */
  async deleteExpired(): Promise<number> {
    const result = await this.db
      .delete(referralClicks)
      .where(and(eq(referralClicks.matched, false), lte(referralClicks.expiresAt, sql`now()`)))
      .returning({ id: referralClicks.id });
    return result.length;
  }
}

function nullableStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function nullableInt(v: number | null | undefined): number | null {
  return v == null ? null : Math.trunc(v);
}
