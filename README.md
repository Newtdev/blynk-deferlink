# @sparkle/referral-mobile

React Native half of the deferred deep linking referral system. On first launch
it recovers the referral code the user came in with — deterministically on
Android via the Play Install Referrer, and via fingerprint matching on iOS — then
hands it to your signup flow and records the conversion.

Pairs with `sparkle/referral-sdk` (PHP backend) and `@sparkle/referral-web`
(landing page).

> **Looking for app store IDs/links?** They don't belong here — this package
> only ever runs after your app is already installed, so it never needs to
> know where to send someone to download it. Set `androidPackage`/`iosAppId`
> (or `androidStoreUrl`/`iosStoreUrl` to use a full URL as-is) in
> `@sparkle/referral-web`'s config instead — that's the landing page redirecting
> not-yet-installed visitors to the right store.

## Install

This package isn't published to npm yet. Until it is, install it straight
from GitHub — same pattern as `react-native-smileid-wrapper`:

```bash
npm install github:Newtdev/blynk-referral#mobile-release react-native-device-info

# Required if you build for Android — see below for why it's not optional:
npm install react-native-play-install-referrer

# Recommended unless your app already has its own storage engine (MMKV,
# SQLite, etc.) — see "Storage" below if it does:
npm install @react-native-async-storage/async-storage

cd ios && pod install
```

npm reads the package's real name (`@sparkle/referral-mobile`) out of its
`package.json`, so it lands in your `dependencies` as
`"@sparkle/referral-mobile": "github:Newtdev/blynk-referral#mobile-release"`
and imports work exactly like a normal published package — no source changes
needed later.

`mobile-release` is a filtered branch containing just this package (kept in
sync with `packages/referral-mobile` on `main`); it installs straight from
TypeScript source via the `react-native` field in `package.json`, no build
step required. Once this is published to npm, switch the first line to:

```bash
npm install @sparkle/referral-mobile react-native-device-info
```

`react-native-device-info` is a required peer — it's the only source of the
`device_id` every `/match` and `/claim` request needs (and of iOS fingerprint
data; iOS has no install-referrer equivalent, so it's load-bearing there, not
optional).

`react-native-play-install-referrer` is a **required** peer if you build for
Android — not optional. Install Referrer is deterministic (~100%); fingerprint
matching is probabilistic and, even with recency scoring, isn't guaranteed to
clear the match threshold on its own (see "How recovery works" below). Since
Android has a reliable deterministic path available, there's no reason to
settle for the weaker one by default. If it's missing, `useReferralCode()`
throws a clear error rather than silently falling back to fingerprinting — an
iOS-only build never touches this dependency at all.

`@react-native-async-storage/async-storage` is the one **optional** peer:
without it, you must supply your own `storageAdapter` (below) — the SDK won't
silently do nothing there either, it throws a clear error telling you to do
one or the other.

> Note: earlier versions of this package (and the original project spec)
> referenced a package named `react-native-android-install-referrer`. That
> name was never published to npm — it 404s. `react-native-play-install-referrer`
> is the real, maintained package this SDK now actually uses under the hood
> ([src/platform/android.ts](src/platform/android.ts)); if you installed the
> old name, swap it for this one.

## Quick start

Wrap your app once:

```tsx
import { ReferralProvider } from '@sparkle/referral-mobile';

const referralConfig = {
  // apiEndpoint defaults to the production backend — omit it entirely unless
  // you're pointing at a staging/local server instead.
  appScheme: 'sparkleapp',
  matchTimeoutMs: 5000,
  onCodeFound: (code, method) => console.log('recovered', code, 'via', method),
};

export default function App() {
  return (
    <ReferralProvider config={referralConfig}>
      <NavigationContainer>{/* … */}</NavigationContainer>
    </ReferralProvider>
  );
}
```

Then use the hook on your signup / onboarding screen:

```tsx
import { useReferralCode } from '@sparkle/referral-mobile';

function SignupScreen() {
  const { code, loading, method, claim } = useReferralCode();

  const onSignup = async (userId: string) => {
    if (code) await claim(userId); // records the conversion + reward
  };

  return (
    <View>
      <TextInput
        value={code ?? ''}
        editable={!code}                 // lock when auto-detected
        placeholder="Referral code (optional)"
      />
      {code ? <Text>🎁 Referral bonus will be applied</Text> : null}
    </View>
  );
}
```

## How recovery works

```
First launch → useReferralCode()
│
├─ Already processed? → return the stored result (no network)
│
├─ Android:
│   ├─ Read Install Referrer → parse code   → method: install_referrer
│   └─ Empty referrer → fingerprint match    → method: fingerprint
│
└─ iOS:
    └─ Fingerprint match (POST /referral/match) → method: fingerprint
```

Recovery runs **once per install** — the result is cached via your storage
adapter (AsyncStorage by default), so mounting the hook on several screens is
safe. A conversion is recorded once per device; a second `claim()` returns
`already_claimed`.

## Storage

By default, the recovered code and the "already ran" flag are persisted with
a lazily-loaded `@react-native-async-storage/async-storage`. If your app
already has its own storage engine, there's no need to also install and ship
AsyncStorage — pass a `storageAdapter` instead. The contract is the smallest
possible key/value shape (the same one `redux-persist` uses for this exact
reason), so wrapping anything else is a few lines:

```tsx
import { MMKV } from 'react-native-mmkv';
import type { ReferralStorageAdapter } from '@sparkle/referral-mobile';

const mmkv = new MMKV();

const mmkvAdapter: ReferralStorageAdapter = {
  getItem: async (key) => mmkv.getString(key) ?? null,
  setItem: async (key, value) => mmkv.set(key, value),
  removeItem: async (key) => mmkv.delete(key),
};

const referralConfig = {
  storageAdapter: mmkvAdapter,
  // ...
};
```

With `storageAdapter` set, `@react-native-async-storage/async-storage` never
needs to be installed at all — one storage engine in your app, not two, and
one less native dependency's version to keep compatible with the rest of
your project.

## Manual fallback

If a match fails (common when an iOS user switches networks between click and
install), `code` is `null`. Keep the referral field editable so the user can
type the code from the landing page by hand.

## Config reference

| Field | Required | Description |
|-------|----------|-------------|
| `apiEndpoint` | no | Base URL of the referral backend. Defaults to the production endpoint (`https://referral-sdk-node.vercel.app/api`); override only for staging/local. |
| `appScheme` | no | Custom scheme for deep-link handling. |
| `matchTimeoutMs` | no | Max wait for the match request (default 5000). |
| `matchWindow` / `minConfidence` | no | Informational; the server enforces both. |
| `storageAdapter` | no | Custom persistence (MMKV, SQLite, etc). Defaults to AsyncStorage. See "Storage" above. |
| `onCodeFound` / `onNoCode` | no | Recovery callbacks. |

## Build

```bash
npm install && npm run build   # emits ESM + CJS + .d.ts to dist/
```
