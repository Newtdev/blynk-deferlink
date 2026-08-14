import { useEffect, useRef, useState } from 'react';
import { useReferralConfig } from '../ReferralProvider';
import type { ClickResponse } from '../types';
import { useFingerprint } from './useFingerprint';

export interface UseReferralClickResult {
  clickId: string | null;
  loading: boolean;
  error: Error | null;
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

  useEffect(() => {
    if (!referralCode || sent.current) return;
    sent.current = true;
    setLoading(true);

    const controller = new AbortController();

    (async () => {
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
        } else if (data.error) {
          setError(new Error(data.error));
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err as Error);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
    // Intentionally keyed only on the code — one registration per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralCode]);

  return { clickId, loading, error };
}
