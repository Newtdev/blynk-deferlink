import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface CountdownRedirectProps {
  seconds: number;
  onComplete: () => void;
  /** Render prop for the remaining seconds; default renders a short sentence. */
  children?: (remaining: number) => ReactNode;
  /** Set false to pause (e.g. inside an in-app browser). */
  active?: boolean;
}

/**
 * Counts down then fires onComplete once. Respects `active` so callers can hold
 * the redirect when the custom-scheme handoff is still in flight.
 */
export function CountdownRedirect({
  seconds,
  onComplete,
  children,
  active = true,
}: CountdownRedirectProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!active) return;
    if (remaining <= 0) {
      onComplete();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, active, onComplete]);

  if (children) return <>{children(remaining)}</>;
  return <span>Taking you to the store in {remaining}…</span>;
}
