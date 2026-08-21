import { useCallback, useEffect, useRef, useState } from 'react';
import { useReferralContext } from './ReferralProvider';
import type { ClaimResult, MatchMethod, ReferralResult } from './types';

/**
 * Recovers the referral code and exposes it to the signup flow. Runs once
 * per mount, cached in memory for the rest of the session — mounting this
 * hook on multiple screens within the same session is safe and free, but
 * nothing persists to disk, so a fresh app launch always runs recovery
 * again from scratch.
 *
 * That means WHERE this is mounted matters: put it on a one-time
 * signup/onboarding screen, not an always-on root component. `/match` is
 * rate-limited per device (default 5/day) — calling this unconditionally
 * on every app launch will burn through that budget on routine opens.
 * `ReferralResult.claim` can only claim what *this* mount's own recovery
 * found — /claim now requires a server-verified click lock (see
 * docs/decisions.md #21), so there's no way to claim a code the app
 * recovered and stored itself in an earlier session anymore.
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

  const claim = useCallback((userId: string): Promise<ClaimResult> => service.claim(userId), [service]);

  const onClipboardCode = useCallback(
    (clipboardCode: string, clickId: string | null) => {
      (async () => {
        const result = await service.applyClipboardCode(clipboardCode, clickId);
        setCode(result.code);
        setMethod(result.method);
        setConfidence(result.confidence);
      })();
    },
    [service],
  );

  return { code, method, confidence, loading, error, claim, onClipboardCode };
}
