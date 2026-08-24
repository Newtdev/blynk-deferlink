# Publishing the Blynk Recovery Demo to Play Console — Internal Testing

Everything in `examples/mobile` and the `/privacy` page is ready. What's
left needs your own Expo and Google Play accounts — none of it can be run
from here. This is the exact sequence, with copy-pasteable answers for the
Play Console forms so you're not improvising in the UI.

## 1. Build

```bash
cd examples/mobile
eas login              # your own Expo account — NOT samuelowad/petezy,
                        # whichever of those `eas whoami` shows on this
                        # machine belongs to someone else
eas build --platform android --profile production
```

First run creates a new EAS project under your account (no project id was
committed to `app.json` on purpose — this step does that). Takes roughly
10–20 minutes; downloads a `.aab` when done.

## 2. Play Console — create the app

- App name: **Blynk Recovery Demo**
- Package name: **`dev.blynkdeferlink.demo`** (matches `app.json`, must be
  exact and can't change later)
- App or game: **App**. Free.

## 3. App content questionnaire

- **Privacy policy URL**: `https://referral-web-demo.vercel.app/privacy`
  (ships in this PR — [`examples/web/src/PrivacyPage.tsx`](../examples/web/src/PrivacyPage.tsx))
- **Data safety form** — declare honestly, matching the privacy page:
  | Data type | Collected? | Purpose | Shared with third parties? |
  |---|---|---|---|
  | Device or other IDs | Yes | App functionality (referral matching) | No |
  | App info and performance | No | — | — |
  | Personal info (name/email/etc.) | No | — | — |
  | Location | No | — | — |
  All other categories: **No**. Encrypted in transit: **Yes**. Users can
  request deletion: **No** (nothing is tied to an identifiable user —
  records age out automatically instead, see the privacy page).
- **Content rating questionnaire**: this is a developer tool / demo, no
  user-generated content, no violence/gambling/etc. — answer "No" to
  everything category-specific; should land on "Everyone."
- **Target audience**: 18+ (this is a developer-facing demo, not aimed at
  children — simplest, safest answer, avoids the extra COPPA-related
  questions Google asks for anything that could include under-13 users).
- **App category**: Tools or Developer Tools (whichever Play Console
  offers closest to that).
- **Store listing short description** (80 chars max):
  > Live demo of blynk-deferlink, an open-source deferred deep linking SDK.
- **Store listing full description**:
  > Blynk Recovery Demo shows blynk-deferlink's referral/attribution
  > recovery working end-to-end, against the real open-source backend —
  > no mocks. Tap through the 3 steps on screen to see a referral link
  > registered, then recovered exactly like a production app would:
  > deterministically via Android's Install Referrer, or by fingerprint
  > match when that's not available.
  >
  > This is a developer-facing demo for evaluating the SDK, not a
  > consumer app. Source: github.com/Newtdev/blynk-deferlink

## 4. Internal testing track

- Play Console → **Testing → Internal testing** → **Create new release**.
- Upload the `.aab` from step 1.
- Release name/notes: `1.0.0 — initial demo build`.
- Add testers: use **"anyone with the link can join as a tester"** (an
  opt-in URL, not individual email invites) so it's shareable publicly
  without a 100-name allowlist.
- Roll out. No review wait on this track — live within minutes.

## 5. After it's live

- Copy the opt-in link from the Internal testing page and send it back —
  the root README's "try it live" section should list it alongside the
  browser `/demo` once you have it.
- Install it on a real device yourself first and tap through all 3 steps
  before sharing the link further — confirms the Install Referrer path
  actually works against the live backend, not just that the build
  succeeded.
