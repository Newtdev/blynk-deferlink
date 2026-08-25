import { useCallback, useEffect, useRef, useState } from 'react';
import { useReferralConfig } from '../ReferralProvider';
import type { ClickResponse } from '../types';
import { useFingerprint } from './useFingerprint';

export interface UseReferralClickResult {
  clickId: string | null;
  loading: boolean;
  error: Error | null;
  /**
   * Resolves once click registration settles, success or failure — never
   * rejects, so callers can await it without their own try/catch. Waits for
   * the actual in-flight request rather than reading state, which might not
   * have committed yet if this is called synchronously from a tap handler
   * or a countdown timer that fires before the network round trip
   * completes. Resolves to null if the click never registered (network
   * failure, invalid code, or no referralCode at all) rather than blocking
   * forever — a store redirect must always be able to proceed either way;
   * the token is what backs the deterministic recovery channels, not a
   * precondition for the redirect itself. See docs/decisions.md #21/#22.
   */
  waitForClick: () => Promise<string | null>;
}

/**
 * Registers a landing-page click exactly once for a given code. The backend
 * reads the IP server-side, so it isn't sent here.
 */
export function useReferralClick(referralCode: string): UseReferralClickResult {
  const config = useReferralConfig();
  const { collect } = useFingerprint();

  const [clickId, setClickId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const sent = useRef(false);
  // Defaults to an already-resolved null so a call with no referralCode (the
  // effect below never fires, nothing ever registers) doesn't hang forever.
  const tokenPromiseRef = useRef<Promise<string | null>>(Promise.resolve(null));

  useEffect(() => {
    if (!referralCode || sent.current) return;
    sent.current = true;
    setLoading(true);

    // Deliberately no AbortController here — found by actually running this
    // in <React.StrictMode> (examples/web's own dev setup, and React's own
    // recommended way to catch exactly this class of bug): StrictMode
    // double-invokes every effect in development (mount → cleanup → mount),
    // and aborting the in-flight fetch on that synthetic first cleanup
    // killed the *real* click registration outright — the `sent` guard
    // above then blocked the second invocation from ever retrying, so no
    // click was ever registered at all, silently (waitForClick() never
    // rejects). Ignoring a stale result via `cancelled` instead of aborting
    // the request is React's own documented fix for this pattern, and
    // matches what the mobile SDK's useReferralCode already does — the
    // underlying request is left to complete in the background regardless
    // of which invocation's cleanup fired first.
    let cancelled = false;

    let resolvePromise!: (token: string | null) => void;
    tokenPromiseRef.current = new Promise<string | null>((resolve) => {
      resolvePromise = resolve;
    });

    (async () => {
      let token: string | null = null;
      try {
        const res = await fetch(`${config.apiEndpoint}/referral/click`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referral_code: referralCode,
            fingerprint: collect(),
          }),
        });
        const data: ClickResponse = await res.json();
        // token must survive regardless of `cancelled` — it feeds the
        // waitForClick() promise, which callers depend on independent of
        // this component's React state (see the comment on
        // UseReferralClickResult.waitForClick). Only the setClickId/setError
        // state updates below need to be suppressed for a stale invocation.
        if (data.success && data.click_id) {
          token = data.token ?? null;
          if (!cancelled) setClickId(data.click_id);
        } else if (data.error && !cancelled) {
          setError(new Error(data.error));
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
        resolvePromise(token);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally keyed only on the code — one registration per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralCode]);

  const waitForClick = useCallback(() => tokenPromiseRef.current, []);

  return { clickId, loading, error, waitForClick };
}
