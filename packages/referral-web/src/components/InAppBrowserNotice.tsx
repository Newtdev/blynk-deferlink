import React from 'react';

export interface InAppBrowserNoticeProps {
  className?: string;
  style?: React.CSSProperties;
  message?: string;
  actionLabel?: string;
}

/**
 * Shown inside embedded browsers (WhatsApp, Instagram, …) where custom URL
 * schemes are often blocked. Store links still work, so this nudges the user
 * to open the page in their real browser for the smoothest handoff.
 */
export function InAppBrowserNotice({
  className,
  style,
  message = 'For the best experience, open this page in your browser.',
  actionLabel = 'Open in browser',
}: InAppBrowserNoticeProps) {
  const href =
    typeof window !== 'undefined' ? window.location.href : '#';

  return (
    <div className={className} style={style} role="note">
      <span>{message}</span>{' '}
      <a href={href}>{actionLabel}</a>
    </div>
  );
}
