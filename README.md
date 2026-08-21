# Sparkle referral system

A deferred deep linking referral system in three installable packages plus
runnable examples.

```
packages/
  referral-sdk/       PHP / Composer  — backend: click store, matching, claims
  referral-sdk-node/  @sparkle/referral-sdk-node — Node.js backend (Express + Postgres), same API contract
  referral-web/       @sparkle/referral-web     — React landing page + hooks
  referral-mobile/    @sparkle/referral-mobile  — React Native code recovery
examples/
  mock-backend/       zero-dependency Node stand-in for either real backend (in-memory, not for production)
  web/                Vite React app using @sparkle/referral-web
  mobile/             Expo app using @sparkle/referral-mobile
```

## The flow

```
share link  →  landing page stores a click (fingerprint)  →  user installs app
   →  app recovers the code (Android: Install Referrer · iOS: fingerprint match)
   →  code pre-fills signup  →  claim records the conversion + reward
```

---

## Installing the SDKs

These packages are **not published to npm yet**, so `npm install @sparkle/...`
won't resolve. Until you publish, install them locally — three ways:

**1. Workspaces (what this repo uses).** From the repo root:

```bash
npm install        # links packages/* and installs example deps
```

The examples already declare the SDKs as `file:` dependencies, so they resolve
to the local source automatically.

**2. A `file:` dependency in your own project.**

```jsonc
// package.json
"dependencies": {
  "@sparkle/referral-mobile": "file:/path/to/packages/referral-mobile"
}
```

React Native's Metro bundles the SDK straight from its TypeScript source (the
package's `react-native` field points at `src/`), so no build step is needed for
the mobile SDK. The web SDK is consumed from source here via a Vite alias; for a
non-source consumer, build it first (below).

**3. A tarball.** Build, pack, then install the `.tgz` anywhere:

```bash
npm --workspace @sparkle/referral-web run build
npm --workspace @sparkle/referral-web pack        # → sparkle-referral-web-1.0.0.tgz
npm install ./sparkle-referral-web-1.0.0.tgz
```

To publish for real: `npm run build:sdks`, then `npm publish` in each package
(and `composer` / Packagist for the PHP one).

---

## Running the demo

Three terminals. No PHP or database required — the mock backend covers it.

```bash
# 1) backend  (http://localhost:8787)
node examples/mock-backend/server.js

# 2) web landing page  (http://localhost:5173/?code=1234)
npm install
npm --workspace examples/web run dev

# 3) mobile app
npm --workspace examples/mobile run start
```

Open the web page with `?code=1234` and watch the backend log the click. On
desktop it shows both store buttons; on a phone browser it attempts the app
handoff then redirects to the store.

In the mobile app, walk the three buttons — simulate the link tap, recover the
code, claim — and watch the on-screen log and the backend console mirror each
other.

### Mobile notes

- The mobile example needs an **Expo dev build** (`expo run:ios` /
  `expo run:android`), not Expo Go, because `react-native-device-info` and
  `react-native-play-install-referrer` include native code. (The SDK itself
  persists nothing to disk — no AsyncStorage or other storage dependency at
  all; see [packages/referral-mobile/README.md](packages/referral-mobile/README.md#storage).)
- On a **physical device**, `localhost` won't reach your machine — set `API` in
  `examples/mobile/App.tsx` to your computer's LAN IP.
- `react-native-play-install-referrer` is **required** for Android, not
  optional — Android's deterministic recovery path depends on it, and
  `useReferralCode()` throws a clear error if it's missing rather than
  silently falling back to the weaker fingerprint-matching path. (This SDK
  previously referenced a package called `react-native-android-install-referrer`,
  which turned out to not exist on npm at all — see
  [packages/referral-mobile/README.md](packages/referral-mobile/README.md).)

---

## Production notes

- Swap the mock backend for a real one — either `packages/referral-sdk` (PHP)
  or `packages/referral-sdk-node` (Node/Express + Postgres, deployable to
  Vercel or any Node host). Same API contract; the web/mobile SDKs don't care
  which one is behind `apiEndpoint`. See
  [`docs/integration/`](docs/integration/) for step-by-step setup guides for
  all four packages, or each package's own README for API/config reference.
- Wire real referral-code validation (`code_validator`) and reward distribution
  (`on_claim_callback`) in whichever backend config you use.
- Link previews (WhatsApp/social) need server-side OG tags — see the web SDK
  README and `buildReferralMeta`.
