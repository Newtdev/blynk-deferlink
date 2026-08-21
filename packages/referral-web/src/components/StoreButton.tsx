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

  // When a caller supplies onClick, it fully owns navigation (see
  // ReferralLanding's redirectToStore — it awaits click registration, then
  // sets window.location.href itself with the resolved click_id embedded).
  // Without preventDefault, the anchor's own `href` — computed here at
  // render time, before that await, so never carrying click_id — navigates
  // immediately on click regardless: the browser's default action for a
  // link click isn't blocked by an onClick handler unless it says so, and
  // an async handler's post-await work never finishes before that default
  // action already fired. `href` still renders as a real, complete link
  // (right-click/long-press "open in new tab", crawlers, no-JS) whenever
  // there's no onClick to hand navigation to.
  const handleClick = onClick
    ? (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        onClick();
      }
    : undefined;

  return (
    <a
      href={href}
      className={className}
      style={style}
      onClick={handleClick}
      data-platform={platform}
    >
      {text}
    </a>
  );
}
