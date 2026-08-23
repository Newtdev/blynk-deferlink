# @blynk-deferlink/referral-mobile

React Native half of the deferred deep linking referral system. On first launch
it recovers the referral code the user came in with — deterministically on
Android via the Play Install Referrer, and via fingerprint matching on iOS — then
hands it to your signup flow and records the conversion.

Pairs with `blynk-deferlink/referral-sdk` (PHP) or `@blynk-deferlink/referral-sdk-node`
(Node/Express) — either backend, same API contract — and
`@blynk-deferlink/referral-web` (landing page).

**New to this package?** [`docs/integration/referral-mobile.md`](../../docs/integration/referral-mobile.md)
is a step-by-step setup guide; this README is API/config reference.

> **Looking for app store IDs/links?** They don't belong here — this package
> only ever runs after your app is already installed, so it never needs to
> know where to send someone to download it. Set `androidPackage`/`iosAppId`
> (or `androidStoreUrl`/`iosStoreUrl` to use a full URL as-is) in
> `@blynk-deferlink/referral-web`'s config instead — that's the landing page redirecting
> not-yet-installed visitors to the right store.

## Install

This package isn't published to npm yet. Until it is, install it straight
from GitHub — same pattern as `react-native-smileid-wrapper`:

```bash
npm install github:Newtdev/blynk-deferlink#mobile-release react-native-device-info

# Required if you build for Android — see below for why it's not optional:
npm install react-native-play-install-referrer

cd ios && pod install
```

npm reads the package's real name (`@blynk-deferlink/referral-mobile`) out of its
`package.json`, so it lands in your `dependencies` as
`"@blynk-deferlink/referral-mobile": "github:Newtdev/blynk-deferlink#mobile-release"`
and imports work exactly like a normal published package — no source changes
needed later.

`mobile-release` is a filtered branch containing just this package (kept in
sync with `packages/referral-mobile` on `main`); it installs straight from
TypeScript source via the `react-native` field in `package.json`, no build
step required. Once this is published to npm, switch the first line to:

```bash
npm install @blynk-deferlink/referral-mobile react-native-device-info
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

That's the whole dependency list — this SDK has no storage dependency at
all, optional or otherwise. See "Storage" below for what that actually
means and the one thing it changes about where you mount `useReferralCode()`.

> Note: earlier versions of this package (and the original project spec)
> referenced a package named `react-native-android-install-referrer`. That
> name was never published to npm — it 404s. `react-native-play-install-referrer`
> is the real, maintained package this SDK now actually uses under the hood
> ([src/platform/android.ts](src/platform/android.ts)); if you installed the
> old name, swap it for this one.

## Quick start

Wrap your app once:

```tsx
import { ReferralProvider } from '@blynk-deferlink/referral-mobile';

const referralConfig = {
  // Required — no default. Point this at your own deployed backend; see
  // docs/integration/referral-sdk.md or referral-sdk-node.md to set one up.
  apiEndpoint: 'https://your-backend.example.com/api',
  appScheme: 'myapp',
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
import { useReferralCode } from '@blynk-deferlink/referral-mobile';

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

## iOS deterministic recovery — `ReferralPasteButton`

Android has a deterministic path (Install Referrer, below). iOS has no OS
equivalent, so fingerprint matching is the only *automatic* recovery it
gets — reliable, but probabilistic. `ReferralPasteButton` adds a genuine
deterministic tier for iOS, using the system clipboard as a same-device
handoff from the web landing page (`@blynk-deferlink/referral-web`'s
`writeClipboardReferral`) to the app's first launch.

**This is required, not decorative, if you want iOS to have a
deterministic path at all — and skipping it fails silently, not loudly.**
Unlike fingerprint matching, it can't run automatically: Apple's paste
APIs only grant clipboard access from an explicit user tap, so there's no
way around rendering something tappable. If this component is never
rendered, or the user never taps it, iOS just always falls through to
fingerprint matching — no error, no signal, just quietly weaker matching
on every install. Where you place it is entirely up to you (inline on the
signup screen, a dedicated first-launch moment) — just make sure it's
somewhere:

```tsx
import { useReferralCode, ReferralPasteButton } from '@blynk-deferlink/referral-mobile';

function SignupScreen() {
  const { code, method, claim, onClipboardCode } = useReferralCode();

  return (
    <View>
      {/* Renders nothing on Android or iOS <16 — safe to always include. */}
      <ReferralPasteButton onCode={onClipboardCode} style={{ height: 44 }} />

      <TextInput value={code ?? ''} editable={!code} placeholder="Referral code (optional)" />
    </View>
  );
}
```

A tap that finds a valid, non-stale payload overrides whatever the
automatic fingerprint path already found (`method` becomes `'clipboard'`)
— deterministic exact-match is strictly more trustworthy than a score.

This ships native iOS code (a small `UIPasteControl` wrapper), which is
why `pod install` is part of the install steps above — nothing extra to
configure beyond that.

### Theming

`UIPasteControl` is a system control, not a plain button — it's genuinely
customizable, just not *arbitrarily* so. You can theme colors, corner
shape, and icon/label layout; you can't change the icon, the font, or the
label text itself. That's deliberate on Apple's part: the button's fixed,
system-owned icon+text is part of why it's allowed to skip the "would
like to paste" prompt at all — a fully reskinnable control couldn't make
that same unspoken promise to the user.

**Recommended: theme colors, keep the icon+label.** This is what
`examples/mobile` uses, and the pattern to reach for by default — it
keeps the frictionless no-prompt UX (the entire point of this tier)
while still reading as part of your app instead of a bare system
control:

```tsx
<ReferralPasteButton
  onCode={onClipboardCode}
  style={{ height: 48 }}          // match your own buttons' rendered height
  pasteForegroundColor="#FFFFFF"
  pasteBackgroundColor="#6C63FF"  // your brand color
  cornerStyle="medium"            // pick by comparing against your own buttons — see below
/>
```

`cornerStyle` has no arbitrary-radius option, only named styles
(`dynamic` | `fixed` | `capsule` | `large` | `medium` | `small`), and
none of them documents what it actually looks like — `fixed` sounds like
the obvious match for a fixed-radius design system but renders
noticeably subtler than a typical `borderRadius: 12`; `medium` was the
real match here, found by rendering the app on-device and comparing
screenshots against the surrounding buttons, not by reading the name.
Expect to do the same comparison against your own button style rather
than trust the name.

If even the system icon/label reads as too "systemy" next to the rest of
your design system, drop to `displayMode="iconOnly"` and put your own
on-brand copy beside it in JS instead — the control shrinks to just the
consent-granting tap target, and the text becomes yours to fully own:

```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
  <Text style={yourBrandTextStyle}>Have a code? Tap to paste →</Text>
  <ReferralPasteButton
    onCode={onClipboardCode}
    style={{ width: 32, height: 32 }}
    pasteForegroundColor="#6C63FF"
    displayMode="iconOnly"
  />
</View>
```

All four props (`pasteForegroundColor`, `pasteBackgroundColor`,
`cornerStyle`, `displayMode`) are optional — omit any of them to get the
system default for that aspect. Every one maps 1:1 to a real
`UIPasteControl.Configuration` field (`baseForegroundColor`,
`baseBackgroundColor`, `cornerStyle`, `displayMode`; full value lists in
[`ReferralPasteButton.tsx`](src/ReferralPasteButton.tsx)); nothing here
is invented.

## How recovery works

```
Mount useReferralCode() → recover()
│
├─ Android:
│   └─ Read Install Referrer → parse code + token — fully local, no network
│         ├─ code + token present → method: install_referrer
│         └─ no token / empty referrer / sideload → fingerprint match (POST /referral/match) → method: fingerprint
│
└─ iOS:
    ├─ Automatic: fingerprint match (POST /referral/match) → method: fingerprint
    └─ User taps <ReferralPasteButton>, if rendered → parse code + token from
          clipboard — fully local, no network → method: clipboard (overrides the above)
```

Every path ends in a `token` — a signed proof the click is real — attached
to the recovered code, since `/claim` now verifies it before paying out
anything (see [docs/decisions.md #21/#22](../../docs/decisions.md)). A
code with no `token` behind it is treated as no code at all: `recover()`
and `onClipboardCode()` both return `code: null` rather than a code the
app could display but `claim()` could never actually submit. Getting that
token costs nothing extra for Android or the clipboard tier — it rides
along in the same referrer param / clipboard payload the code already
comes from, so recovery there stays exactly as fast and offline-capable as
it always was; only `/claim`, once, ever needs the network to verify it.

Recovery runs once per mount, cached in memory for the rest of the
session — mounting the hook on several screens within the same session is
safe and free, no repeat network calls. There's no persistence past
that: a fresh app launch always runs recovery again from scratch. See
"Storage" below for why, and where that means this hook should (and
shouldn't) be mounted.

A conversion is recorded once per device; a second `claim()` returns
`already_claimed` — that check is entirely server-side, nothing to manage
on the client.

## Storage

The SDK persists nothing to disk — no AsyncStorage, no dependency to
install, no adapter to configure. `recover()`'s result lives in memory
only, for the current session; a fresh app launch has no memory of a
previous one. `useReferralCode()` hands you `code` directly on the call
that recovers it (or via the `onCodeFound` callback) — remembering it
past that, if you need to, is entirely your app's job, the same way
you'd store anything else (Redux, MMKV, whatever you already have). See
"Claiming a code in a later session" below for that case.

**This changes where you should mount `useReferralCode()`.** `/match` is
rate-limited per device (default 5/day, server-enforced). Because nothing
here persists "has recovery already run," calling `recover()`
unconditionally on *every* app launch — e.g. from a provider mounted at
your app's root, alongside navigation — will re-hit `/match` on every
single cold start, and a normally-active user reopening the app more
than a handful of times in a day will burn through that budget on
routine opens, possibly before a real match ever gets the chance to run.

Mount it on a **one-time flow instead** — a signup or onboarding screen a
given install visits once, not something that mounts on every app open.
That's not a hypothetical: it's the actual integration pattern this was
designed around (referral recovery only ever matters once, at signup).
If your app's architecture makes that hard to guarantee — e.g. a single
top-level provider that can't easily be scoped to just the signup
flow — track "already attempted" yourself (a single boolean in whatever
storage you already have) and skip mounting the hook, or skip calling
`claim()`, once that's true. This SDK deliberately doesn't do that for
you anymore; duplicate-*signup* protection was never this flag's job
anyway (that's `referral_conversions`' unique `device_id` index,
entirely server-side) — it only ever protected against wasting the
match-rate-limit budget, and that's now on your app to manage if your
mount point doesn't already guarantee it naturally.

### Claiming across sessions isn't possible anymore

Call `claim(userId)` right after `useReferralCode()` recovers a code, in the
same session — that's the only case `claim()` supports now. There's no
`code` override parameter anymore: `/claim` requires a signed `token`
proving a real click happened (see
[docs/decisions.md #21/#22](../../docs/decisions.md)), and this SDK
persists nothing that could supply a valid one for a code recovered in an
earlier session, even if your app stored the code string itself. Passing a
self-stored code straight to the backend without a real token behind it
would just get rejected with `unverified_claim` — there's no legitimate way
around going through recovery again.

If your signup flow can genuinely span app restarts, call
`useReferralCode()` (or mount it) again when the user resumes — recovery
itself is safe to re-run (it's rate-limited server-side, not blocked
client-side), it just costs another `/match` call against that budget.

## Manual fallback

If a match fails (common when an iOS user switches networks between click and
install), `code` is `null`. Keep the referral field editable so the user can
type the code from the landing page by hand.

**A manually-typed code can't go through this SDK's `claim()`.** `/claim`
requires a signed `token` proving a real click happened (see
[docs/decisions.md #21/#22](../../docs/decisions.md)) — a code the user typed in
by hand was never locked to anything, so there's nothing to submit. If you
need to honor a manually-entered code anyway, that has to be a separate path
in your own backend (e.g. crediting the referrer directly, possibly with
lighter-weight review than the automatic flow gets) — this SDK doesn't
provide one, since it can't verify a typed code the way it verifies a
recovered one.

## Config reference

| Field | Required | Description |
|-------|----------|-------------|
| `apiEndpoint` | **yes** | Base URL of your referral backend. No default — see [`docs/integration/referral-sdk.md`](../../docs/integration/referral-sdk.md) or [`referral-sdk-node.md`](../../docs/integration/referral-sdk-node.md) to set one up. |
| `appScheme` | no | Custom scheme for deep-link handling. |
| `matchTimeoutMs` | no | Max wait for the match request (default 5000). |
| `matchWindow` / `minConfidence` | no | Informational; the server enforces both. |
| `onCodeFound` / `onNoCode` | no | Recovery callbacks. |

## Build

```bash
npm install && npm run build   # emits ESM + CJS + .d.ts to dist/
```
