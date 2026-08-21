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
     * Android's fallback when the Install Referrer is empty). `method` is
     * implicit server-side ('fingerprint') whenever no click_id is sent —
     * see `redeem()` for the deterministic counterpart.
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
     * POST /referral/match — deterministic redeem: the caller already has a
     * click_id (Android install referrer, iOS clipboard payload), so this
     * skips fingerprint scoring server-side entirely and goes straight to a
     * lookup + lock. See docs/decisions.md #21.
     */
    async redeem(
      deviceId: string,
      platform: MobilePlatform,
      clickId: string,
      method: Extract<MatchMethod, 'install_referrer' | 'clipboard'>,
    ): Promise<MatchResponse> {
      return postJson<MatchResponse>(
        `${base}/referral/match`,
        { device_id: deviceId, platform, click_id: clickId, method },
        timeout,
      );
    },

    /**
     * POST /referral/claim — record the conversion after signup. `clickId`
     * must reference a click already locked to `deviceId` (by `match()` or
     * `redeem()`) — the server verifies this itself now rather than trusting
     * whatever this call says happened, so `method`/`confidence` are no
     * longer sent here at all. See docs/decisions.md #21.
     */
    async claim(params: {
      referralCode: string;
      deviceId: string;
      platform: MobilePlatform;
      clickId: string;
      userId: string;
    }): Promise<ClaimResult> {
      return postJson<ClaimResult>(
        `${base}/referral/claim`,
        {
          referral_code: params.referralCode,
          device_id: params.deviceId,
          platform: params.platform,
          click_id: params.clickId,
          user_id: params.userId,
        },
        timeout,
      );
    },
  };
}

export type ReferralApi = ReturnType<typeof createApi>;
