import type { Platform, ReferralConfig } from '../types';

/**
 * Build the store URL for a platform. On Android the referral code is embedded
 * in the Play Store `referrer` param, which the Install Referrer API surfaces
 * to the app post-install. iOS has no such channel — recovery there relies on
 * fingerprint matching.
 *
 * `androidStoreUrl`/`iosStoreUrl` let a project paste its real store listing
 * URL directly instead of having one composed from androidPackage/iosAppId
 * (useful when the listing id differs from the app's package name, or for a
 * non-standard/regional store URL). The referrer param is still merged into
 * androidStoreUrl automatically — it's load-bearing for the deferred-link
 * mechanism itself, not just cosmetic, so skipping it would silently break
 * Android code recovery even though the link still looks fine.
 */
export function getStoreUrl(
  platform: Platform,
  code: string,
  config: ReferralConfig,
  /**
   * Signed proof the click behind this redirect is real, if registration
   * completed in time — embedded into the referrer param, read purely
   * locally by the app (no network call), and only sent back to the
   * server once, at /claim. /claim now requires it — this is how
   * Android's Install Referrer path gets one, for free, with no redeem
   * round-trip. Omit (or pass null) when registration hasn't resolved
   * yet — the app falls back to fingerprint matching exactly like it
   * always has for a missing token, so this is additive, not required,
   * for the redirect itself. See docs/decisions.md #21/#22.
   */
  token?: string | null,
): string {
  if (platform === 'android') {
    const utm = config.utmSource ?? 'referral';
    // URLSearchParams (not a template literal) so `code`/`token` are
    // correctly escaped inside the referrer string itself — this whole
    // string gets parsed again as its own query string by the Play Install
    // Referrer Library on the app side, so an unescaped `&` or `=` inside a
    // value would silently corrupt that second parse.
    const referrerParams = new URLSearchParams({ utm_source: utm, code });
    if (token) referrerParams.set('token', token);
    const base = config.androidStoreUrl
      ? new URL(config.androidStoreUrl)
      : new URL(`https://play.google.com/store/apps/details?id=${config.androidPackage}`);
    base.searchParams.set('referrer', referrerParams.toString());
    return base.toString();
  }
  return config.iosStoreUrl ?? `https://apps.apple.com/app/id${config.iosAppId}`;
}

/** Deep link that opens the app directly when it's already installed. */
export function getAppSchemeUrl(code: string, config: ReferralConfig): string {
  return `${config.appScheme}://referral?code=${encodeURIComponent(code)}`;
}
