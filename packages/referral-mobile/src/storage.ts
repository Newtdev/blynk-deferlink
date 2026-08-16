import type { ReferralStorageAdapter } from './types';

const PROCESSED_KEY = 'sparkle.referral.processed';

export interface ReferralStorage {
  isProcessed(): Promise<boolean>;
  markProcessed(): Promise<void>;
  reset(): Promise<void>;
}

/**
 * The SDK persists exactly one thing: whether recovery has already been
 * attempted for this install. It deliberately does NOT persist the
 * recovered code itself — most apps already have their own storage
 * (Redux, MMKV) and shouldn't need a second copy living in this SDK too.
 * `useReferralCode()` hands the code to the caller directly on the launch
 * that recovers it; from there, remembering it across sessions (if the
 * app needs to) is the app's job, not this SDK's.
 *
 * This flag exists for a concrete reason, not just tidiness: the /match
 * endpoint is rate-limited per device (default 5/day). Without it,
 * recovery would re-run — and re-hit that endpoint — on every single app
 * launch, and a normally-active user reopening the app more than a
 * handful of times a day would exhaust the budget on routine opens alone,
 * before a real match ever got the chance to run.
 */
export function createStorage(adapter: ReferralStorageAdapter): ReferralStorage {
  return {
    async isProcessed(): Promise<boolean> {
      return (await adapter.getItem(PROCESSED_KEY)) === '1';
    },

    async markProcessed(): Promise<void> {
      await adapter.setItem(PROCESSED_KEY, '1');
    },

    async reset(): Promise<void> {
      await adapter.removeItem(PROCESSED_KEY);
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
