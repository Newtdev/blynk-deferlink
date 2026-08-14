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
 * Coordinates one-time referral recovery. Idempotent across launches: once it
 * has run, the stored result is returned instead of hitting the network again.
 */
export class ReferralService {
  private readonly api;
  private readonly storage: ReferralStorage;

  constructor(private readonly config: ReferralConfig) {
    this.api = createApi(config);
    // Falls back to AsyncStorage (lazily required) only if the project
    // didn't supply its own storageAdapter — see ReferralStorageAdapter.
    this.storage = createStorage(config.storageAdapter ?? defaultAsyncStorageAdapter());
  }

  async recover(): Promise<RecoveryOutcome> {
    if (await this.storage.isProcessed()) {
      const saved = await this.storage.getCode();
      return {
        code: saved?.code ?? null,
        method: saved?.method ?? null,
        confidence: saved?.confidence ?? null,
      };
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

    if (outcome.code) {
      await this.storage.saveCode({
        code: outcome.code,
        method: outcome.method,
        confidence,
        claimed: false,
      });
      this.config.onCodeFound?.(outcome.code, outcome.method);
    } else {
      this.config.onNoCode?.();
    }

    return { code: outcome.code, method: outcome.method, confidence };
  }

  async claim(userId: string): Promise<ClaimResult> {
    const saved = await this.storage.getCode();
    if (!saved?.code) {
      return { success: false, error: 'no_code' };
    }
    if (saved.claimed) {
      return { success: false, error: 'already_claimed' };
    }

    const fingerprint = await collectFingerprint();
    const result = await this.api.claim({
      referralCode: saved.code,
      deviceId: fingerprint.device_id,
      platform: fingerprint.platform,
      method: saved.method,
      userId,
      confidence: saved.confidence,
    });

    if (result.success) {
      await this.storage.markClaimed();
    }
    return result;
  }

  /** Test/debug helper — clears recovery state so the flow can run again. */
  async reset(): Promise<void> {
    await this.storage.reset();
  }
}
