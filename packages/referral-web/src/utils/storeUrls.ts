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
): string {
  if (platform === 'android') {
    const utm = config.utmSource ?? 'referral';
    const referrer = `utm_source=${utm}&code=${code}`;
    const base = config.androidStoreUrl
      ? new URL(config.androidStoreUrl)
      : new URL(`https://play.google.com/store/apps/details?id=${config.androidPackage}`);
    base.searchParams.set('referrer', referrer);
    return base.toString();
  }
  return config.iosStoreUrl ?? `https://apps.apple.com/app/id${config.iosAppId}`;
}

/** Deep link that opens the app directly when it's already installed. */
export function getAppSchemeUrl(code: string, config: ReferralConfig): string {
  return `${config.appScheme}://referral?code=${encodeURIComponent(code)}`;
}
