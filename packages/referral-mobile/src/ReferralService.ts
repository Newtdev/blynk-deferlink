import { Platform } from 'react-native';
import { createApi } from './api';
import { collectFingerprint } from './fingerprint';
import { recoverAndroid } from './platform/android';
import { recoverIos } from './platform/ios';
import { createStorage, defaultAsyncStorageAdapter, type ReferralStorage } from './storage';
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
 * Idempotent within a session: `lastRecovery` caches the result in memory
 * so mounting the hook on multiple screens is safe and free (no repeat
 * network calls). Idempotent *across* launches too, but differently — only
 * a persisted "has this install already been attempted" flag survives a
 * restart, not the recovered code itself. That's deliberate: most apps
 * already have their own storage (Redux, MMKV) and shouldn't need a second
 * copy of the code living in this SDK — see storage.ts. It also means a
 * fresh JS instance after a restart can't replay a code it never kept, so
 * `recover()` correctly reports nothing new rather than pretending to.
 */
export class ReferralService {
  private readonly api;
  private readonly storage: ReferralStorage;
  private lastRecovery: RecoveryOutcome | null = null;

  constructor(private readonly config: ReferralConfig) {
    this.api = createApi(config);
    // Falls back to AsyncStorage (lazily required) only if the project
    // didn't supply its own storageAdapter — see ReferralStorageAdapter.
    this.storage = createStorage(config.storageAdapter ?? defaultAsyncStorageAdapter());
  }

  async recover(): Promise<RecoveryOutcome> {
    // Already ran this session (e.g. the hook mounted on a second screen) —
    // replay the in-memory result instead of hitting the network again.
    if (this.lastRecovery) return this.lastRecovery;

    if (await this.storage.isProcessed()) {
      // Recovery was already attempted in an earlier session. The SDK
      // doesn't keep the result around across restarts, so there's
      // nothing new to report — if the app needs the code again later, it
      // needed to have stored it itself when onCodeFound first fired.
      return { code: null, method: null, confidence: null };
    }

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

    // Recovery runs once per install regardless of result — don't re-scan.
    await this.storage.markProcessed();

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

  /** Test/debug helper — clears recovery state so the flow can run again. */
  async reset(): Promise<void> {
    this.lastRecovery = null;
    await this.storage.reset();
  }
}
