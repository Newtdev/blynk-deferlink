export { ReferralProvider } from './ReferralProvider';
export type { ReferralProviderProps } from './ReferralProvider';

export { useReferralCode } from './useReferralCode';
export { ReferralService } from './ReferralService';

export { collectFingerprint } from './fingerprint';
export { DEFAULT_API_ENDPOINT } from './api';
export { readInstallReferrer } from './platform/android';

export { ReferralPasteButton } from './ReferralPasteButton';
export type {
  ReferralPasteButtonProps,
  ReferralPasteButtonCornerStyle,
  ReferralPasteButtonDisplayMode,
} from './ReferralPasteButton';
export { parseClipboardReferralPayload } from './platform/clipboardPayload';
export type { ParsedClipboardReferral } from './platform/clipboardPayload';

export type {
  ReferralConfig,
  ReferralResult,
  DeviceFingerprint,
  MatchResponse,
  MatchMethod,
  MobilePlatform,
  ClaimResult,
  RecoveryOutcome,
} from './types';
