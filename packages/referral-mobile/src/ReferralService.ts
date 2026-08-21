import { Platform } from 'react-native';
import { createApi } from './api';
import { collectFingerprint } from './fingerprint';
import { recoverAndroid } from './platform/android';
import { recoverIos } from './platform/ios';
import type {
  ClaimResult,
  DeviceFingerprint,
  ReferralConfig,
  RecoveryOutcome,
} from './types';

const NO_CODE: RecoveryOutcome = { code: null, method: null, confidence: null, clickId: null };

/**
 * Coordinates one-time referral recovery.
 *
 * The SDK persists nothing to disk — no AsyncStorage, no dependency to
 * install, no storageAdapter to configure. `lastRecovery` caches the
 * result in memory only, so mounting the hook on multiple screens within
 * the same session is safe and free (no repeat network calls), but a
 * fresh app launch always calls `recover()` again from scratch.
 *
 * That's a deliberate tradeoff, not an oversight: `/match` is rate-limited
 * per device (default 5/day). Calling `recover()` unconditionally on
 * *every* app launch — e.g. from a provider mounted at the app root — will
 * burn through that budget on routine opens. This SDK is designed to be
 * mounted on a one-time flow instead (a signup/onboarding screen a given
 * install visits once, not an always-on root component) — see the README
 * before wiring this in anywhere else. Duplicate-signup protection is
 * unaffected either way: it's entirely server-side (device_id is unique
 * per conversion), not something client persistence was ever providing.
 *
 * Every recovered `code` now comes with a `clickId` referencing a click the
 * server has actually locked to this device — /claim requires and verifies
 * it (see docs/decisions.md #21). A `code` without a usable `clickId` is
 * treated as no code at all throughout this class, since it could never
 * actually be claimed.
 */
export class ReferralService {
  private readonly api;
  private lastRecovery: RecoveryOutcome | null = null;

  constructor(private readonly config: ReferralConfig) {
    this.api = createApi(config);
  }

  async recover(): Promise<RecoveryOutcome> {
    // Already ran this session (e.g. the hook mounted on a second screen) —
    // replay the in-memory result instead of hitting the network again.
    if (this.lastRecovery) return this.lastRecovery;

    const fingerprint = await collectFingerprint();

    const matchViaFingerprint = async (fp: DeviceFingerprint): Promise<RecoveryOutcome> => {
      try {
        const res = await this.api.match(fp);
        if (!res.matched || !res.referral_code || !res.click_id) return NO_CODE;
        return {
          code: res.referral_code,
          method: 'fingerprint',
          confidence: res.confidence ?? null,
          clickId: res.click_id,
        };
      } catch {
        return NO_CODE;
      }
    };

    const redeemDeterministic = async (
      clickId: string,
      method: 'install_referrer' | 'clipboard',
    ): Promise<RecoveryOutcome> => {
      try {
        const res = await this.api.redeem(fingerprint.device_id, fingerprint.platform, clickId, method);
        if (!res.matched || !res.referral_code || !res.click_id) return NO_CODE;
        return { code: res.referral_code, method, confidence: null, clickId: res.click_id };
      } catch {
        return NO_CODE;
      }
    };

    const result =
      Platform.OS === 'android'
        ? await recoverAndroid(fingerprint, matchViaFingerprint, (clickId) =>
            redeemDeterministic(clickId, 'install_referrer'),
          )
        : await recoverIos(fingerprint, matchViaFingerprint);

    this.lastRecovery = result;

    if (result.code) {
      this.config.onCodeFound?.(result.code, result.method!);
    } else {
      this.config.onNoCode?.();
    }

    return result;
  }

  /**
   * Records the conversion after signup. Claims whatever this session's own
   * `recover()` (or `applyClipboardCode()`) found — there's no override
   * parameter for a code recovered elsewhere anymore, because `/claim` now
   * requires a `clickId` referencing a click actually locked server-side
   * (see docs/decisions.md #21), and the SDK persists nothing that could
   * supply one for a code it didn't just recover itself.
   *
   * Duplicate-claim detection is entirely server-side (device_id is unique
   * per conversion — see referral_conversions' schema), so this doesn't
   * track "already claimed" locally; a second call just gets that answer
   * back from the API instead of guessing at it beforehand.
   */
  async claim(userId: string): Promise<ClaimResult> {
    if (!this.lastRecovery?.code || !this.lastRecovery.clickId) {
      return { success: false, error: 'no_code' };
    }

    const fingerprint = await collectFingerprint();
    return this.api.claim({
      referralCode: this.lastRecovery.code,
      deviceId: fingerprint.device_id,
      platform: fingerprint.platform,
      clickId: this.lastRecovery.clickId,
      userId,
    });
  }

  /**
   * Applies a code recovered deterministically via the clipboard tier
   * (ReferralPasteButton), overriding whatever the automatic fingerprint
   * path already found. Unlike `recover()`, this is user-triggered (a tap
   * on the paste control), not automatic, so it can fire at any point after
   * mount, not just once on launch.
   *
   * `clickId` — from the same clipboard payload — must still be redeemed
   * server-side before it's usable: /claim requires a real locked click,
   * not just a code (see docs/decisions.md #21), so this call itself is
   * what performs that lock, same deterministic /match fast-path Android's
   * install referrer uses. A missing `clickId` (an older payload written
   * before this SDK version, or a click registration that didn't resolve
   * in time) or a failed redeem (expired, already matched elsewhere,
   * network error) both surface as no code recovered — a code the app
   * could display but never successfully claim isn't a useful result to
   * hand back.
   */
  async applyClipboardCode(code: string, clickId: string | null): Promise<RecoveryOutcome> {
    let result: RecoveryOutcome;

    if (!clickId) {
      result = NO_CODE;
    } else {
      const fingerprint = await collectFingerprint();
      try {
        const res = await this.api.redeem(fingerprint.device_id, fingerprint.platform, clickId, 'clipboard');
        result =
          res.matched && res.referral_code && res.click_id
            ? { code: res.referral_code, method: 'clipboard', confidence: null, clickId: res.click_id }
            : NO_CODE;
      } catch {
        result = NO_CODE;
      }
    }

    // Trust the server's own record of what it just locked over the raw
    // parsed string — they should always agree, so a mismatch here would
    // point at a real bug (e.g. a stale/tampered clipboard payload) worth
    // surfacing rather than silently overriding.
    if (result.code && result.code !== code) {
      console.warn(
        `Referral clipboard code mismatch: parsed "${code}" but the server redeemed "${result.code}" — using the server's value.`,
      );
    }

    this.lastRecovery = result;
    if (result.code) {
      this.config.onCodeFound?.(result.code, 'clipboard');
    } else {
      this.config.onNoCode?.();
    }
    return result;
  }

  /** Test/debug helper — clears the in-memory recovery cache so `recover()` runs again. */
  reset(): void {
    this.lastRecovery = null;
  }
}
