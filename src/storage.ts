import type { MatchMethod, ReferralStorageAdapter } from './types';

const PROCESSED_KEY = 'sparkle.referral.processed';
const CODE_KEY = 'sparkle.referral.code';

export interface StoredReferral {
  code: string;
  method: MatchMethod;
  confidence: number | null;
  claimed: boolean;
}

export interface ReferralStorage {
  isProcessed(): Promise<boolean>;
  markProcessed(): Promise<void>;
  saveCode(data: StoredReferral): Promise<void>;
  getCode(): Promise<StoredReferral | null>;
  markClaimed(): Promise<void>;
  reset(): Promise<void>;
}

/**
 * Builds the referral-specific storage operations on top of a plain
 * key/value adapter. Framework-agnostic — works identically whether the
 * adapter wraps AsyncStorage, MMKV, or anything else conforming to
 * ReferralStorageAdapter.
 */
export function createStorage(adapter: ReferralStorageAdapter): ReferralStorage {
  return {
    async isProcessed(): Promise<boolean> {
      return (await adapter.getItem(PROCESSED_KEY)) === '1';
    },

    async markProcessed(): Promise<void> {
      await adapter.setItem(PROCESSED_KEY, '1');
    },

    async saveCode(data: StoredReferral): Promise<void> {
      await adapter.setItem(CODE_KEY, JSON.stringify(data));
    },

    async getCode(): Promise<StoredReferral | null> {
      const raw = await adapter.getItem(CODE_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StoredReferral;
      } catch {
        return null;
      }
    },

    async markClaimed(): Promise<void> {
      const existing = await this.getCode();
      if (existing) {
        await this.saveCode({ ...existing, claimed: true });
      }
    },

    async reset(): Promise<void> {
      await adapter.removeItem(PROCESSED_KEY);
      await adapter.removeItem(CODE_KEY);
    },
  };
}

/**
 * The zero-config default: lazily requires
 * `@react-native-async-storage/async-storage` only when no `storageAdapter`
 * was supplied in ReferralConfig. Throws a clear, actionable error (rather
 * than a cryptic "cannot find module" deep in an async call) if it's
 * missing — a project that already has its own storage engine should pass
 * `storageAdapter` instead of installing this.
 */
export function defaultAsyncStorageAdapter(): ReferralStorageAdapter {
  let AsyncStorage: ReferralStorageAdapter | undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AsyncStorage = require('@react-native-async-storage/async-storage').default;
  } catch {
    throw new Error(
      '@sparkle/referral-mobile: no `storageAdapter` was provided in ReferralConfig, ' +
        'and @react-native-async-storage/async-storage is not installed. Either ' +
        '`npm install @react-native-async-storage/async-storage`, or pass your own ' +
        'storageAdapter (e.g. wrapping MMKV) — see ReferralStorageAdapter.',
    );
  }

  return AsyncStorage as ReferralStorageAdapter;
}
