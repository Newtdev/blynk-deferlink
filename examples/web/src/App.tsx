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
  // Supports both ?code=1234 and the spec's /code=1234 shape.
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) return params.get('code')!;
  const m = window.location.pathname.match(/code=([^/&]+)/);
  return m ? decodeURIComponent(m[1]) : '1234';
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
