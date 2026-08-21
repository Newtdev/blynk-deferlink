# @sparkle/referral-web

React web half of the deferred deep linking referral system. It renders the
referral landing page, captures a browser fingerprint, detects the platform,
tries to open an already-installed app, and redirects to the right store — with
the referral code embedded for Android's Install Referrer.

Pairs with `sparkle/referral-sdk` (PHP backend) and `@sparkle/referral-mobile`
(React Native).

## Install

```bash
npm install @sparkle/referral-web
```

## Quick start

Wrap the app (or just the referral route) in the provider, then drop in the
pre-built landing page:

```tsx
import { ReferralProvider, ReferralLanding } from '@sparkle/referral-web';

const config = {
  apiEndpoint: 'https://referal.sparkle.ng/api',
  appScheme: 'sparkleapp',
  androidPackage: 'com.sparkle.app',
  iosAppId: '123456789',
  appOpenTimeout: 2000,
};

<ReferralProvider config={config}>
  <Routes>
    <Route
      path="/code=:code"
      element={<ReferralLanding referralCode={/* parse from URL */ ''} />}
    />
  </Routes>
</ReferralProvider>;
```

`ReferralLanding` handles the whole flow: registers the click, attempts the
app handoff on native mobile browsers, and counts down to the store. The
visitor never picks a store — the OS is detected from the browser
(`usePlatformDetect`) and routed automatically: a phone visitor sees one CTA
that redirects to their own platform's store, no choice involved. Both store
buttons only appear on a **desktop** visit, and only because there's no
device to detect there — a desktop browser can't know which phone the
visitor will install on. Everything is themeable via props:

```tsx
<ReferralLanding
  referralCode="1234"
  referrerName="Ada"
  logo="/logo.svg"
  title="You've been invited"
  ctaText="Download the app"
  countdownSeconds={3}
  theme={{ primaryColor: '#6C63FF', radius: '14px' }}
/>
```

Styles are injected once and scoped under `.rf-*` class names — override them in
your own CSS for full control, or restyle via the `theme` prop.

## Custom UI with hooks

Skip the pre-built page and compose your own:

```tsx
import {
  useReferralClick,
  usePlatformDetect,
  getStoreUrl,
  getAppSchemeUrl,
} from '@sparkle/referral-web';

function MyLanding({ code }: { code: string }) {
  const config = useReferralConfig();
  const { platform, isInAppBrowser } = usePlatformDetect();
  const { waitForClick, error } = useReferralClick(code);

  const goToStore = async () => {
    // Wait for click registration before building the store URL — click_id
    // backs the deterministic recovery channels (Android's referrer param;
    // pass it to writeClipboardReferral too on iOS), and /claim now
    // requires it. Resolves to null (never hangs) if registration hasn't
    // finished — the redirect still works, just without that channel's
    // proof, falling back to fingerprint matching same as always. See
    // docs/decisions.md #21. `<ReferralLanding>` already does this —
    // replicate it if you're not using that component.
    const clickId = await waitForClick();
    window.location.href = getStoreUrl(platform, code, config, clickId);
  };
  // build your own layout, call goToStore() from your CTA's onClick
  // (with e.preventDefault() if it's a real <a> — see StoreButton.tsx for
  // why that matters) or a countdown's onComplete…
}
```

## Link previews (Open Graph)

WhatsApp and other apps fetch OG tags via a **server-side** crawl, so a pure
client SPA can't produce working previews. Render them server-side. With
Next.js:

```tsx
import { buildReferralMeta } from '@sparkle/referral-web';

export function generateMetadata({ params }) {
  const meta = buildReferralMeta({
    referrerName: lookupName(params.code),
    rewardText: 'Get ₦500 when you sign up',
    imageUrl: 'https://referal.sparkle.ng/og-image.png',
    url: `https://referal.sparkle.ng/code=${params.code}`,
    appName: 'Sparkle',
  });
  return {
    title: meta.title,
    description: meta.description,
    openGraph: { title: meta.title, description: meta.description,
      images: meta.image ? [meta.image] : [], url: meta.url },
  };
}
```

## In-app browsers

WhatsApp / Instagram / Facebook webviews often block custom URL schemes. The
landing page detects them (`isInAppBrowser`), skips the scheme attempt, shows an
"open in browser" nudge, and still redirects to the store — store links work in
most in-app browsers.

## Config reference

| Field | Required | Description |
|-------|----------|-------------|
| `apiEndpoint` | yes | Base URL of the PHP backend (e.g. `.../api`). |
| `appScheme` | yes | Custom scheme without `://` (e.g. `sparkleapp`). |
| `androidPackage` | yes* | Android application id — used to compose the Play Store URL. |
| `iosAppId` | yes* | Numeric App Store id — used to compose the App Store URL. |
| `androidStoreUrl` | no | Full Play Store URL to use as-is instead of composing one from `androidPackage`. The `referrer` param is still merged in automatically — it's what carries the referral code through install, not just cosmetic. |
| `iosStoreUrl` | no | Full App Store URL to use as-is instead of composing one from `iosAppId`. |
| `appOpenTimeout` | no | ms before falling back to the store (default 2000). |
| `utmSource` | no | utm_source in the Android referrer (default `referral`). |

\* Not required if the corresponding `*StoreUrl` override is set instead.

## Build

```bash
npm install && npm run build   # emits ESM + CJS + .d.ts to dist/
```
