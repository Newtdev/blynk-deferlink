import type {
  ClaimResult,
  DeviceFingerprint,
  MatchMethod,
  MatchResponse,
  MobilePlatform,
  ReferralConfig,
} from './types';

async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Production backend — used whenever a project doesn't override apiEndpoint. */
export const DEFAULT_API_ENDPOINT = 'https://referral-sdk-node.vercel.app/api';

export function createApi(config: ReferralConfig) {
  const base = (config.apiEndpoint ?? DEFAULT_API_ENDPOINT).replace(/\/$/, '');
  const timeout = config.matchTimeoutMs ?? 5000;

  return {
    /**
     * POST /referral/match — probabilistic fingerprint recovery (iOS, or
     * Android's fallback when the Install Referrer is empty). Android's
     * primary path and iOS's clipboard tier never call this at all — both
     * already have a token, read locally off the referrer/clipboard, with
     * nothing to redeem until /claim. See docs/decisions.md #22.
     */
    async match(fingerprint: DeviceFingerprint): Promise<MatchResponse> {
      return postJson<MatchResponse>(
        `${base}/referral/match`,
        {
          device_id: fingerprint.device_id,
          platform: fingerprint.platform,
          fingerprint: {
            user_agent: '',
            device_model: fingerprint.device_model,
            screen_width: fingerprint.screen_width,
            screen_height: fingerprint.screen_height,
            timezone: fingerprint.timezone,
            language: fingerprint.language,
          },
        },
        timeout,
      );
    },

    /**
     * POST /referral/claim — record the conversion after signup. `token`
     * is the entire proof (see support/clickToken.ts on the backend) — the
     * server verifies it and either confirms an existing lock (fingerprint
     * path) or makes one for the first time right here (deterministic
     * path, redeemed for real for the first time at this exact call).
     * `method` is only read in that second case — a labeling detail, not a
     * security check either way. See docs/decisions.md #21/#22.
     */
    async claim(params: {
      deviceId: string;
      platform: MobilePlatform;
      token: string;
      method?: MatchMethod;
      userId: string;
    }): Promise<ClaimResult> {
      return postJson<ClaimResult>(
        `${base}/referral/claim`,
        {
          device_id: params.deviceId,
          platform: params.platform,
          token: params.token,
          method: params.method,
          user_id: params.userId,
        },
        timeout,
      );
    },
  };
}

export type ReferralApi = ReturnType<typeof createApi>;
