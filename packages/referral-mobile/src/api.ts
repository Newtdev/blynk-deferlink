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

export function createApi(config: ReferralConfig) {
  // Required, not optional, and no built-in default — this SDK ships with no
  // backend of its own to fall back to. An earlier version defaulted this to
  // a specific deployment's URL, which meant any consumer who forgot to set
  // it would silently send real device data to somebody else's production
  // backend instead of getting a clear error. Fail loudly here instead.
  if (!config.apiEndpoint) {
    throw new Error(
      'apiEndpoint is required in ReferralConfig — point it at your own backend ' +
        "(e.g. https://your-app.example.com/api). There's no default; see " +
        'docs/integration/referral-sdk.md or referral-sdk-node.md for setting one up.',
    );
  }
  const base = config.apiEndpoint.replace(/\/$/, '');
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
