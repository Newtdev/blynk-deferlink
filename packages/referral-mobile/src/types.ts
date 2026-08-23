export type MatchMethod = 'install_referrer' | 'fingerprint' | 'clipboard';
export type MobilePlatform = 'ios' | 'android';

export interface ReferralConfig {
  /**
   * Base URL of your referral backend (e.g. "https://your-app.example.com/api").
   * Required — there's no default. See docs/integration/referral-sdk.md or
   * referral-sdk-node.md to set one up.
   */
  apiEndpoint: string;
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
  click_id?: string;
  /**
   * Signed proof this click is real and unexpired — required to /claim
   * afterward, since /claim now verifies it instead of trusting the claim
   * request alone. Purely opaque to this SDK: never decoded, just carried
   * through to /claim. See docs/decisions.md #21/#22.
   */
  token?: string;
  confidence?: number;
  match_method?: MatchMethod;
}

export interface ClaimResult {
  success: boolean;
  reward?: { type: string; amount: number } | null;
  error?: string;
}

/**
 * The result of one recovery attempt, however it happened. `token` is
 * required to /claim afterward (see MatchResponse) — a `code` with no
 * `token` can never actually be claimed, so ReferralService treats that
 * combination as equivalent to no code at all rather than a partial result.
 */
export interface RecoveryOutcome {
  code: string | null;
  method: MatchMethod | null;
  confidence: number | null;
  token: string | null;
}

export interface ReferralResult {
  code: string | null;
  method: MatchMethod | null;
  confidence: number | null;
  loading: boolean;
  error: Error | null;
  /**
   * Records the conversion after signup. Claims whatever `code` this same
   * hook call recovered — there's no way to claim a code recovered in an
   * earlier session anymore, even if the app stored it itself: /claim now
   * requires a signed `token` proving a click was actually made (see
   * docs/decisions.md #21/#22), and the SDK persists nothing to disk, so a
   * fresh session has no legitimate token to offer for anything it didn't
   * just recover itself.
   */
  claim: (userId: string) => Promise<ClaimResult>;
  /**
   * Wire this to `<ReferralPasteButton onCode={onClipboardCode} />` on iOS
   * — applies a deterministically-recovered code, overriding whatever the
   * automatic fingerprint path already found. `token` comes straight from
   * the same clipboard payload; pass it through unchanged.
   */
  onClipboardCode: (code: string, token: string | null) => void;
}
