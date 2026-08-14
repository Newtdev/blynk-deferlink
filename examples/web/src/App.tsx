import { ReferralProvider, ReferralLanding } from '@sparkle/referral-web';

// Defaults to the local mock backend for `npm run dev`. Production builds
// (Vercel) set VITE_API_ENDPOINT to the deployed @sparkle/referral-sdk-node
// instance instead — see .env.production.
const config = {
  apiEndpoint: import.meta.env.VITE_API_ENDPOINT ?? 'http://localhost:8787/api',
  appScheme: 'sparkleapp',
  androidPackage: 'com.sparkle.app',
  iosAppId: '123456789',
  appOpenTimeout: 2000,
};

function readCode(): string {
  // Supports ?code=1234, the spec's /code=1234 shape, and /referral/1234
  // (the real shape production referral links use).
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) return params.get('code')!;
  const codeEq = /code=([^/&]+)/.exec(window.location.pathname);
  if (codeEq) return decodeURIComponent(codeEq[1]);
  const referralPath = /\/referral\/([^/&]+)/.exec(window.location.pathname);
  if (referralPath) return decodeURIComponent(referralPath[1]);
  // No code found in the URL at all — falling back to a placeholder masks
  // real bugs (a mismatched route silently "succeeds" against whatever code
  // happens to exist in the DB), so make it loud instead of silent.
  console.warn(
    `No referral code found in URL (${window.location.href}); falling back to placeholder "1234".`,
  );
  return '1234';
}

export function App() {
  const code = readCode();

  return (
    <ReferralProvider config={config}>
      <ReferralLanding
        referralCode={code}
        referrerName="Ada"
        title="You've been invited"
        subtitle="Sign up and get ₦500 bonus"
        ctaText="Download the app"
        countdownSeconds={3}
        theme={{ primaryColor: '#6C63FF', radius: '14px' }}
        onRedirect={(p) => console.log('redirect →', p)}
      />
    </ReferralProvider>
  );
}
