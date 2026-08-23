import { ReferralProvider, ReferralLanding } from '@blynk-deferlink/referral-web';

// Defaults to the local mock backend for `npm run dev`. Production builds
// (Vercel) set VITE_API_ENDPOINT to the deployed @blynk-deferlink/referral-sdk-node
// instance instead — see .env.production.
const config = {
  apiEndpoint: import.meta.env.VITE_API_ENDPOINT ?? 'http://localhost:8787/api',
  appScheme: 'myapp',
  // androidPackage/iosAppId are only used as a fallback when the *StoreUrl
  // envs below aren't set — real values here, not placeholders, matter
  // only if you're relying on that fallback. Prefer setting the full URLs.
  androidPackage: 'com.example.yourapp',
  iosAppId: '0000000000',
  // Full store links, set directly rather than composed — see
  // .env.production. iosStoreUrl in particular should always be the full
  // regioned URL (apps.apple.com/<country>/app/<slug>/id<id>), not just an
  // id — see docs/decisions.md #16 for why a bare id-only link is risky.
  iosStoreUrl: import.meta.env.VITE_IOS_STORE_URL || undefined,
  androidStoreUrl: import.meta.env.VITE_ANDROID_STORE_URL || undefined,
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
        // Not set explicitly — inherits ReferralLanding's own default
        // (8s, biased toward the tap over the passive countdown; see
        // docs/decisions.md #18). Was hardcoded to 3 here before, which
        // silently overrode that default regardless of what it was set to.
        theme={{ primaryColor: '#6C63FF', radius: '14px' }}
        onRedirect={(p) => console.log('redirect →', p)}
      />
    </ReferralProvider>
  );
}
