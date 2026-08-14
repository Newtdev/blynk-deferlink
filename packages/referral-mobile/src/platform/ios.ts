import type { DeviceFingerprint } from '../types';

/**
 * iOS has no Install Referrer equivalent, so recovery is fingerprint-only.
 * The App Store strips any parameters, meaning we rely entirely on matching
 * the device signature against the click stored when the user tapped the link.
 */
export async function recoverIos(
  fingerprint: DeviceFingerprint,
  matchViaFingerprint: (fp: DeviceFingerprint) => Promise<string | null>,
): Promise<{ code: string | null; method: 'fingerprint' }> {
  const code = await matchViaFingerprint(fingerprint);
  return { code, method: 'fingerprint' };
}
