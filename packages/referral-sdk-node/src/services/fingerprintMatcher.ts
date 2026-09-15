import { and, desc, gt, gte } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralClicks, referralMatchAttempts } from '../db/schema.js';
import { resolveDeviceId } from '../support/deviceId.js';
import { parseModel, parseUa, type UaSignature } from '../support/userAgentParser.js';

/** A stored click row, as read back from the DB (only the columns scoring needs). */
export interface StoredClickFingerprint {
  ipAddress: string;
  userAgent: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  timezone: string | null;
  language: string | null;
  createdAt: Date;
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
  /**
   * Only used for `referral_match_attempts` logging (see #15 in
   * decisions.md) — not part of scoring itself. Optional so `score()`'s
   * existing unit tests (which build an IncomingFingerprint without one)
   * keep working untouched; `match()` treats a missing one as "unknown".
   */
  deviceId?: string;
}

export interface MatchResult {
  clickId: string;
  referralCode: string;
  confidence: number;
  /** So the caller (routes/referral.ts) can sign a click token against the same expiry the row already has. */
  expiresAt: Date;
}

/**
 * Scores an incoming fingerprint against stored clicks and returns the best
 * match above the configured confidence threshold. Ported field-for-field
 * from packages/referral-sdk/src/Services/FingerprintMatcher.php — keep the
 * two in sync if the heuristics change, so PHP and Node backends agree on
 * what counts as a match.
 *
 * Scoring (default weights, configurable via ReferralConfig.scoring):
 *   IP match          +25
 *   Device model/UA   +25
 *   Screen dimensions +15
 *   Timezone          +10
 *   Language          +10
 *   Recency           +15  (graduated — full at the click, 0 at the window edge)
 *   ----------------------
 *   Total possible    100   |   Minimum to match: 70
 *
 * Recency exists so an IP mismatch (network switch between click and
 * install) doesn't fail the match outright on its own: a fresh, otherwise
 * clean match can still clear 70 without it.
 */
export class FingerprintMatcher {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
  ) {}

  /**
   * Pure scoring function — no DB, no side effects, safe to unit test
   * directly. `now` defaults to the real current time; tests pass an
   * explicit value to exercise recency decay deterministically.
   */
  score(stored: StoredClickFingerprint, incoming: IncomingFingerprint, now: Date = new Date()): number {
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

    // --- Recency (graduated) ---
    score += this.recencyScore(stored, now);

    return score;
  }

  /**
   * Full credit at the click, decaying linearly to 0 by the edge of the
   * match window. Clock skew that makes the click look like it's in the
   * future is clamped to full credit rather than penalized.
   */
  private recencyScore(stored: StoredClickFingerprint, now: Date): number {
    const weight = this.config.scoring.recency;
    if (!weight) return 0;

    const windowMs = this.config.matchWindowSeconds() * 1000;
    if (windowMs <= 0) return 0;

    const elapsedMs = now.getTime() - stored.createdAt.getTime();
    if (elapsedMs <= 0) return weight;
    if (elapsedMs >= windowMs) return 0;

    return weight * (1 - elapsedMs / windowMs);
  }

  /**
   * Find the best matching click for a device, within the match window.
   *
   * Matching deliberately does **not** consume a click. `matched` means
   * "last matched by", not "used up" — see docs/decisions.md #30. An
   * already-matched click stays a candidate, which is what lets a reinstall
   * recover (on iOS the device id itself changes when the last vendor app is
   * uninstalled, so the returning device is a *new* device as far as this
   * table is concerned) and what stops a second match from silently falling
   * through to a runner-up and re-attributing the user to a different
   * referrer. Guarding against a code being redeemed twice belongs in
   * whatever records signups, not in making the click invisible here.
   *
   * `deviceId` (already hashed) lets a device keep an attribution it has
   * already been given if its fingerprint later stops clearing the
   * confidence threshold.
   */
  async match(incoming: IncomingFingerprint, deviceId?: string): Promise<MatchResult | null> {
    const windowStart = new Date(Date.now() - this.config.matchWindowSeconds() * 1000);

    // No `matched = false` filter: that single clause was the whole of #17.
    // The expiry check mirrors the PHP backend, which has always had it —
    // the two are meant to be interchangeable, and without it this would
    // diverge the moment expiry and the match window are configured to
    // different durations.
    // Newest first so ties resolve last-click-wins, and so the first row seen
    // for this device is its most recent binding — ordering by matchedAt
    // instead would be unstable at one-second storage resolution.
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
        createdAt: referralClicks.createdAt,
        expiresAt: referralClicks.expiresAt,
        matchedDeviceId: referralClicks.matchedDeviceId,
      })
      .from(referralClicks)
      .where(
        and(
          gte(referralClicks.createdAt, windowStart),
          gt(referralClicks.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(referralClicks.createdAt));

    let best: (typeof rows)[number] | null = null;
    let bestScore = 0;
    let existing: (typeof rows)[number] | null = null;

    for (const row of rows) {
      // Rows arrive newest-first, so the first one bound to this device is
      // its newest binding; later (older) ones are superseded.
      if (existing === null && deviceId !== undefined && row.matchedDeviceId === deviceId) {
        existing = row;
      }

      const s = this.score(row, incoming);
      if (s > bestScore) {
        bestScore = s;
        best = row;
      }
    }

    // Only a candidate clearing the threshold may take an attribution over.
    // Without this a newer but unrelated click could steal one purely by
    // being recent.
    const bestQualifies = best !== null && bestScore >= this.config.minConfidence;
    const candidate = bestQualifies ? best : null;

    let winner: (typeof rows)[number] | null;
    if (candidate !== null && existing !== null) {
      // Last-click-wins, compared by the *click's* time rather than by
      // confidence: a stale click that happens to score higher is still the
      // wrong answer.
      winner = candidate.createdAt.getTime() > existing.createdAt.getTime() ? candidate : existing;
    } else {
      // Falling back to `existing` keeps an attribution the device already
      // has when nothing clears the threshold this time — a retry or a
      // relaunch on a weaker signal must not silently lose it.
      winner = candidate ?? existing;
    }

    await this.logAttempt(incoming, {
      matched: winner !== null,
      candidateCount: rows.length,
      bestScore: rows.length > 0 ? bestScore : null,
      bestClickId: best?.clickId ?? null,
    });

    if (winner === null) return null;

    // Re-score the winner rather than reusing bestScore, which belongs to
    // `best` and would be wrong whenever `existing` won.
    const confidence = winner === best ? bestScore : this.score(winner, incoming);

    return {
      clickId: winner.clickId,
      referralCode: winner.referralCode,
      confidence: Math.round(confidence * 100) / 100,
      expiresAt: winner.expiresAt,
    };
  }

  /**
   * Logs every /match attempt, success or failure — see #15 in
   * decisions.md for why: a genuine low-confidence miss and a client
   * config/network error were otherwise indistinguishable from outside
   * the request. Best-effort and isolated deliberately — a logging
   * failure must never turn a real match (or a real non-match) into a
   * 500, so failures here are swallowed, not thrown.
   *
   * `device_id` is hashed the same way `hash_device_ids` hashes it
   * everywhere else (`referral_clicks.matched_device_id`,
   * `referral_conversions.device_id`) — this table stored it raw before,
   * contradicting the config's own documented privacy promise. See
   * decisions.md #23.
   */
  private async logAttempt(
    incoming: IncomingFingerprint,
    outcome: { matched: boolean; candidateCount: number; bestScore: number | null; bestClickId: string | null },
  ): Promise<void> {
    try {
      await this.db.insert(referralMatchAttempts).values({
        deviceId: incoming.deviceId ? resolveDeviceId(incoming.deviceId, this.config) : 'unknown',
        platform: incoming.platform ?? 'unknown',
        ipAddress: incoming.ip,
        userAgent: incoming.userAgent ?? null,
        deviceModel: incoming.deviceModel ?? null,
        screenWidth: incoming.screenWidth ?? null,
        screenHeight: incoming.screenHeight ?? null,
        timezone: incoming.timezone ?? null,
        language: incoming.language ?? null,
        matched: outcome.matched,
        candidateCount: outcome.candidateCount,
        bestScore: outcome.bestScore,
        bestClickId: outcome.bestClickId,
      });
    } catch (err) {
      console.warn('Failed to log match attempt (non-fatal):', err);
    }
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
