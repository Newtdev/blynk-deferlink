import type { DeviceFingerprint, RecoveryOutcome } from '../types';

/**
 * iOS has no Install Referrer equivalent, so *automatic* recovery is
 * fingerprint-only. The App Store strips any parameters, meaning matching
 * relies entirely on the device signature against the click stored when the
 * user tapped the link. (The clipboard tier is deterministic too, but it's
 * user-triggered via ReferralPasteButton, not part of this automatic path —
 * see ReferralService.applyClipboardCode.)
 */
export async function recoverIos(
  fingerprint: DeviceFingerprint,
  matchViaFingerprint: (fp: DeviceFingerprint) => Promise<RecoveryOutcome>,
): Promise<RecoveryOutcome> {
  return matchViaFingerprint(fingerprint);
}
