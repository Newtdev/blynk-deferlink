import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralConversions } from '../db/schema.js';
import type { ClickStore } from './clickStore.js';

export interface ClaimInput {
  referralCode: string;
  deviceId: string;
  platform: 'ios' | 'android';
  clickId: string;
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
 * `claim()` trusts nothing the caller *says* happened — `method` and
 * `confidence` are pulled from the click row `/match` (or the deterministic
 * redeem path) already locked, not from the claim request itself. See
 * decisions.md #21: a client-declared `device_id`/`method`/`confidence`
 * with no server-side proof was previously enough to mint a reward with no
 * real click or match ever happening.
 */
export class ConversionTracker {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
    private readonly clicks: ClickStore,
  ) {}

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const storedDeviceId = resolveDeviceId(input.deviceId, this.config);

    // The entire proof: click_id must reference a row this exact device
    // already won the lock on, for the exact code being claimed. A click_id
    // never reaches an arbitrary requester — only the device that performed
    // a real /click + /match (or deterministic redeem) ever sees one.
    const locked = await this.clicks.findLockedClick(input.clickId);
    if (!locked || locked.referralCode !== input.referralCode || locked.matchedDeviceId !== storedDeviceId) {
      return { success: false, unverified: true };
    }

    if (await this.deviceHasConverted(storedDeviceId)) {
      return { success: false, duplicate: true };
    }

    try {
      await this.db.insert(referralConversions).values({
        clickId: input.clickId,
        referralCode: input.referralCode,
        deviceId: storedDeviceId,
        platform: input.platform,
        matchMethod: locked.matchMethod ?? 'fingerprint',
        matchConfidence: locked.matchConfidence,
        userId: input.userId ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Unique index on device_id — lost a concurrent race. Treat as dupe.
        return { success: false, duplicate: true };
      }
      throw err;
    }

    const reward = await this.distributeReward(input.referralCode, input.userId ?? null);
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
 * lock-ownership check (`locked.matchedDeviceId !== storedDeviceId`)
 * compares a hash against a raw value and never matches.
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
