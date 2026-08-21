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

const NO_CODE: RecoveryOutcome = { code: null, method: null, confidence: null, token: null };

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
 * Every recovered `code` now comes with a `token` proving the click is
 * real — /claim requires and verifies it (see docs/decisions.md #21/#22).
 * A `code` without a usable `token` is treated as no code at all
 * throughout this class, since it could never actually be claimed.
 * Recovering the token costs nothing extra for the deterministic paths
 * (Android Install Referrer, iOS clipboard): it rides along in the same
 * referrer param / clipboard payload the code already came from, read
 * purely locally, no network call — see platform/android.ts and
 * platform/clipboardPayload.ts.
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
        if (!res.matched || !res.referral_code || !res.token) return NO_CODE;
        return {
          code: res.referral_code,
          method: 'fingerprint',
          confidence: res.confidence ?? null,
          token: res.token,
        };
      } catch {
        return NO_CODE;
      }
    };

    // Android's Install Referrer is read purely locally (see
    // platform/android.ts) — no callback needed here for it anymore, unlike
    // the now-superseded design that redeemed it via a /match round-trip.
    const result =
      Platform.OS === 'android'
        ? await recoverAndroid(fingerprint, matchViaFingerprint)
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
   * requires a `token` proving a click actually happened (see
   * docs/decisions.md #21/#22), and the SDK persists nothing that could
   * supply one for a code it didn't just recover itself.
   *
   * Duplicate-claim detection is entirely server-side (device_id is unique
   * per conversion — see referral_conversions' schema), so this doesn't
   * track "already claimed" locally; a second call just gets that answer
   * back from the API instead of guessing at it beforehand.
   */
  async claim(userId: string): Promise<ClaimResult> {
    if (!this.lastRecovery?.code || !this.lastRecovery.token) {
      return { success: false, error: 'no_code' };
    }

    const fingerprint = await collectFingerprint();
    return this.api.claim({
      deviceId: fingerprint.device_id,
      platform: fingerprint.platform,
      token: this.lastRecovery.token,
      method: this.lastRecovery.method ?? undefined,
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
   * Purely local, same as the clipboard read itself — no network call.
   * `token`, from the same clipboard payload, is carried straight through
   * to `/claim` later, not verified or redeemed here (see
   * docs/decisions.md #22). A missing `token` (an older payload written
   * before this SDK version, or a click registration that didn't resolve
   * in time) surfaces as no code recovered — a code the app could display
   * but never successfully claim isn't a useful result to hand back.
   */
  applyClipboardCode(code: string, token: string | null): RecoveryOutcome {
    const result: RecoveryOutcome = token ? { code, method: 'clipboard', confidence: null, token } : NO_CODE;

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
