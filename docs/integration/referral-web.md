# Integrating `@blynk-deferlink/referral-web` (landing page)

Step-by-step setup for the React landing page a share link points to. It
registers the click, attempts to open an already-installed app, and
redirects to the right store with the referral code embedded for
Android's Install Referrer. This guide gets you from nothing to a verified
click round trip against a real backend. For the full prop/config
reference, see
[`packages/referral-web/README.md`](../../packages/referral-web/README.md).

## Prerequisites

- React ≥ 17.
- A running backend — either SDK, deployed and reachable — with its base
  URL in hand. Do this first: [`referral-sdk.md`](referral-sdk.md) or
  [`referral-sdk-node.md`](referral-sdk-node.md).
- Your app's iOS App Store id and Android package name (or full store
  URLs if you'd rather set those directly).

## 1. Install

```bash
npm install @blynk-deferlink/referral-web
```

## 2. Configure the provider

```tsx
import { ReferralProvider, ReferralLanding } from '@blynk-deferlink/referral-web';

const config = {
  apiEndpoint: 'https://your-backend.example.com/api', // from the backend guide
  appScheme: 'myapp',            // your app's custom URL scheme, no "://"
  androidPackage: 'com.example.app',
  iosAppId: '123456789',
};

function Root() {
  return (
    <ReferralProvider config={config}>
      {/* your routes */}
    </ReferralProvider>
  );
}
```

`androidPackage`/`iosAppId` are only skippable if you set the
`*StoreUrl` override for that platform instead — see the README's config
table for the full field list (`androidStoreUrl`, `iosStoreUrl`,
`appOpenTimeout`, `utmSource`).

## 3. Render the landing page at your referral route

```tsx
<Route
  path="/code=:code"
  element={<ReferralLanding referralCode={/* parse from the URL param */ code} />}
/>
```

That's a working landing page: it registers the click on mount, tries the
app-open handoff on mobile, and counts down to the store (8s on iOS, 3s on
Android by default — see the README for why those differ). Everything
else — `logo`, `title`, `subtitle`, `ctaText`, `theme`, `onAppOpen`,
`onRedirect` — is optional theming/instrumentation on top of that; skip to
step 5 if the defaults are fine for now.

## 4. (Optional) Server-side Open Graph tags

A pure client SPA can't produce working WhatsApp/social link previews —
they're fetched via a server-side crawl. If you need real previews, render
OG tags server-side (Next.js `generateMetadata`, an Express view, etc.)
using `buildReferralMeta` — see the README's "Link previews" section for a
worked example. Skip this if link previews aren't a requirement yet.

## 5. Verify: a real click registers

```bash
npm run dev   # or your app's usual dev command
```

Open the landing route with a real code, e.g.
`http://localhost:5173/code=TESTCODE`, with your browser's network tab
open. Confirm:

1. A `POST /referral/click` fires against your `apiEndpoint` on page load,
   and the response includes a `token`.
2. On a desktop browser, both store buttons render (there's no device to
   detect there, so neither can be chosen automatically). On a phone
   browser (or a mobile viewport in devtools), only the one matching CTA
   renders, plus a countdown.
3. Query the backend directly (or use the verification steps from the
   backend guide) and confirm a new row landed in `referral_clicks` with
   the fingerprint data from your test load.

If the click registered and you got a token back, the landing page is
correctly wired to the backend — the rest (theming, custom UI via hooks,
OG tags) is additive from here.
