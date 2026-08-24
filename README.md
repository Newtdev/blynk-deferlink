# blynk-deferlink

A deferred deep linking referral system in three installable packages plus
runnable examples. **New here?** Read this file top to bottom — it's written
as a guided path, not a reference dump: what this is, how it works, how to
run it, and where to go next depending on what you're trying to do.

```
packages/
  referral-sdk/       PHP / Composer  — backend: click store, matching, claims
  referral-sdk-node/  @blynk-deferlink/referral-sdk-node — Node.js backend (Express + Postgres), same API contract
  referral-web/       @blynk-deferlink/referral-web     — React landing page + hooks
  referral-mobile/    @blynk-deferlink/referral-mobile  — React Native code recovery
examples/
  mock-backend/       zero-dependency Node stand-in for either real backend (in-memory, not for production)
  web/                Vite React app using @blynk-deferlink/referral-web
  mobile/             Expo app using @blynk-deferlink/referral-mobile
```

## How it works

```
share link  →  landing page stores a click (fingerprint)  →  user installs app
   →  app recovers the code (Android: Install Referrer · iOS: fingerprint match)
   →  code pre-fills signup  →  claim records the conversion + reward
```

That's the one-line version. The code is recovered one of two genuinely
different ways — deterministically (reading a signed token straight off the
Android install referrer or an iOS clipboard tap, no network call) or
probabilistically (a scored fingerprint match, when the deterministic path
isn't available) — and it works differently enough on each platform that
it's worth seeing drawn out rather than just described:
[`docs/integration/recovery-flow.md`](docs/integration/recovery-flow.md).

---

## Quick start — run the demo

**Don't want to clone anything yet?** [Try the recovery flow live](https://referral-web-demo.vercel.app/demo)
— registers a real click against the live backend, then walks through all
three recovery methods (Android install-referrer, iOS clipboard,
fingerprint-only fallback) with the actual request/response for each.

Otherwise, the fastest way to see the whole thing work locally, before
installing anything for real. Three terminals. No PHP or database required
— the mock backend covers it.

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

## Documentation

Once the demo makes sense, this is where to go depending on what you're
actually trying to do:

**Setting this up for real — pick the piece you need:**
| Guide | What it covers |
|---|---|
| [`docs/integration/referral-sdk.md`](docs/integration/referral-sdk.md) | PHP backend — Laravel or standalone, zero to a verified `/click` → `/claim` round trip |
| [`docs/integration/referral-sdk-node.md`](docs/integration/referral-sdk-node.md) | Node backend — local run, Postgres setup, Vercel deploy |
| [`docs/integration/referral-web.md`](docs/integration/referral-web.md) | Landing page — provider config, rendering `<ReferralLanding>`, verifying a click registers |
| [`docs/integration/referral-mobile.md`](docs/integration/referral-mobile.md) | Mobile app — install, wiring `useReferralCode()`, on-device verification |
| [`docs/integration/recovery-flow.md`](docs/integration/recovery-flow.md) | The four recovery paths (deterministic/probabilistic × Android/iOS), diagrammed |
| [`docs/integration/README.md`](docs/integration/README.md) | Index — what order to read the above in |

**Understanding *why* it's built this way**, not just how to use it:
[`docs/decisions.md`](docs/decisions.md) — the engineering-decisions log.
Every non-obvious choice in this codebase (why matching uses a graduated
recency score, why `/claim` requires a signed token instead of trusting the
request, why the mobile SDK persists nothing to disk) is written up there
with the problem it solved, in chronological order.

**API/config reference** for a package you've already set up lives in that
package's own README (`packages/*/README.md`) — the integration guides above
are the walkthrough; the READMEs are what to come back to for a specific
config field or endpoint shape.

---

## Installing the SDKs

These packages are **not published to npm yet**, so `npm install @blynk-deferlink/...`
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
  "@blynk-deferlink/referral-mobile": "file:/path/to/packages/referral-mobile"
}
```

React Native's Metro bundles the SDK straight from its TypeScript source (the
package's `react-native` field points at `src/`), so no build step is needed for
the mobile SDK. The web SDK is consumed from source here via a Vite alias; for a
non-source consumer, build it first (below).

**3. A tarball.** Build, pack, then install the `.tgz` anywhere:

```bash
npm --workspace @blynk-deferlink/referral-web run build
npm --workspace @blynk-deferlink/referral-web pack        # → blynk-deferlink-referral-web-1.0.0.tgz
npm install ./blynk-deferlink-referral-web-1.0.0.tgz
```

To publish for real: `npm run build:sdks`, then `npm publish` in each package
(and `composer` / Packagist for the PHP one).

---

## Production notes

- Swap the mock backend for a real one — either `packages/referral-sdk` (PHP)
  or `packages/referral-sdk-node` (Node/Express + Postgres, deployable to
  Vercel or any Node host). Same API contract; the web/mobile SDKs don't care
  which one is behind `apiEndpoint`. See the [Documentation](#documentation)
  section above for step-by-step setup guides for all four packages.
- Wire real referral-code validation (`code_validator`) and reward distribution
  (`on_claim_callback`) in whichever backend config you use.
- Link previews (WhatsApp/social) need server-side OG tags — see the web SDK
  README and `buildReferralMeta`.
