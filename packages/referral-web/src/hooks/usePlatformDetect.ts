import { useMemo } from 'react';
import type { Browser, Platform } from '../types';
import { detectBrowser, detectPlatform } from '../utils/platformDetect';

export interface PlatformInfo {
  platform: Platform;
  browser: Browser;
  isInAppBrowser: boolean;
}

/** Detects platform + in-app browser once per render tree. */
export function usePlatformDetect(): PlatformInfo {
  return useMemo(() => {
    const ua =
      typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const browser = detectBrowser(ua);
    return {
      platform: detectPlatform(ua),
      browser,
      isInAppBrowser: browser !== 'native',
    };
  }, []);
}
