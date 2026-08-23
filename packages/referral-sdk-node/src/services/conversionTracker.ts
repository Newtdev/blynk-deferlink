import { eq } from 'drizzle-orm';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { referralConversions } from '../db/schema.js';
import { getClickTokenSecret, verifyClickToken } from '../support/clickToken.js';
import { resolveDeviceId } from '../support/deviceId.js';
import type { ClickStore, MatchMethod } from './clickStore.js';

export { hashDeviceId, resolveDeviceId } from '../support/deviceId.js';

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

    const reward = await this.distributeReward(verified.clickId, click.referralCode, input.userId ?? null);
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

  /**
   * The conversion row is already committed by the time this runs (it has
   * to be — the dedup/unique-device guarantee needs to land before
   * crediting anything). So a failing `on_claim_callback` (e.g. your own
   * account-crediting call is down) must not throw past that: it used
   * to, leaving a device permanently marked "converted" with no reward
   * and the client staring at a misleading 500. Caught here instead —
   * logged, the row marked `reward_status = 'failed'` (defaults to
   * `'granted'` optimistically on insert) for reconciliation, and
   * `claim()` still reports success, because the conversion itself — "this
   * device used this code, once" — is real and final regardless of
   * whether the reward side effect landed. See decisions.md #23.
   */
  private async distributeReward(clickId: string, referralCode: string, userId: string | null): Promise<Reward> {
    if (!this.config.rewards.enabled) {
      return { type: 'none', amount: 0 };
    }

    if (this.config.rewards.on_claim_callback) {
      try {
        await this.config.rewards.on_claim_callback(referralCode, userId, this.config.rewards);
      } catch (err) {
        console.error(
          `on_claim_callback failed for click ${clickId} (code ${referralCode}) — conversion already recorded, reward not confirmed granted. Marked reward_status='failed' for reconciliation.`,
          err,
        );
        await this.db
          .update(referralConversions)
          .set({ rewardStatus: 'failed' })
          .where(eq(referralConversions.clickId, clickId));
      }
    }

    return {
      type: this.config.rewards.reward_type,
      amount: this.config.rewards.referee_reward,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres SQLSTATE 23505 = unique_violation. The Neon HTTP driver
  // surfaces this as `.code` on the thrown error, same as node-postgres.
  const code = (err as { code?: string } | null)?.code;
  return code === '23505';
}
