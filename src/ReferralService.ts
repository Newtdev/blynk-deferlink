import { Platform } from 'react-native';
import { createApi } from './api';
import { collectFingerprint } from './fingerprint';
import { recoverAndroid } from './platform/android';
import { recoverIos } from './platform/ios';
import type {
  ClaimResult,
  DeviceFingerprint,
  MatchMethod,
  ReferralConfig,
} from './types';

export interface RecoveryOutcome {
  code: string | null;
  method: MatchMethod | null;
  confidence: number | null;
}

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
    let confidence: number | null = null;

    const matchViaFingerprint = async (
      fp: DeviceFingerprint,
    ): Promise<string | null> => {
      try {
        const res = await this.api.match(fp);
        confidence = res.confidence ?? null;
        return res.matched ? res.referral_code : null;
      } catch {
        return null;
      }
    };

    const outcome =
      Platform.OS === 'android'
        ? await recoverAndroid(fingerprint, matchViaFingerprint)
        : await recoverIos(fingerprint, matchViaFingerprint);

    const result: RecoveryOutcome = { code: outcome.code, method: outcome.method, confidence };
    this.lastRecovery = result;

    if (outcome.code) {
      this.config.onCodeFound?.(outcome.code, outcome.method);
    } else {
      this.config.onNoCode?.();
    }

    return result;
  }

  /**
   * Records the conversion after signup. `code` defaults to whatever this
   * session's own `recover()` call found — the common case, needing no
   * arguments. Pass it explicitly only if the app is claiming a code it
   * recovered and stored itself in an *earlier* session (the SDK doesn't
   * persist it — see the class doc above); in that case `method` isn't
   * known either and falls back to `'fingerprint'` as a reasonable guess
   * rather than a hard requirement to also thread it through.
   *
   * Duplicate-claim detection is entirely server-side (device_id is unique
   * per conversion — see referral_conversions' schema), so this doesn't
   * track "already claimed" locally; a second call just gets that answer
   * back from the API instead of guessing at it beforehand.
   */
  async claim(userId: string, code?: string): Promise<ClaimResult> {
    const resolvedCode = code ?? this.lastRecovery?.code ?? null;
    if (!resolvedCode) {
      return { success: false, error: 'no_code' };
    }

    const fingerprint = await collectFingerprint();
    return this.api.claim({
      referralCode: resolvedCode,
      deviceId: fingerprint.device_id,
      platform: fingerprint.platform,
      method: this.lastRecovery?.method ?? 'fingerprint',
      userId,
      confidence: this.lastRecovery?.confidence ?? null,
    });
  }

  /**
   * Applies a code recovered deterministically via the clipboard tier
   * (ReferralPasteButton), overriding whatever the automatic fingerprint
   * path already found — clipboard recovery is exact-match, strictly more
   * trustworthy than a probabilistic score. Unlike `recover()`, this is
   * user-triggered (a tap on the paste control), not automatic, so it can
   * fire at any point after mount, not just once on launch.
   */
  applyClipboardCode(code: string): RecoveryOutcome {
    const result: RecoveryOutcome = { code, method: 'clipboard', confidence: null };
    this.lastRecovery = result;
    this.config.onCodeFound?.(code, 'clipboard');
    return result;
  }

  /** Test/debug helper — clears the in-memory recovery cache so `recover()` runs again. */
  reset(): void {
    this.lastRecovery = null;
  }
}
