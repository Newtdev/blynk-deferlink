// Provider + config
export { ReferralProvider, useReferralConfig } from './ReferralProvider';
export type { ReferralProviderProps } from './ReferralProvider';

// Pre-built landing page
export { ReferralLanding } from './ReferralLanding';
export type { ReferralLandingProps } from './ReferralLanding';

// Hooks (for custom UIs)
export { useFingerprint } from './hooks/useFingerprint';
export { usePlatformDetect } from './hooks/usePlatformDetect';
export type { PlatformInfo } from './hooks/usePlatformDetect';
export { useReferralClick } from './hooks/useReferralClick';
export type { UseReferralClickResult } from './hooks/useReferralClick';

// Components
export { StoreButton } from './components/StoreButton';
export type { StoreButtonProps } from './components/StoreButton';
export { CountdownRedirect } from './components/CountdownRedirect';
export type { CountdownRedirectProps } from './components/CountdownRedirect';
export { InAppBrowserNotice } from './components/InAppBrowserNotice';
export type { InAppBrowserNoticeProps } from './components/InAppBrowserNotice';

// Utils
export {
  detectPlatform,
  detectBrowser,
  isInAppBrowser,
} from './utils/platformDetect';
export { getStoreUrl, getAppSchemeUrl } from './utils/storeUrls';
export { writeClipboardReferral } from './utils/clipboardHandoff';
export { buildReferralMeta } from './utils/og';
export type { ReferralMetaInput, OpenGraphMeta } from './utils/og';

// Types
export type {
  Platform,
  Browser,
  FingerprintData,
  ReferralConfig,
  ClickResponse,
  ReferralTheme,
} from './types';
