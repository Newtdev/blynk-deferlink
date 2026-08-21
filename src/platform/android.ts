import type { DeviceFingerprint, RecoveryOutcome } from '../types';

/**
 * Reads the Google Play Install Referrer and extracts the referral code
 * (and, when the landing page's click registration completed in time, the
 * click_id it embedded alongside the code — see storeUrls.ts on the web
 * SDK). This is deterministic (~100%) and requires no network — Google
 * hands the `referrer` string set on the store URL directly to the app
 * after install. That reliability is why it's required on Android rather
 * than optional: fingerprint matching is probabilistic (see
 * fingerprintMatcher.ts's scoring and its recency/IP tradeoffs) and
 * install-referrer sidesteps all of it.
 *
 * Backed by `react-native-play-install-referrer` — a real, published wrapper
 * around Google's Play Install Referrer Library (named export
 * `PlayInstallReferrer`, callback-based API). An earlier version of this
 * file was written against `react-native-android-install-referrer`, which
 * does not exist on the npm registry at all (confirmed 404) — that name
 * appears throughout the original project spec, but nothing by that name
 * was ever published, so the install-referrer path could never actually run
 * for a real consumer; it always silently failed and fell back to
 * fingerprinting. This is the real package.
 *
 * The native module is a required peer dependency (Android only — an iOS-
 * only consumer never reaches this function). If it isn't installed, that's
 * a setup mistake worth failing loudly on rather than silently degrading to
 * the weaker fingerprint path.
 */
export async function readInstallReferrer(): Promise<{ code: string; clickId: string | null } | null> {
  let PlayInstallReferrer: {
    getInstallReferrerInfo: (
      callback: (
        info: { installReferrer?: string } | null,
        error: { message?: string } | null,
      ) => void,
    ) => void;
  } | null = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    PlayInstallReferrer = require('react-native-play-install-referrer').PlayInstallReferrer;
  } catch {
    throw new Error(
      'react-native-play-install-referrer is required on Android but is not ' +
        "installed. Run `npm install react-native-play-install-referrer` and " +
        '`cd android && ./gradlew clean` (or rebuild) — it is a required peer ' +
        'dependency, not optional, because it is the deterministic recovery ' +
        'path Android relies on to keep match confidence reliable. See the ' +
        '@sparkle/referral-mobile README.',
    );
  }

  if (!PlayInstallReferrer) return null;

  try {
    const info = await new Promise<{ installReferrer?: string } | null>((resolve) => {
      PlayInstallReferrer!.getInstallReferrerInfo((info, error) => {
        resolve(error ? null : info);
      });
    });

    const referrer = info?.installReferrer ?? '';
    if (!referrer) return null;

    // referrer looks like "utm_source=referral&code=1234&click_id=uuid"
    const params = new URLSearchParams(referrer);
    const code = params.get('code');
    if (!code || code.trim() === '') return null;

    const rawClickId = params.get('click_id');
    const clickId = rawClickId && rawClickId.trim() !== '' ? rawClickId : null;
    return { code, clickId };
  } catch {
    return null;
  }
}

export async function recoverAndroid(
  fingerprint: DeviceFingerprint,
  matchViaFingerprint: (fp: DeviceFingerprint) => Promise<RecoveryOutcome>,
  /**
   * Redeems a click_id deterministically via /match's fast-path — locks it
   * to this device server-side, which /claim now requires (see
   * docs/decisions.md #21). Returns a null-code outcome if the redeem
   * fails (expired, already matched elsewhere, network error).
   */
  redeemDeterministic: (clickId: string) => Promise<RecoveryOutcome>,
): Promise<RecoveryOutcome> {
  const referrer = await readInstallReferrer();

  if (referrer?.clickId) {
    const redeemed = await redeemDeterministic(referrer.clickId);
    if (redeemed.code) return redeemed;
    // Redeem failed — fall through to fingerprint matching rather than
    // trusting the referrer's code with no server-side lock, which /claim
    // would reject anyway.
  }
  // No click_id at all (older web SDK version on the landing page, a
  // truncated param, sideload, or no referrer) falls through the same way
  // — a bare code with nothing to redeem can never be claimed either.

  return matchViaFingerprint(fingerprint);
}
