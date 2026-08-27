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

## Demo

Both recordings are the real demo (`examples/web` + `examples/mobile`) against
the real deployed backend — no simulated steps. iOS recovers via clipboard
fingerprint matching (confidence 100) and stops there — the recording
environment couldn't synthesize the final tap; Android runs the full loop
including the claim and reward.

**iOS** — clipboard fingerprint recovery:

<video src="docs/media/demo-ios.mp4" controls width="360"></video>

**Android** — install referrer recovery through claim + reward:

<video src="docs/media/demo-android.mp4" controls width="360"></video>

## How it works

```
share link tapped → landing page stores a click, signs a token
   → user installs app → app recovers the code + token, one of two ways:

       deterministic (no network call, no guessing):
         Android reads it off the Play Install Referrer, automatically
         iOS reads it off the clipboard, only if <ReferralPasteButton> is tapped

       probabilistic (fallback, whichever platform didn't get a deterministic hit):
         a scored fingerprint match against recent unmatched clicks

   → code + token pre-fill signup → claim verifies the token,
     records the conversion, distributes the reward
```

Deterministic and probabilistic recovery are two separate mechanisms, not
two branches of one path — shown below as two diagrams, both starting at
the same click and ending at the same claim.

### Deterministic recovery

Android's default path, and iOS's opt-in path — both read a code and proof
entirely on-device, no network call. Neither touches fingerprint matching
at all.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TD
    A["Share link tapped"] --> B["Landing page (referral-web)<br/>POST /click"]
    B --> C["Backend stores click, signs token<br/>click_id.expiry.hmac"]
    C --> D1[Android]
    C --> D2[iOS]

    subgraph android [ANDROID]
        D1 --> E1["Token embedded in Play Store referrer param"]
        E1 --> F1["App installed"]
        F1 --> G1{"Install Referrer has<br/>code + token?"}
        G1 -->|yes| H1["<b>method: install_referrer</b><br/>read fully locally, no network call"]
        G1 -.->|"no"| X1["see Probabilistic diagram"]
    end

    subgraph ios [iOS]
        D2 --> E2["Token + code written to clipboard,<br/>right before store redirect"]
        E2 --> F2["App installed"]
        F2 --> G2{"User taps<br/>&lt;ReferralPasteButton&gt;?"}
        G2 -->|yes| H2["<b>method: clipboard</b><br/>read fully locally, no network call<br/>overrides an automatic match, if tapped"]
        G2 -.->|"not tapped (default)"| X2["see Probabilistic diagram"]
    end

    H1 --> P["code + token ready"]
    H2 --> P
    P --> Q["Pre-fills signup<br/>POST /claim {device_id, token, method}"]
    Q --> R["Verified → conversion recorded<br/>reward distributed"]

    classDef ghost fill:transparent,stroke-dasharray: 2 3,color:#888
    class X1,X2 ghost
```

### Probabilistic recovery

Reached only when the deterministic path above didn't run or didn't have
anything to read — a scored guess, backed by the same signed token once it
succeeds. Both platforms feed the same scoring engine; this is the one
piece of matching logic that isn't platform-specific at all.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TD
    A["Share link tapped"] --> B["Landing page (referral-web)<br/>POST /click"]
    B --> C["Backend stores click, signs token<br/>click_id.expiry.hmac"]
    C --> D1[Android]
    C --> D2[iOS]

    subgraph android [ANDROID]
        D1 --> E1["Install Referrer empty or sideload<br/><i>fallback only — see Deterministic</i>"]
    end

    subgraph ios [iOS]
        D2 --> E2["Automatic, every launch, no gesture required<br/><i>iOS's default recovery attempt</i>"]
    end

    E1 --> M["<b>Match Engine</b><br/>scores fingerprint vs. recent unmatched clicks<br/>IP · device · screen · timezone · language · recency"]
    E2 --> M
    M --> N{"score ≥ min_confidence<br/>(default 70)?"}
    N -->|yes| O1["<b>method: fingerprint</b><br/>click locked to device, atomically"]
    N -.->|no| O2["No match<br/>code: null — manual entry fallback"]

    O1 --> P["code + token ready<br/>(or a manual code, no token, on no match)"]
    O2 -.-> P
    P --> Q["Pre-fills signup<br/>POST /claim {device_id, token, method}"]
    Q --> R["Verified → conversion recorded<br/>reward distributed"]

    classDef nomatch stroke-dasharray: 2 3
    class O2 nomatch
```

**Reliability**: Android deterministic recovery hits ~100% of real
installs; iOS deterministic recovery depends entirely on whether the paste
button is rendered and tapped. Probabilistic matching sees an observed
~85–90% match rate on iOS, where it's the default fallback; lower priority
on Android, where it's a fallback of last resort.

**The proof that makes both deterministic paths possible**: every
recovered code carries a signed proof (`click_id.expiry.hmac`), minted
once at `/click` — this is what lets both deterministic paths stay
genuinely network-free at recovery time, and what `/claim` verifies before
any reward is paid out. A code with no valid token behind it (including
one a user typed in by hand) can reach signup, but can never clear
`/claim` — see [`docs/decisions.md`](docs/decisions.md) #21/#22 for the
full reasoning behind why this replaced an earlier redeem-round-trip
design.

---

## Quick start — run the demo

**Don't want to clone anything yet?** [Try the recovery flow live](https://referral-web-demo.vercel.app/demo)
— pick a referral code and it builds a real link to the actual production
landing page (real countdown, real click registration, real clipboard
handoff), then recovers it exactly how a real installed app would (Android:
automatic via the Play referrer param; iOS: a real clipboard check, falling
back to a real fingerprint match), with the actual request/response for
every step.

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

The mobile app recovers automatically on launch, same as a real app —
there's nothing to simulate inside it. To see it actually find something,
type a code into its own "Generate a referral link" card and tap **Open
link** — that opens the real landing page in your device/simulator's
browser (real countdown, real click registration, real clipboard handoff),
then switch back to the app to see the recovery.

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
- **Deep-linking straight into the running app (no store, no install) works,
  but an Expo dev build adds one extra tap.** `<ReferralLanding>` always
  tries `myapp://referral?code=...` first, before falling through to the
  countdown/store redirect — confirmed with `xcrun simctl openurl` against a
  real installed build. On a real production build this routes straight
  into the app, no dialog. On an **Expo development build** specifically
  (what `expo run:ios`/`expo run:android` produce), Expo's own dev-client
  intercepts every custom-scheme link first with a "which dev server should
  open this?" picker (it supports pointing one binary at several Metro
  instances) — pick this app's entry there and it proceeds normally.
  Standard Expo tooling behavior, not something this SDK or example
  controls.

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
| [`docs/integration/README.md`](docs/integration/README.md) | Index — what order to read the above in |

The four recovery paths (deterministic/probabilistic × Android/iOS),
diagrammed, live in [How it works](#how-it-works) above rather than a
separate doc — it's central enough to the project to read before anything
else, not something to click away for.

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
