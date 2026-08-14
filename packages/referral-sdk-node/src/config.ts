/**
 * Mirrors packages/referral-sdk/src/Support/ReferralConfig.php field-for-field
 * (same defaults, same keys in snake_case at the boundary) so a project can
 * swap between the PHP and Node backends by porting this one config object.
 */
export interface ScoringWeights {
  ip_match: number;
  device_model: number;
  screen_dimensions: number;
  timezone: number;
  language: number;
}

export interface RewardsConfig {
  enabled: boolean;
  referrer_reward: number;
  referee_reward: number;
  reward_type: 'credit' | 'points' | 'custom';
  /** Called after a successful claim, e.g. to credit accounts in your own DB. */
  on_claim_callback?: (
    referralCode: string,
    userId: string | null,
    rewards: RewardsConfig,
  ) => void | Promise<void>;
}

export interface ReferralConfigInput {
  match_window_hours?: number;
  min_confidence?: number;
  rate_limit_clicks_per_hour?: number;
  rate_limit_matches_per_day?: number;
  hash_device_ids?: boolean;
  scoring?: Partial<ScoringWeights>;
  rewards?: Partial<RewardsConfig>;
  /**
   * Validates an incoming referral code before a click/claim is stored.
   * Leave unset to accept any non-empty code (development only — configure
   * a real validator, e.g. a DB lookup, before going to production).
   */
  code_validator?: (code: string) => boolean | Promise<boolean>;
}

export class ReferralConfig {
  readonly matchWindowHours: number;
  readonly minConfidence: number;
  readonly rateLimitClicksPerHour: number;
  readonly rateLimitMatchesPerDay: number;
  readonly hashDeviceIds: boolean;
  readonly scoring: ScoringWeights;
  readonly rewards: RewardsConfig;
  readonly codeValidator?: (code: string) => boolean | Promise<boolean>;

  constructor(c: ReferralConfigInput = {}) {
    this.matchWindowHours = c.match_window_hours ?? 48;
    this.minConfidence = c.min_confidence ?? 70;
    this.rateLimitClicksPerHour = c.rate_limit_clicks_per_hour ?? 10;
    this.rateLimitMatchesPerDay = c.rate_limit_matches_per_day ?? 5;
    this.hashDeviceIds = c.hash_device_ids ?? true;

    this.scoring = {
      ip_match: c.scoring?.ip_match ?? 40,
      device_model: c.scoring?.device_model ?? 25,
      screen_dimensions: c.scoring?.screen_dimensions ?? 15,
      timezone: c.scoring?.timezone ?? 10,
      language: c.scoring?.language ?? 10,
    };

    this.rewards = {
      enabled: c.rewards?.enabled ?? true,
      referrer_reward: c.rewards?.referrer_reward ?? 500,
      referee_reward: c.rewards?.referee_reward ?? 500,
      reward_type: c.rewards?.reward_type ?? 'credit',
      on_claim_callback: c.rewards?.on_claim_callback,
    };

    this.codeValidator = c.code_validator;
  }

  matchWindowSeconds(): number {
    return this.matchWindowHours * 3600;
  }
}
