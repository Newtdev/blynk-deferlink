import { useCallback, useEffect, useRef, useState } from 'react';
import { useReferralContext } from './ReferralProvider';
import type { ClaimResult, MatchMethod, ReferralResult } from './types';

/**
 * Recovers the referral code on first launch and exposes it to the signup flow.
 * Recovery runs exactly once per install; mounting this hook on multiple
 * screens is safe (cached in memory for the session, not re-run). The code
 * itself isn't persisted by the SDK past this session — see ReferralConfig's
 * storageAdapter doc and ReferralResult.claim if the app needs to claim it
 * later instead of immediately.
 */
export function useReferralCode(): ReferralResult {
  const { service } = useReferralContext();

  const [code, setCode] = useState<string | null>(null);
  const [method, setMethod] = useState<MatchMethod | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      try {
        const result = await service.recover();
        if (cancelled) return;
        setCode(result.code);
        setMethod(result.method);
        setConfidence(result.confidence);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [service]);

  const claim = useCallback(
    (userId: string, overrideCode?: string): Promise<ClaimResult> =>
      service.claim(userId, overrideCode),
    [service],
  );

  return { code, method, confidence, loading, error, claim };
}
