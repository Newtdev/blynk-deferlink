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
   * the actual in-flight request rather than reading `clickId` state, which
   * might not have committed yet if this is called synchronously from a tap
   * handler or a countdown timer that fires before the network round trip
   * completes. Resolves to null if the click never registered (network
   * failure, invalid code, or no referralCode at all) rather than blocking
   * forever — a store redirect must always be able to proceed either way;
   * click_id is what backs the deterministic recovery channels, not a
   * precondition for the redirect itself. See docs/decisions.md #21.
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
  const clickPromiseRef = useRef<Promise<string | null>>(Promise.resolve(null));

  useEffect(() => {
    if (!referralCode || sent.current) return;
    sent.current = true;
    setLoading(true);

    const controller = new AbortController();

    let resolvePromise!: (id: string | null) => void;
    clickPromiseRef.current = new Promise<string | null>((resolve) => {
      resolvePromise = resolve;
    });

    (async () => {
      let result: string | null = null;
      try {
        const res = await fetch(`${config.apiEndpoint}/referral/click`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referral_code: referralCode,
            fingerprint: collect(),
          }),
          signal: controller.signal,
        });
        const data: ClickResponse = await res.json();
        if (data.success && data.click_id) {
          setClickId(data.click_id);
          result = data.click_id;
        } else if (data.error) {
          setError(new Error(data.error));
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err as Error);
        }
      } finally {
        setLoading(false);
        resolvePromise(result);
      }
    })();

    return () => controller.abort();
    // Intentionally keyed only on the code — one registration per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralCode]);

  const waitForClick = useCallback(() => clickPromiseRef.current, []);

  return { clickId, loading, error, waitForClick };
}
