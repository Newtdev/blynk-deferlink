import { useCallback } from 'react';
import type { FingerprintData } from '../types';

/**
 * Collects a browser fingerprint. All fields are read at call time so the same
 * hook works whether it's invoked on mount or on a user action.
 */
export function useFingerprint() {
  const collect = useCallback((): FingerprintData => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      // SSR guard — real values are only available in the browser.
      return {
        user_agent: '',
        screen_width: 0,
        screen_height: 0,
        pixel_ratio: 1,
        timezone: '',
        language: '',
        platform: '',
        referrer: '',
      };
    }

    let timezone = '';
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      timezone = '';
    }

    return {
      user_agent: navigator.userAgent,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      pixel_ratio: window.devicePixelRatio || 1,
      timezone,
      language: navigator.language,
      platform: navigator.platform,
      referrer: document.referrer,
    };
  }, []);

  return { collect };
}
