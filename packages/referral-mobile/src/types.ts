export type MatchMethod = 'install_referrer' | 'fingerprint' | 'clipboard';
export type MobilePlatform = 'ios' | 'android';

export interface ReferralConfig {
  /**
   * Base URL of the referral backend. Defaults to the production endpoint
   * (https://referral-sdk-node.vercel.app/api) — only set this to point at a
   * staging/local backend instead.
   */
  apiEndpoint?: string;
  /** Custom URL scheme without "://", used for deep-link handling. */
  appScheme?: string;
  /**
   * Match window in ms. Mostly informational — the server enforces its
   * own window regardless — but it is one real thing: it's reused as the
   * staleness cutoff for clipboard-based iOS recovery (ReferralPasteButton),
   * since the mobile SDK has no other way to know what window the backend
   * was actually configured with. Set this to match your backend's
   * min_confidence/match_window_hours config if you've customized it away
   * from the 48h default.
   */
  matchWindow?: number;
  /** Minimum confidence the app will accept (informational; server enforces). */
  minConfidence?: number;
  /** Max ms to wait for the match request before giving up. */
  matchTimeoutMs?: number;
  /** Called as soon as a code is recovered by any method. */
  onCodeFound?: (code: string, method: MatchMethod) => void;
  /** Called when no code could be recovered. */
  onNoCode?: () => void;
}

export interface DeviceFingerprint {
  device_id: string;
  platform: MobilePlatform;
  device_model: string;
  system_version: string;
  screen_width: number;
  screen_height: number;
  timezone: string;
  language: string;
}

export interface MatchResponse {
  matched: boolean;
  referral_code: string | null;
  confidence?: number;
  match_method?: MatchMethod;
}

export interface ClaimResult {
  success: boolean;
  reward?: { type: string; amount: number } | null;
  error?: string;
}

export interface ReferralResult {
  code: string | null;
  method: MatchMethod | null;
  confidence: number | null;
  loading: boolean;
  error: Error | null;
  /**
   * Records the conversion after signup. Call with just `userId` for the
   * common case (claiming the `code` this same hook call just recovered).
   * Pass `code` explicitly only if the app is claiming a code it recovered
   * and stored itself in an *earlier* session — the SDK persists nothing
   * to disk at all, so a fresh app launch has no memory of a previous
   * recovery unless the app kept it.
   */
  claim: (userId: string, code?: string) => Promise<ClaimResult>;
  /**
   * Wire this to `<ReferralPasteButton onCode={onClipboardCode} />` on iOS
   * — applies a deterministically-recovered code, overriding whatever the
   * automatic fingerprint path already found.
   */
  onClipboardCode: (code: string) => void;
}
