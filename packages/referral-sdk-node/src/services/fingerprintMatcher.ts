import { and, desc, eq, gte } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralClicks } from '../db/schema.js';
import { parseModel, parseUa, type UaSignature } from '../support/userAgentParser.js';

/** A stored click row, as read back from the DB (only the columns scoring needs). */
export interface StoredClickFingerprint {
  ipAddress: string;
  userAgent: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  timezone: string | null;
  language: string | null;
}

/** The fingerprint sent by the mobile app on first launch. */
export interface IncomingFingerprint {
  ip: string;
  userAgent?: string | null;
  deviceModel?: string | null;
  platform?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  timezone?: string | null;
  language?: string | null;
}

export interface MatchResult {
  clickId: string;
  referralCode: string;
  confidence: number;
}

/**
 * Scores an incoming fingerprint against stored clicks and returns the best
 * match above the configured confidence threshold. Ported field-for-field
 * from packages/referral-sdk/src/Services/FingerprintMatcher.php — keep the
 * two in sync if the heuristics change, so PHP and Node backends agree on
 * what counts as a match.
 *
 * Scoring (default weights, configurable via ReferralConfig.scoring):
 *   IP match          +40
 *   Device model/UA   +25
 *   Screen dimensions +15
 *   Timezone          +10
 *   Language          +10
 *   ----------------------
 *   Total possible    100   |   Minimum to match: 70 (IP alone is never enough)
 */
export class FingerprintMatcher {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
  ) {}

  /** Pure scoring function — no DB, no side effects, safe to unit test directly. */
  score(stored: StoredClickFingerprint, incoming: IncomingFingerprint): number {
    const w = this.config.scoring;
    let score = 0;

    // --- IP (exact) ---
    if (stored.ipAddress && stored.ipAddress === incoming.ip) {
      score += w.ip_match;
    }

    // --- Device model / OS family ---
    const storedSig = parseUa(stored.userAgent);
    const incomingSig = this.incomingSignature(incoming);
    if (this.deviceMatches(storedSig, incomingSig)) {
      score += w.device_model;
    }

    // --- Screen dimensions (order-insensitive) ---
    if (this.screenMatches(stored, incoming)) {
      score += w.screen_dimensions;
    }

    // --- Timezone (exact) ---
    if (
      stored.timezone &&
      incoming.timezone &&
      stored.timezone.toLowerCase() === incoming.timezone.toLowerCase()
    ) {
      score += w.timezone;
    }

    // --- Language (primary subtag, so "en-NG" ~ "en") ---
    if (this.languageMatches(stored.language, incoming.language)) {
      score += w.language;
    }

    return score;
  }

  /** Find the best matching unclaimed click for a device, within the match window. */
  async match(incoming: IncomingFingerprint): Promise<MatchResult | null> {
    const windowStart = new Date(Date.now() - this.config.matchWindowSeconds() * 1000);

    // Only fresh, unmatched clicks. Newest first: last-click-wins on ties.
    const rows = await this.db
      .select({
        clickId: referralClicks.clickId,
        referralCode: referralClicks.referralCode,
        ipAddress: referralClicks.ipAddress,
        userAgent: referralClicks.userAgent,
        screenWidth: referralClicks.screenWidth,
        screenHeight: referralClicks.screenHeight,
        timezone: referralClicks.timezone,
        language: referralClicks.language,
      })
      .from(referralClicks)
      .where(
        and(
          eq(referralClicks.matched, false),
          gte(referralClicks.createdAt, windowStart),
        ),
      )
      .orderBy(desc(referralClicks.createdAt));

    let best: (typeof rows)[number] | null = null;
    let bestScore = 0;

    for (const row of rows) {
      const s = this.score(row, incoming);
      if (s > bestScore) {
        bestScore = s;
        best = row;
      }
    }

    if (!best || bestScore < this.config.minConfidence) return null;

    return {
      clickId: best.clickId,
      referralCode: best.referralCode,
      confidence: Math.round(bestScore * 100) / 100,
    };
  }

  private incomingSignature(incoming: IncomingFingerprint): UaSignature {
    const model = (incoming.deviceModel ?? '').trim();
    if (model !== '') {
      const parsed = parseModel(model, incoming.platform);
      return { os: parsed.os, osVersion: null, modelHint: parsed.modelHint };
    }
    // Fall back to the app-reported UA if no native model was provided.
    return parseUa(incoming.userAgent);
  }

  /**
   * OS family must agree. If both sides expose a comparable OS version, they
   * must not contradict. On iOS the browser UA can't reveal a model, so
   * OS-family agreement is the strongest signal available there.
   */
  private deviceMatches(stored: UaSignature, incoming: UaSignature): boolean {
    if (stored.os === 'unknown' || incoming.os === 'unknown') return false;
    if (stored.os !== incoming.os) return false;

    if (stored.osVersion && incoming.osVersion) {
      const major = (v: string) => v.split('.')[0];
      if (major(stored.osVersion) !== major(incoming.osVersion)) return false;
    }

    return true;
  }

  private screenMatches(stored: StoredClickFingerprint, incoming: IncomingFingerprint): boolean {
    const sw = stored.screenWidth ?? 0;
    const sh = stored.screenHeight ?? 0;
    const iw = incoming.screenWidth ?? 0;
    const ih = incoming.screenHeight ?? 0;

    if (!sw || !sh || !iw || !ih) return false;

    // Orientation-insensitive: a browser and a native app may report
    // width/height swapped depending on how each reads the screen.
    return (sw === iw && sh === ih) || (sw === ih && sh === iw);
  }

  private languageMatches(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    // Browsers/Intl report BCP-47 hyphenated tags ("en-NG"); native iOS APIs
    // report underscore-separated ICU tags ("en_US", or "en_US_POSIX" on the
    // Simulator specifically) — split on either so both reduce to "en".
    const primary = (l: string) => l.toLowerCase().split(/[-_]/)[0];
    return primary(a) === primary(b);
  }
}
