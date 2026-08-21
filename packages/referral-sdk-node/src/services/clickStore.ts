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

  /** Store a landing-page click. Returns the generated click_id (UUID v4). */
  async store(referralCode: string, fingerprint: FingerprintInput, ip: string): Promise<string> {
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

    return clickId;
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
   * The row /claim consults as its entire proof of legitimacy: a click_id
   * only ever reaches a real device via a locked `/match` response, the
   * Android install-referrer param, or the iOS clipboard payload — never
   * handed out to an arbitrary requester — so "this click is matched, and
   * matched to this device" is the whole trust boundary. See
   * ConversionTracker.claim() and decisions.md #21.
   */
  async findLockedClick(clickId: string): Promise<{
    referralCode: string;
    matchedDeviceId: string | null;
    matchMethod: MatchMethod | null;
    matchConfidence: number | null;
  } | null> {
    const [row] = await this.db
      .select({
        referralCode: referralClicks.referralCode,
        matched: referralClicks.matched,
        matchedDeviceId: referralClicks.matchedDeviceId,
        matchMethod: referralClicks.matchMethod,
        matchConfidence: referralClicks.matchConfidence,
      })
      .from(referralClicks)
      .where(eq(referralClicks.clickId, clickId))
      .limit(1);

    if (!row?.matched) return null;
    return {
      referralCode: row.referralCode,
      matchedDeviceId: row.matchedDeviceId,
      matchMethod: row.matchMethod as MatchMethod | null,
      matchConfidence: row.matchConfidence,
    };
  }

  /**
   * Look up a click by id for the deterministic recovery paths (Android
   * install referrer, iOS clipboard) — both already know their `click_id`
   * (embedded by the web landing page at click time) instead of needing
   * fingerprint scoring to find it. Returns null if the click doesn't
   * exist, is already matched, or has expired, so the caller can fall back
   * to fingerprint matching exactly like an empty/missing referrer does.
   */
  async findUnmatchedClick(clickId: string): Promise<{ referralCode: string } | null> {
    const [row] = await this.db
      .select({ referralCode: referralClicks.referralCode, matched: referralClicks.matched })
      .from(referralClicks)
      .where(and(eq(referralClicks.clickId, clickId), sql`${referralClicks.expiresAt} > now()`))
      .limit(1);

    if (!row || row.matched) return null;
    return { referralCode: row.referralCode };
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
