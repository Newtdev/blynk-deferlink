import type { DeviceFingerprint } from '../types';

/**
 * Reads the Google Play Install Referrer and extracts the referral code.
 * This is deterministic (~100%) and requires no network — Google hands the
 * `referrer` string set on the store URL directly to the app after install.
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
 * The native module is an optional peer dependency, so it's required
 * lazily; if it's absent we return null and the caller falls back to
 * fingerprinting.
 */
export async function readInstallReferrer(): Promise<string | null> {
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
    return null;
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

    // referrer looks like "utm_source=referral&code=1234"
    const params = new URLSearchParams(referrer);
    const code = params.get('code');
    return code && code.trim() !== '' ? code : null;
  } catch {
    return null;
  }
}

export async function recoverAndroid(
  fingerprint: DeviceFingerprint,
  matchViaFingerprint: (fp: DeviceFingerprint) => Promise<string | null>,
): Promise<{ code: string | null; method: 'install_referrer' | 'fingerprint' }> {
  const referrerCode = await readInstallReferrer();
  if (referrerCode) {
    return { code: referrerCode, method: 'install_referrer' };
  }

  // Empty referrer (e.g. sideload, or code wasn't in the store URL) → fall back.
  const code = await matchViaFingerprint(fingerprint);
  return { code, method: 'fingerprint' };
}
