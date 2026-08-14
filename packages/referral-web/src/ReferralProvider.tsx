import React, { createContext, useContext } from 'react';
import type { ReferralConfig } from './types';

const ReferralContext = createContext<ReferralConfig | null>(null);

export interface ReferralProviderProps {
  config: ReferralConfig;
  children: React.ReactNode;
}

export function ReferralProvider({ config, children }: ReferralProviderProps) {
  return (
    <ReferralContext.Provider value={config}>
      {children}
    </ReferralContext.Provider>
  );
}

/** Read the referral config. Throws if used outside a <ReferralProvider>. */
export function useReferralConfig(): ReferralConfig {
  const config = useContext(ReferralContext);
  if (!config) {
    throw new Error(
      'useReferralConfig must be used within a <ReferralProvider>. ' +
        'Wrap your app (or referral route) in <ReferralProvider config={...}>.',
    );
  }
  return { appOpenTimeout: 2000, utmSource: 'referral', ...config };
}
