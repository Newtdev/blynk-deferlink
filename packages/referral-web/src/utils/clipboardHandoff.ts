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

const CLIPBOARD_PREFIX = 'deferlink_ref:v1:';

/**
 * Writes `deferlink_ref:v1:<code>:<issued_unix_ts>` (or
 * `deferlink_ref:v1:<code>:<issued_unix_ts>:<token>` when the click has
 * registered in time) to the clipboard. The timestamp lets the app reject a
 * stale payload without a network round trip — see the mobile SDK's
 * staleness check. `token`, when present, is the signed proof the click is
 * real and unexpired — read purely locally by the app, no network call,
 * only sent back to the server once, at /claim. /claim now requires it —
 * this is how the clipboard tier gets one, for free, with no redeem
 * round-trip. Omit it (or pass null) if registration hasn't resolved yet —
 * the app falls back to fingerprint matching exactly like a missing token
 * always has. See docs/decisions.md #21/#22.
 *
 * Best-effort only, deliberately: clipboard access can be blocked (in-app
 * browsers like WhatsApp/Instagram commonly restrict or fully disable it,
 * non-secure contexts, permissions) and this is one tier of several —
 * fingerprint matching remains the fallback either way, so a failure here
 * is swallowed rather than surfaced as an error to the caller.
 */
export async function writeClipboardReferral(code: string, token?: string | null): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;

  const parts = [code, String(Math.floor(Date.now() / 1000))];
  if (token) parts.push(token);
  const payload = `${CLIPBOARD_PREFIX}${parts.join(':')}`;

  try {
    await navigator.clipboard.writeText(payload);
  } catch (err) {
    console.warn(
      'Referral clipboard handoff failed (likely a restricted browser context); falling back to fingerprint matching on the app side.',
      err,
    );
  }
}
