# Decisions log

What changed, why, and what was actually implemented — for the referral
SDK's design and engineering decisions specifically. This isn't a git
changelog (see commit history / PRs for that); it's the reasoning behind
the changes, so the "why" survives past whoever was in the room when it
was decided.

Entries are chronological. Status is one of: **Done** (implemented and
merged), **Decided** (design settled, not yet built), **Proposed**
(written up, awaiting a decision).

---

## 1. Graduated recency scoring in fingerprint matching — Done

**Problem.** Fingerprint matching's default weights made an IP mismatch
fatal on its own: without it, the best possible score from every other
signal combined (device model, screen, timezone, language) was 60 —
always below the 70-point match threshold, regardless of how well
everything else lined up. In practice, this meant a network switch
between the web click and opening the app (WiFi → cellular, carrier NAT
reassigning an address, a VPN) could silently fail a match for the
correct device on the correct install.

**Decision.** Add a graduated recency signal — full credit at the click,
decaying linearly to zero at the edge of the match window — and lower
`ip_match`'s weight from 40 to 25 to keep the scale at 100. A fresh
install with no IP match but everything else aligned can now reach
25(device)+15(screen)+10(tz)+10(lang)+15(recency) = 75, clearing 70. A
stale one (recency fully decayed) still correctly fails at 60.

**Implementation.** `packages/referral-sdk-node/src/services/fingerprintMatcher.ts`
and its PHP mirror in `packages/referral-sdk`. `score()` takes an explicit
`now` parameter (defaults to the real current time) specifically so the
decay curve stays unit-testable without wall-clock flakiness. Both
backends' test suites were extended for the new behavior and re-verified
against each other (Node's `node:test`, PHP's zero-dependency
`tests/run.php`) since the two matchers are required to agree on what
counts as a match.

---

## 2. `react-native-play-install-referrer` made a required peer dependency — Done

**Problem.** Android had a reliable, deterministic recovery path (Google
Play Install Referrer) sitting right next to the probabilistic
fingerprint path, but the native module backing it was only an *optional*
peer dependency — if a consuming app never installed it, Android silently
fell back to the weaker probabilistic path with no indication anything
was missing.

**Decision.** Make it required. Given a genuinely deterministic path
exists for Android, there's no good reason to let a project settle for
the fallback by omission. If it's missing, fail loudly.

**Implementation.** `packages/referral-mobile/package.json` —
`react-native-play-install-referrer` removed from `peerDependenciesMeta`'s
optional list. `readInstallReferrer()`
(`packages/referral-mobile/src/platform/android.ts`) now throws a clear,
actionable error instead of silently returning `null` when the module
can't be required. The throw happens before `markProcessed()` is called,
so a missing-dependency error doesn't get permanently cached as "no code
found" for that install.

---

## 3. Referral link path parsing bug (`examples/web`) — Done

**Problem.** `readCode()` on the demo landing page only recognized
`?code=` and `/code=` URL shapes. Real referral links use `/referral/:code`
— which matched neither, so it silently fell through to a hardcoded
`'1234'` placeholder that happened to also be a real seeded code in the
database. Result: visiting a real link recorded a click under the wrong
code, with no error — it looked like it worked.

**Implementation.** `examples/web/src/App.tsx` — added a `/referral/:code`
match, and turned the final fallback from silent into a `console.warn`,
so a routing mismatch is now visible instead of quietly masquerading as a
different, real code.

---

## 4. `vercel.json` routing misconfiguration — Done

**Problem.** The SPA rewrite config (`/(.*) → /index.html`) lived in
`examples/web/public/vercel.json`. Vite copies `public/` verbatim into
`dist/` as a static asset — it isn't read as routing config from there.
Vercel only reads `vercel.json` from the project root. Net effect: the
rewrite never applied, and any path deeper than `/` 404'd on the live
deployment.

**Implementation.** Moved to `examples/web/vercel.json` (project root).
Caught while redeploying to verify the fix for #3 above — worth noting
since it means the referral link bug (#3) may have been masked by this
one for longer than it looks, depending on which was hit first on any
given test.

---

## 5. Apple App Tracking Transparency (ATT) compliance review — Done (research), ongoing relevance

**Question.** Does fingerprint-based referral matching require the ATT
permission prompt, risking App Store rejection if skipped?

**Finding, checked against Apple's current developer documentation
directly (not from memory):** Apple defines "tracking" specifically as
linking data with **other companies'** apps, websites, or offline
properties for advertising/measurement, or sharing with data brokers.
First-party matching — a company's own website linked to that same
company's own app, for that company's own attribution, with the data
never leaving that company's infrastructure — is explicitly exempted in
Apple's own FAQ. Our fingerprint matcher is exactly that shape: click and
install both stay inside Sparkle's own backend the whole time.

**A separate, important finding from the same research:** integrating a
third-party Mobile Measurement Partner (Branch, AppsFlyer) to *reduce*
this risk would likely do the opposite. MMPs are themselves another
company, and their fingerprinting accuracy depends on aggregating device
data across every client app on their SDK — a form of cross-company
sharing our own first-party-only setup doesn't have. Their own
integration docs recommend/require implementing ATT. Staying first-party
and in-house is the more defensible position, not the riskier one.

**Not covered by this exemption, and still required regardless:** proper
App Store Privacy Nutrition Label disclosure for the device identifiers
collected — that's a separate, mandatory step independent of the ATT
question.

**Practical caveat:** this reasoning depends on the backend and landing
page genuinely being Sparkle-owned infrastructure by the time this ships
— not a personal/generic Vercel subdomain, which would muddy the
first-party argument both to Apple and in general. See action item on
the website split, below.

---

## 6. Deterministic deferred deep linking for iOS (clipboard handoff) — Decided (design), not yet built

Full writeup: [`ios-deterministic-deferred-deep-linking.md`](./ios-deterministic-deferred-deep-linking.md).

**Problem.** iOS has no equivalent to Android's Install Referrer — it's
fingerprint-only, which is why #1 above (recency scoring) exists at all.

**Decision.** Add a deterministic tier ahead of fingerprint matching,
using the iOS clipboard as a same-device handoff: the web page writes the
referral code to the clipboard right before redirecting to the App Store;
the app reads it back on first launch. Fingerprint matching stays exactly
as-is, now demoted from "the only path" to "the fallback" — mirrors
Android's existing install-referrer-first, fingerprint-fallback shape.

Key sub-decisions (detailed in the linked doc):
- The paste UI is exposed as an SDK-provided function/component; the
  consuming app decides *where* it lives, but the README must state
  plainly that skipping it means iOS never gets the deterministic path.
- Payload staleness reuses the existing match-window config rather than a
  second, separate window.
- No dedicated analytics event needed from the SDK for a denied prompt —
  Sparkle has its own event infrastructure for that; the SDK just needs
  to expose it through existing callbacks.

**Still open:** whether `UIPasteControl` (the prompt-free variant) is
realistically wrappable in React Native — needs a short spike before
committing to it over the plain system-prompt read.

---

## 7. Separate the SDK's production website from the example app — Proposed

**Problem.** `examples/web` is currently doing double duty: it's meant to
be a demo/reference implementation for engineers integrating the SDK, but
it's *also* the thing actually deployed and live-tested against
(`referral-web-demo.vercel.app`). That conflation is part of why bugs #3
and #4 above were as confusing as they were to track down — "the demo"
and "the real thing being tested" were the same deployment.

**Direction.** Split into two: `examples/web` stays a minimal reference
implementation, and a separate app becomes the SDK's actual production
website (the one hosted on Vercel for real). Exact location/naming
(`apps/web`, a new top-level directory, etc.) still to be settled during
implementation.

---

## 8. Client-side storage scope — Decided

**Problem.** Should the mobile SDK keep owning local persistence
(currently: AsyncStorage by default, `storageAdapter` as an opt-in
override) given most consuming apps already have their own storage layer
(Redux, MMKV)?

**Finding that shapes the decision:** the `/match` endpoint is rate
limited per device (`rateLimitMatchesPerDay`, default 5/day —
`packages/referral-sdk-node/src/config.ts`). If the SDK stopped tracking
"has recovery already run for this install" entirely and `recover()` ran
on every app launch, a normally-active user opening the app more than 5
times in a day would exhaust that budget on routine opens alone —
possibly before a legitimate match ever got the chance to run. This isn't
a hypothetical edge case; it's the default configuration.

**Decision.** Split what "storage" was doing into two separate concerns
that don't need to travel together:
- **Idempotency guard** ("has this install already attempted recovery?")
  — stays, because of the rate-limit interaction above. Doesn't need to
  be much: a boolean-ish "attempted" flag, not the full stored
  code/method/confidence/claimed record that exists today.
- **Code storage for the app's own use** (prefilling UI, remembering it
  across screens) — this is what gets removed from the SDK's
  responsibility. `useReferralCode()` already returns `code` directly on
  the call that recovers it; the consuming app is free to persist and
  display it however it wants (Redux, MMKV, whatever it already has) from
  that point on, with no need for the SDK to also keep its own copy.

Net effect: much smaller SDK-internal storage footprint, no duplicated
state between the SDK and the app's own store, and the rate-limit hazard
that would come from removing the guard entirely is avoided.

---

## 9. Play Store / App Store links via environment variables — Decided

**Problem.** `androidPackage`/`iosAppId` (or their `*StoreUrl` overrides)
were hardcoded inline in the demo app's config object. Once the SDK
website is a real, separately-deployed production site (#7), that's
fragile — redeploying with the correct real links shouldn't require a
code change.

**Decision.** Source them from environment variables on the deployed SDK
website, the same pattern `apiEndpoint` already uses via
`VITE_API_ENDPOINT`. Keeps the real store links out of source, and
redeployable without touching code.

---

## 10. Open-source-ready documentation for backend and frontend — Proposed, in progress

**Goal, as stated directly:** "plug and play" — since this will be open
sourced, an engineer with no prior context on this project should be able
to integrate any of the packages (backend or frontend) correctly from the
README alone. This is a standing initiative rather than a single change;
package READMEs get audited/improved against that bar as the rest of this
list gets implemented, not as one big separate pass.

---

## 11. Clearing redeemed click/fingerprint data from the database — Proposed

**Question asked:** how do we know a code has been redeemed, and can we
clear its data afterward?

**Redeemed is already unambiguous in the existing data model** — a row in
`referral_conversions` with a given `click_id` means that click was
successfully claimed (there's a unique index on `deviceId`: one referral
per device, lifetime). No new tracking needed to answer "was this
redeemed."

**What's missing is cleanup for the matched/claimed case.** The existing
job, `CleanupExpiredClicks`
(`packages/referral-sdk/src/Commands/CleanupExpiredClicks.php`), only
deletes clicks that expired **unmatched** — nothing currently purges the
raw fingerprint/IP data out of `referral_clicks` once a click has been
successfully matched and claimed.

**Proposed design.** A grace period (7–30 days, exact number TBD) after a
claim before purging that click's fingerprint/IP data from
`referral_clicks`, keeping the much smaller `referral_conversions` row
indefinitely for reporting. The grace period exists deliberately, not
just for caution: a match and a claim are two distinct moments
(`useReferralCode()` can recover a code well before the user actually
completes signup and calls `claim()`), so purging too eagerly right after
a match risks deleting data a legitimate, slightly-delayed claim still
needs.
