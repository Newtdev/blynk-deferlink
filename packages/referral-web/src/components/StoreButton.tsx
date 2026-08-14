import React from 'react';
import type { Platform, ReferralConfig } from '../types';
import { getStoreUrl } from '../utils/storeUrls';

export interface StoreButtonProps {
  platform: Platform;
  code: string;
  config: ReferralConfig;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

/** A platform-aware "go to the store" link styled as a button. */
export function StoreButton({
  platform,
  code,
  config,
  label,
  className,
  style,
  onClick,
}: StoreButtonProps) {
  const href = getStoreUrl(platform, code, config);
  const text =
    label ??
    (platform === 'ios'
      ? 'Download on the App Store'
      : platform === 'android'
        ? 'Get it on Google Play'
        : 'Download the app');

  return (
    <a
      href={href}
      className={className}
      style={style}
      onClick={onClick}
      data-platform={platform}
    >
      {text}
    </a>
  );
}
