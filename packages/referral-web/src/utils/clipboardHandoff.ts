/**
 * The deterministic iOS recovery tier: hands the referral code to the app
 * via the system clipboard, written right before redirecting to the App
 * Store. Same physical device, same moment — no network signal to drift,
 * unlike fingerprint matching. See docs/ios-deterministic-deferred-deep-linking.md
 * for the full design.
 *
 * A self-validating, prefixed string rather than raw JSON, so a stray
 * clipboard value (a password, a copied link from somewhere unrelated)
 * can't be mistaken for a match on the reading side.
 */

const CLIPBOARD_PREFIX = 'sparkle_ref:v1:';

/**
 * Writes `sparkle_ref:v1:<code>:<issued_unix_ts>` to the clipboard. The
 * timestamp lets the app reject a stale payload without a network round
 * trip — see the mobile SDK's staleness check.
 *
 * Best-effort only, deliberately: clipboard access can be blocked (in-app
 * browsers like WhatsApp/Instagram commonly restrict or fully disable it,
 * non-secure contexts, permissions) and this is one tier of several —
 * fingerprint matching remains the fallback either way, so a failure here
 * is swallowed rather than surfaced as an error to the caller.
 */
export async function writeClipboardReferral(code: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;

  const payload = `${CLIPBOARD_PREFIX}${code}:${Math.floor(Date.now() / 1000)}`;

  try {
    await navigator.clipboard.writeText(payload);
  } catch (err) {
    console.warn(
      'Referral clipboard handoff failed (likely a restricted browser context); falling back to fingerprint matching on the app side.',
      err,
    );
  }
}
