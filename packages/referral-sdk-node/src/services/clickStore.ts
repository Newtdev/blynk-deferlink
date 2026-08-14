import { randomUUID } from 'node:crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralClicks } from '../db/schema.js';

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
   * Returns true only if this call is the one that won the lock.
   */
  async lockToDevice(clickId: string, deviceId: string): Promise<boolean> {
    const result = await this.db
      .update(referralClicks)
      .set({ matched: true, matchedDeviceId: deviceId, matchedAt: new Date() })
      .where(and(eq(referralClicks.clickId, clickId), eq(referralClicks.matched, false)))
      .returning({ id: referralClicks.id });

    return result.length === 1;
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
