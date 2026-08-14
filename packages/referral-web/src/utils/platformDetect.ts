import type { Browser, Platform } from '../types';

/** Detect OS family from a user-agent string. Pure — safe for SSR/tests. */
export function detectPlatform(ua: string): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/** Detect the embedding in-app browser, if any. */
export function detectBrowser(ua: string): Browser {
  if (/WhatsApp/i.test(ua)) return 'whatsapp';
  if (/Instagram/i.test(ua)) return 'instagram';
  // FBAN/FBAV cover the Facebook + Messenger in-app webviews.
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook';
  if (/Twitter/i.test(ua)) return 'twitter';
  if (/LinkedInApp/i.test(ua)) return 'linkedin';
  return 'native';
}

export function isInAppBrowser(ua: string): boolean {
  return detectBrowser(ua) !== 'native';
}
