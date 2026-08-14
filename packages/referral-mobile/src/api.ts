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
  const base = config.apiEndpoint.replace(/\/$/, '');
  const timeout = config.matchTimeoutMs ?? 5000;

  return {
    /** POST /referral/match — fingerprint recovery (iOS + Android fallback). */
    async match(fingerprint: DeviceFingerprint): Promise<MatchResponse> {
      return postJson<MatchResponse>(
        `${base}/referral/match`,
        {
          device_id: fingerprint.device_id,
          platform: fingerprint.platform,
          method: 'fingerprint',
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

    /** POST /referral/claim — record the conversion after signup. */
    async claim(params: {
      referralCode: string;
      deviceId: string;
      platform: MobilePlatform;
      method: MatchMethod;
      userId: string;
      confidence?: number | null;
    }): Promise<ClaimResult> {
      return postJson<ClaimResult>(
        `${base}/referral/claim`,
        {
          referral_code: params.referralCode,
          device_id: params.deviceId,
          platform: params.platform,
          method: params.method,
          user_id: params.userId,
          confidence: params.confidence ?? undefined,
        },
        timeout,
      );
    },
  };
}

export type ReferralApi = ReturnType<typeof createApi>;
