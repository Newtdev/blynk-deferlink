import type { DeviceFingerprint, MatchMethod, RecoveryOutcome } from '../types';

/**
 * Reads the Google Play Install Referrer and extracts the referral code
 * and its signed token (embedded alongside the code by the web landing
 * page — see storeUrls.ts). This is deterministic (~100%) and requires no
 * network — Google hands the `referrer` string set on the store URL
 * directly to the app after install, and the token is read straight out
 * of it, not verified or redeemed here. That reliability is why it's
 * required on Android rather than optional: fingerprint matching is
 * probabilistic (see fingerprintMatcher.ts's scoring and its recency/IP
 * tradeoffs) and install-referrer sidesteps all of it — see
 * docs/decisions.md #22 for why recovery itself never touches the network.
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
export async function readInstallReferrer(): Promise<{ code: string; token: string | null } | null> {
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

    // referrer looks like "utm_source=referral&code=1234&token=uuid.exp.hmac"
    const params = new URLSearchParams(referrer);
    const code = params.get('code');
    if (!code || code.trim() === '') return null;

    const rawToken = params.get('token');
    const token = rawToken && rawToken.trim() !== '' ? rawToken : null;
    return { code, token };
  } catch {
    return null;
  }
}

const METHOD: MatchMethod = 'install_referrer';

export async function recoverAndroid(
  fingerprint: DeviceFingerprint,
  matchViaFingerprint: (fp: DeviceFingerprint) => Promise<RecoveryOutcome>,
): Promise<RecoveryOutcome> {
  const referrer = await readInstallReferrer();

  // No network call here at all — the token is carried, not verified. A
  // code with no token (older web SDK version on the landing page, or a
  // truncated param) can never be claimed anyway, so it's treated the same
  // as no code: fall through to fingerprint matching, which can produce a
  // real one via /match.
  if (referrer?.code && referrer.token) {
    return { code: referrer.code, method: METHOD, confidence: null, token: referrer.token };
  }

  return matchViaFingerprint(fingerprint);
}
