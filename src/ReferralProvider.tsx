import React, { createContext, useContext, useMemo } from 'react';
import { ReferralService } from './ReferralService';
import type { ReferralConfig } from './types';

interface ContextValue {
  config: ReferralConfig;
  service: ReferralService;
}

const ReferralContext = createContext<ContextValue | null>(null);

export interface ReferralProviderProps {
  config: ReferralConfig;
  children: React.ReactNode;
}

export function ReferralProvider({ config, children }: ReferralProviderProps) {
  const value = useMemo<ContextValue>(
    () => ({ config, service: new ReferralService(config) }),
    // Rebuild only if the endpoint or callbacks identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.apiEndpoint],
  );

  return (
    <ReferralContext.Provider value={value}>
      {children}
    </ReferralContext.Provider>
  );
}

export function useReferralContext(): ContextValue {
  const ctx = useContext(ReferralContext);
  if (!ctx) {
    throw new Error(
      'useReferralCode must be used within a <ReferralProvider>. ' +
        'Wrap your app in <ReferralProvider config={...}>.',
    );
  }
  return ctx;
}
