import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralConversions } from '../db/schema.js';
import { getClickTokenSecret, verifyClickToken } from '../support/clickToken.js';
import type { ClickStore, MatchMethod } from './clickStore.js';

export interface ClaimInput {
  deviceId: string;
  platform: 'ios' | 'android';
  /** Signed by /click (and /match, on a successful lock) — see clickToken.ts. */
  token: string;
  /**
   * Only read when the token's click hasn't been matched yet (the
   * deterministic path's first real use, since it never went through
   * /match) — a labeling detail for the row, not a security check either
   * way. Ignored when the click is already matched (/match already
   * recorded what actually happened). Defaults to 'fingerprint' if
   * omitted, matching this SDK's long-standing fallback for "method
   * wasn't threaded through."
   */
  method?: MatchMethod;
  userId?: string | null;
}

export interface Reward {
  type: string;
  amount: number;
}

export type ClaimResult =
  | { success: true; reward: Reward }
  | { success: false; duplicate: boolean }
  | { success: false; unverified: true };

/**
 * Records referral conversions and distributes rewards. Enforces one
 * referral per device for the device's lifetime. Ported from
 * packages/referral-sdk/src/Services/ConversionTracker.php.
 *
 * `claim()` trusts nothing the caller *says* happened — the entire proof is
 * a signed `token` (see support/clickToken.ts), verified here, never a
 * client-declared `referral_code`/`click_id`/`method`/`confidence`. See
 * decisions.md #21/#22: a client-declared device_id/method/confidence with
 * no server-side proof was previously enough to mint a reward with no real
 * click or match ever happening; #22 moved that proof to a signed token
 * minted for free at /click time instead of a redeem round-trip that made
 * ordinary code recovery depend on the network.
 */
export class ConversionTracker {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
    private readonly clicks: ClickStore,
  ) {}

  /** `now` defaults to the real current time; tests pass an explicit value for determinism. */
  async claim(input: ClaimInput, now: Date = new Date()): Promise<ClaimResult> {
    const verified = verifyClickToken(input.token, getClickTokenSecret(), now);
    if (!verified) {
      return { success: false, unverified: true };
    }

    const click = await this.clicks.findClickForClaim(verified.clickId);
    if (!click || click.expiresAt.getTime() < now.getTime()) {
      return { success: false, unverified: true };
    }

    const storedDeviceId = resolveDeviceId(input.deviceId, this.config);
    let matchMethod: MatchMethod;
    let matchConfidence: number | null;

    if (click.matched) {
      // Fingerprint path — /match already locked this click. Confirm the
      // lock belongs to this device; nothing to lock here.
      if (click.matchedDeviceId !== storedDeviceId) {
        return { success: false, unverified: true };
      }
      matchMethod = click.matchMethod ?? 'fingerprint';
      matchConfidence = click.matchConfidence;
    } else {
      // Deterministic path's first real use — lock it right here,
      // atomically. Lost the race (something else claimed it first)?
      // Reject rather than proceed on a click that isn't actually ours.
      matchMethod = input.method ?? 'fingerprint';
      const locked = await this.clicks.lockToDevice(verified.clickId, storedDeviceId, matchMethod, null);
      if (!locked) {
        return { success: false, unverified: true };
      }
      matchConfidence = null;
    }

    if (await this.deviceHasConverted(storedDeviceId)) {
      return { success: false, duplicate: true };
    }

    try {
      await this.db.insert(referralConversions).values({
        clickId: verified.clickId,
        referralCode: click.referralCode,
        deviceId: storedDeviceId,
        platform: input.platform,
        matchMethod,
        matchConfidence,
        userId: input.userId ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Unique index on device_id — lost a concurrent race. Treat as dupe.
        return { success: false, duplicate: true };
      }
      throw err;
    }

    const reward = await this.distributeReward(click.referralCode, input.userId ?? null);
    return { success: true, reward };
  }

  async deviceHasConverted(storedDeviceId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: referralConversions.id })
      .from(referralConversions)
      .where(eq(referralConversions.deviceId, storedDeviceId))
      .limit(1);
    return rows.length > 0;
  }

  private async distributeReward(referralCode: string, userId: string | null): Promise<Reward> {
    if (!this.config.rewards.enabled) {
      return { type: 'none', amount: 0 };
    }

    // Optional project-supplied callback for actually crediting accounts.
    if (this.config.rewards.on_claim_callback) {
      await this.config.rewards.on_claim_callback(referralCode, userId, this.config.rewards);
    }

    return {
      type: this.config.rewards.reward_type,
      amount: this.config.rewards.referee_reward,
    };
  }
}

/** One-way, for dedup only. Never reversed. */
export function hashDeviceId(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex');
}

/**
 * Applies `hash_device_ids` consistently everywhere a device_id is
 * persisted — `referral_clicks.matched_device_id` (see ClickStore.lockToDevice,
 * called from routes/referral.ts) and `referral_conversions.device_id`
 * (this file) both need to agree on the same stored form, or claim()'s
 * lock-ownership check (`matchedDeviceId !== storedDeviceId`) compares a
 * hash against a raw value and never matches.
 */
export function resolveDeviceId(deviceId: string, config: ReferralConfig): string {
  return config.hashDeviceIds ? hashDeviceId(deviceId) : deviceId;
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres SQLSTATE 23505 = unique_violation. The Neon HTTP driver
  // surfaces this as `.code` on the thrown error, same as node-postgres.
  const code = (err as { code?: string } | null)?.code;
  return code === '23505';
}
