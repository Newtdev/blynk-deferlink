import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralConversions } from '../db/schema.js';

export interface ClaimInput {
  referralCode: string;
  deviceId: string;
  platform: 'ios' | 'android';
  matchMethod: 'install_referrer' | 'fingerprint' | 'clipboard';
  clickId?: string | null;
  userId?: string | null;
  confidence?: number | null;
}

export interface Reward {
  type: string;
  amount: number;
}

export type ClaimResult =
  | { success: true; reward: Reward }
  | { success: false; duplicate: boolean };

/**
 * Records referral conversions and distributes rewards. Enforces one
 * referral per device for the device's lifetime. Ported from
 * packages/referral-sdk/src/Services/ConversionTracker.php.
 */
export class ConversionTracker {
  constructor(
    private readonly db: Db,
    private readonly config: ReferralConfig,
  ) {}

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const storedDeviceId = this.config.hashDeviceIds
      ? hashDeviceId(input.deviceId)
      : input.deviceId;

    if (await this.deviceHasConverted(storedDeviceId)) {
      return { success: false, duplicate: true };
    }

    try {
      await this.db.insert(referralConversions).values({
        clickId: input.clickId ?? randomUUID(),
        referralCode: input.referralCode,
        deviceId: storedDeviceId,
        platform: input.platform,
        matchMethod: input.matchMethod,
        matchConfidence: input.confidence ?? null,
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

function isUniqueViolation(err: unknown): boolean {
  // Postgres SQLSTATE 23505 = unique_violation. The Neon HTTP driver
  // surfaces this as `.code` on the thrown error, same as node-postgres.
  const code = (err as { code?: string } | null)?.code;
  return code === '23505';
}
