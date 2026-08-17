export type Platform = 'ios' | 'android' | 'desktop';

export type Browser =
  | 'native'
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'linkedin'
  | 'other-inapp';

export interface FingerprintData {
  user_agent: string;
  screen_width: number;
  screen_height: number;
  pixel_ratio: number;
  timezone: string;
  language: string;
  platform: string;
  /** document.referrer — the page that linked here (e.g. a WhatsApp redirect). */
  referrer: string;
}

export interface ReferralConfig {
  /** Base URL of the PHP backend, e.g. "https://referal.sparkle.ng/api". */
  apiEndpoint: string;
  /** Custom URL scheme WITHOUT the "://", e.g. "sparkleapp". */
  appScheme: string;
  /** Android application id, e.g. "com.sparkle.app". Ignored if androidStoreUrl is set. */
  androidPackage: string;
  /**
   * Numeric App Store id, e.g. "123456789". Ignored if iosStoreUrl is set.
   * Composes into a bare `apps.apple.com/app/id<id>` URL with no region —
   * set iosStoreUrl instead for production, see its doc below.
   */
  iosAppId: string;
  /**
   * Full Play Store URL to use as-is instead of composing one from
   * androidPackage, e.g. when your listing lives under a different id than
   * your app's package name. The referrer param (which carries the referral
   * code through install — see getStoreUrl) is still merged in automatically.
   */
  androidStoreUrl?: string;
  /**
   * Full App Store URL to use as-is instead of composing one from iosAppId.
   * Used verbatim — iOS has no install-referrer mechanism to merge a param
   * into, so there's nothing this needs to add.
   *
   * Set this explicitly in production rather than relying on iosAppId's
   * bare fallback (`apps.apple.com/app/id<id>`, no region segment) — a
   * region-less link is the kind most likely to trigger the App Store's
   * "This app may not be available in your language" interstitial, seen in
   * real-device testing. Use the full canonical shape instead, with your
   * primary market's country code:
   *   https://apps.apple.com/<country>/app/<your-app-slug>/id<iosAppId>
   */
  iosStoreUrl?: string;
  /** ms to wait for the app to open before falling back to the store. */
  appOpenTimeout?: number;
  /** utm_source value baked into the Android install referrer. */
  utmSource?: string;
}

export interface ClickResponse {
  success: boolean;
  click_id?: string;
  error?: string;
}

export interface ReferralTheme {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  mutedColor?: string;
  radius?: string;
  fontFamily?: string;
}
