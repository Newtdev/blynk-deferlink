# Integrating `@blynk-deferlink/referral-mobile` (React Native)

Step-by-step setup for the React Native SDK that recovers the referral
code on first launch — deterministically on Android via the Play Install
Referrer, via fingerprint matching (and an optional deterministic
clipboard tier) on iOS — and records the conversion. This guide gets you
from nothing to a verified code-recovery flow on a real device. For full
API/config reference, see
[`packages/referral-mobile/README.md`](../../packages/referral-mobile/README.md).

## Prerequisites

- React Native ≥ 0.68.
- A running backend, reachable from your device/simulator — see
  [`referral-sdk.md`](referral-sdk.md) or [`referral-sdk-node.md`](referral-sdk-node.md).
- An **Expo dev build** (`expo run:ios` / `expo run:android`) or bare RN —
  not Expo Go. `react-native-device-info` and
  `react-native-play-install-referrer` both ship native code.

## 1. Install

```bash
npm install github:Newtdev/blynk-deferlink#mobile-release react-native-device-info

# Required for Android — not optional, see step 3:
npm install react-native-play-install-referrer

cd ios && pod install
```

`react-native-device-info` is required on both platforms — it's the only
source of `device_id`, and of iOS fingerprint data (iOS has no
install-referrer equivalent, so it's load-bearing there). Not published to
npm yet, hence the `github:` install — see the package README if that
changes.

## 2. Wrap your app

```tsx
import { ReferralProvider } from '@blynk-deferlink/referral-mobile';

const referralConfig = {
  // Required — no default. Point this at the backend from step 1 above.
  apiEndpoint: 'https://your-backend.example.com/api',
  appScheme: 'myapp',
  matchTimeoutMs: 5000,
};

export default function App() {
  return (
    <ReferralProvider config={referralConfig}>
      <NavigationContainer>{/* … */}</NavigationContainer>
    </ReferralProvider>
  );
}
```

## 3. Confirm Android's deterministic path is wired

`react-native-play-install-referrer` is **required** for Android builds,
not optional — Android has a fully deterministic recovery path and there's
no reason to settle for the weaker probabilistic one by default. If it's
missing, `useReferralCode()` throws a clear error rather than silently
falling back to fingerprint matching. (An iOS-only build never touches
this dependency at all — skip it if you're not shipping Android yet.)

## 4. Mount the hook on your signup/onboarding screen — not your app root

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
        editable={!code}
        placeholder="Referral code (optional)"
      />
      {code ? <Text>🎁 Referral bonus will be applied</Text> : null}
    </View>
  );
}
```

**This placement matters.** `/match` is rate-limited per device (default
5/day, server-enforced), and the SDK persists nothing between app
launches. Mounting this at your app's root — so it re-runs on every cold
start — burns through that budget on routine opens. Mount it on a
one-time flow a given install visits once instead. See the README's
"Storage" section if your architecture makes that hard to guarantee.

## 5. Add the iOS deterministic tier

iOS has no install-referrer equivalent, so fingerprint matching is its
only *automatic* recovery — reliable, but probabilistic.
`ReferralPasteButton` adds a genuine deterministic tier via the system
clipboard, but **it doesn't run automatically** — Apple's paste APIs only
grant clipboard access from an explicit tap, so skipping this component
means iOS silently falls back to fingerprint matching with no error, no
signal. Render it somewhere in your signup flow:

```tsx
import { useReferralCode, ReferralPasteButton } from '@blynk-deferlink/referral-mobile';

function SignupScreen() {
  const { code, claim, onClipboardCode } = useReferralCode();

  return (
    <View>
      {/* Renders nothing on Android or iOS <16 — safe to always include. */}
      <ReferralPasteButton onCode={onClipboardCode} style={{ height: 44 }} />
      <TextInput value={code ?? ''} editable={!code} placeholder="Referral code (optional)" />
    </View>
  );
}
```

See the README's theming section if the default system-styled button
needs to match your design system.

## 6. Verify: a real code recovery + claim, on-device

Simulator/emulator fingerprint matching works, but Install Referrer and
the clipboard tier both need a **real device** (or at minimum a real
store-installed build for Android) to exercise properly.

1. Generate a real click + token against your backend (step 5/7 of the
   backend guides — a `curl POST /click` gives you a token you can embed
   in a test link).
2. Android: install via a Play Store test track link carrying that
   referrer data, or manually seed the Install Referrer for local testing
   per `react-native-play-install-referrer`'s own docs. iOS: visit your
   `@blynk-deferlink/referral-web` landing page on the device first (writes the
   clipboard payload), then open the app and tap `ReferralPasteButton`.
3. Confirm `useReferralCode()` returns the expected `code` and the right
   `method` (`install_referrer`, `fingerprint`, or `clipboard`).
4. Call `claim(userId)` and confirm it resolves without throwing — then
   check the backend's `referral_conversions` table for the new row.

If the code and method come back as expected and the claim lands a row on
the backend, the mobile integration is correctly wired end-to-end.
