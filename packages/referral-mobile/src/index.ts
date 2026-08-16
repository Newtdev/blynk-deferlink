export { ReferralProvider } from './ReferralProvider';
export type { ReferralProviderProps } from './ReferralProvider';

export { useReferralCode } from './useReferralCode';
export { ReferralService } from './ReferralService';
export type { RecoveryOutcome } from './ReferralService';

export { collectFingerprint } from './fingerprint';
export { DEFAULT_API_ENDPOINT } from './api';
export { readInstallReferrer } from './platform/android';
export { createStorage, defaultAsyncStorageAdapter } from './storage';
export type { ReferralStorage } from './storage';

export type {
  ReferralConfig,
  ReferralResult,
  ReferralStorageAdapter,
  DeviceFingerprint,
  MatchResponse,
  MatchMethod,
  MobilePlatform,
  ClaimResult,
} from './types';
