export type MatchMethod = 'install_referrer' | 'fingerprint';
export type MobilePlatform = 'ios' | 'android';

/**
 * The smallest possible persistence contract — a key/value store with async
 * get/set/remove. AsyncStorage satisfies this natively; wrapping MMKV,
 * SQLite, Keychain, or anything else is a few lines (MMKV's API is
 * synchronous, so its adapter just wraps each call in `Promise.resolve`).
 * Matches the shape `redux-persist` uses for the same reason: it lets a
 * project bring whatever storage engine it already has instead of this SDK
 * forcing a second one into the app.
 */
export interface ReferralStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ReferralConfig {
  /**
   * Base URL of the referral backend. Defaults to the production endpoint
   * (https://referral-sdk-node.vercel.app/api) — only set this to point at a
   * staging/local backend instead.
   */
  apiEndpoint?: string;
  /** Custom URL scheme without "://", used for deep-link handling. */
  appScheme?: string;
  /** Match window in ms (informational; the server enforces its own). */
  matchWindow?: number;
  /** Minimum confidence the app will accept (informational; server enforces). */
  minConfidence?: number;
  /** Max ms to wait for the match request before giving up. */
  matchTimeoutMs?: number;
  /**
   * Where the recovered code and "already processed" flag are persisted.
   * Defaults to a lazily-loaded `@react-native-async-storage/async-storage`
   * adapter if omitted — pass your own to use MMKV, SQLite, etc. instead and
   * skip installing AsyncStorage entirely. See ReferralStorageAdapter.
   */
  storageAdapter?: ReferralStorageAdapter;
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
  claim: (userId: string) => Promise<ClaimResult>;
}
