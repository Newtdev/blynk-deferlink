import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReferralConfig } from './ReferralProvider';
import { usePlatformDetect } from './hooks/usePlatformDetect';
import { useReferralClick } from './hooks/useReferralClick';
import { StoreButton } from './components/StoreButton';
import { CountdownRedirect } from './components/CountdownRedirect';
import { InAppBrowserNotice } from './components/InAppBrowserNotice';
import { getAppSchemeUrl, getStoreUrl } from './utils/storeUrls';
import { writeClipboardReferral } from './utils/clipboardHandoff';
import type { ReferralTheme } from './types';

export interface ReferralLandingProps {
  referralCode: string;
  referrerName?: string;
  logo?: string;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  /**
   * Overrides the default for BOTH platforms uniformly. Left unset, iOS
   * defaults to 8s (biases toward tapping the CTA, since only a direct
   * gesture can carry the clipboard payload) and Android defaults to 3s
   * (auto-redirect is fully deterministic there either way, no reason to
   * wait longer) — see docs/decisions.md #20.
   */
  countdownSeconds?: number;
  theme?: ReferralTheme;
  /** Fires when the app appears to have opened via the custom scheme. */
  onAppOpen?: () => void;
  /** Fires just before redirecting to the store. */
  onRedirect?: (platform: string) => void;
}

const STYLE_ID = 'sparkle-referral-styles';

function useInjectedStyles(theme?: ReferralTheme) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;

    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = BASE_CSS;
    document.head.appendChild(el);
  }, []);

  return {
    '--rf-primary': theme?.primaryColor ?? '#4338ca',
    '--rf-bg': theme?.backgroundColor ?? '#ffffff',
    '--rf-text': theme?.textColor ?? '#111827',
    '--rf-muted': theme?.mutedColor ?? '#6b7280',
    '--rf-radius': theme?.radius ?? '12px',
    '--rf-font':
      theme?.fontFamily ??
      'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  } as React.CSSProperties;
}

export function ReferralLanding({
  referralCode,
  referrerName,
  logo,
  title = "You've been invited",
  subtitle,
  ctaText,
  countdownSeconds,
  theme,
  onAppOpen,
  onRedirect,
}: ReferralLandingProps) {
  const config = useReferralConfig();
  const { platform, isInAppBrowser } = usePlatformDetect();
  // Platform-specific default, not a flat one — see docs/decisions.md #20.
  // iOS: deliberately longer than a typical "redirecting…" countdown,
  // because tapping the CTA directly is the only path that can carry the
  // clipboard payload (writeClipboardReferral needs a real user gesture —
  // #15/#18). A longer window biases users toward noticing and tapping
  // instead of just waiting it out.
  // Android: recovers deterministically via the Play Store referrer param
  // regardless of tap vs. auto-redirect (writeClipboardReferral never
  // even runs here) — there's no reason to bias toward a tap, so this
  // stays at a normal, fast countdown instead of inheriting iOS's.
  // Pass countdownSeconds explicitly to override either platform's default.
  const effectiveCountdownSeconds = countdownSeconds ?? (platform === 'ios' ? 8 : 3);
  const { waitForClick } = useReferralClick(referralCode);
  const styleVars = useInjectedStyles(theme);

  const appOpened = useRef(false);
  const [redirected, setRedirected] = useState(false);

  const redirectToStore = useCallback(async () => {
    if (appOpened.current || redirected) return;
    setRedirected(true);
    onRedirect?.(platform);
    // click_id backs the deterministic recovery channels (Android referrer
    // param, iOS clipboard payload) — /claim now requires it, so both need
    // this resolved before they're written. Resolves to null (never
    // rejects, never hangs) if registration failed or hasn't finished —
    // the redirect still proceeds either way, just without the
    // deterministic channel's proof, falling back to fingerprint matching
    // exactly like a missing click_id always has. See docs/decisions.md #21.
    const clickId = await waitForClick();
    // iOS only — Android recovers deterministically via the Install
    // Referrer already, no clipboard handoff needed. Awaited so the write
    // actually completes before navigation tears the page down.
    if (platform === 'ios') {
      await writeClipboardReferral(referralCode, clickId);
    }
    window.location.href = getStoreUrl(platform, referralCode, config, clickId);
  }, [platform, referralCode, config, onRedirect, redirected, waitForClick]);

  // Try to open an already-installed app first (native mobile browsers only).
  useEffect(() => {
    if (platform === 'desktop' || isInAppBrowser) return;

    const onHide = () => {
      // Tab backgrounded → the app almost certainly took over.
      appOpened.current = true;
      onAppOpen?.();
    };
    document.addEventListener('visibilitychange', onHide);

    window.location.href = getAppSchemeUrl(referralCode, config);

    return () => document.removeEventListener('visibilitychange', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedSubtitle =
    subtitle ??
    (referrerName
      ? `${referrerName} wants you to join. Sign up to claim your bonus.`
      : 'Sign up to claim your bonus.');

  const isMobile = platform !== 'desktop';

  return (
    <div className="rf-root" style={styleVars}>
      <main className="rf-card" aria-live="polite">
        {logo && <img className="rf-logo" src={logo} alt="" />}

        <h1 className="rf-title">{title}</h1>
        {referrerName && <p className="rf-referrer">{referrerName}</p>}
        <p className="rf-subtitle">{resolvedSubtitle}</p>

        {isMobile ? (
          <>
            <StoreButton
              platform={platform}
              code={referralCode}
              config={config}
              label={ctaText}
              className="rf-cta"
              onClick={redirectToStore}
            />
            {!isInAppBrowser && (
              <p className="rf-countdown">
                <CountdownRedirect
                  seconds={effectiveCountdownSeconds}
                  onComplete={redirectToStore}
                />
              </p>
            )}
          </>
        ) : (
          <div className="rf-store-row">
            <StoreButton
              platform="ios"
              code={referralCode}
              config={config}
              className="rf-cta rf-cta--ghost"
            />
            <StoreButton
              platform="android"
              code={referralCode}
              config={config}
              className="rf-cta rf-cta--ghost"
            />
          </div>
        )}

        {isInAppBrowser && <InAppBrowserNotice className="rf-inapp" />}
      </main>
    </div>
  );
}

const BASE_CSS = `
.rf-root {
  font-family: var(--rf-font);
  background: var(--rf-bg);
  color: var(--rf-text);
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  box-sizing: border-box;
}
.rf-card {
  width: 100%;
  max-width: 380px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.rf-logo { height: 48px; width: auto; margin-bottom: 8px; }
.rf-title { font-size: 1.6rem; line-height: 1.2; margin: 0; font-weight: 650; }
.rf-referrer { margin: 0; font-weight: 600; color: var(--rf-primary); }
.rf-subtitle { margin: 0 0 8px; color: var(--rf-muted); line-height: 1.5; }
.rf-cta {
  display: inline-block;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 20px;
  background: var(--rf-primary);
  color: #fff;
  font-weight: 600;
  text-decoration: none;
  border-radius: var(--rf-radius);
  transition: transform .12s ease, opacity .12s ease;
}
.rf-cta:hover { opacity: .92; }
.rf-cta:active { transform: translateY(1px); }
.rf-cta:focus-visible { outline: 3px solid var(--rf-primary); outline-offset: 3px; }
.rf-cta--ghost {
  background: transparent;
  color: var(--rf-text);
  border: 1px solid var(--rf-muted);
}
.rf-store-row { display: flex; gap: 12px; width: 100%; }
.rf-countdown { font-size: .9rem; color: var(--rf-muted); margin: 4px 0 0; }
.rf-inapp {
  margin-top: 12px;
  font-size: .85rem;
  color: var(--rf-muted);
}
.rf-inapp a { color: var(--rf-primary); }
@media (prefers-reduced-motion: reduce) {
  .rf-cta { transition: none; }
}
`;
