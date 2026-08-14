import { Dimensions, NativeModules, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import type { DeviceFingerprint, MobilePlatform } from './types';

function detectLanguage(): string {
  // DeviceInfo.getDeviceLocale isn't on every version; fall back to native modules.
  const anyDevice = DeviceInfo as unknown as {
    getDeviceLocale?: () => string;
  };
  if (typeof anyDevice.getDeviceLocale === 'function') {
    try {
      return anyDevice.getDeviceLocale();
    } catch {
      /* ignore */
    }
  }

  if (Platform.OS === 'ios') {
    const settings = NativeModules.SettingsManager?.settings;
    return (
      settings?.AppleLocale ??
      settings?.AppleLanguages?.[0] ??
      'en'
    );
  }
  return NativeModules.I18nManager?.localeIdentifier ?? 'en';
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * Collect the native device fingerprint. Screen dimensions are read in points
 * matching how the web landing page reads them, so the server can compare like
 * for like. The IP is added server-side from the request.
 */
export async function collectFingerprint(): Promise<DeviceFingerprint> {
  const { width, height } = Dimensions.get('screen');

  return {
    device_id: await DeviceInfo.getUniqueId(),
    platform: Platform.OS as MobilePlatform,
    device_model: DeviceInfo.getModel(),
    system_version: DeviceInfo.getSystemVersion(),
    screen_width: Math.round(width),
    screen_height: Math.round(height),
    timezone: detectTimezone(),
    language: detectLanguage(),
  };
}
