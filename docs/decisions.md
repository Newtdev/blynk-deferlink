# Decisions log

What changed, why, and what was actually implemented — for the referral
SDK's design and engineering decisions specifically. This isn't a git
changelog (see commit history / PRs for that); it's the reasoning behind
the changes, so the "why" survives past whoever was in the room when it
was decided.

Entries are chronological. Status is one of: **Done** (implemented and
merged), **Decided** (design settled, not yet built), **Proposed**
(written up, awaiting a decision), **Rejected** (considered and
deliberately not done — kept here so it doesn't get re-proposed and
re-litigated from scratch later without the reasoning that already ruled
it out).

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

**Known limitations, surfaced reviewing this externally (worth recording,
not acted on as changes):**
- The decay curve depends entirely on `matchWindowHours` (default 48).
  Recency stays above the ~10-point "crucial" mark (the amount needed,
  combined with every other signal matching, to clear 70 without an IP
  match) for roughly **16 hours** post-click at that default — not
  minutes. Worth knowing the real number before reasoning about how much
  the recency signal actually buys back after a network switch.
- **Near-simultaneous similar devices can still collide.** Two iPhones of
  the same model, same city, clicking within moments of each other look
  close to identical to the matcher — Safari's iOS user agent is heavily
  generalized, so device/screen/timezone/language alone don't reliably
  distinguish them. Combined with `ORDER BY created_at DESC` (last-click-
  wins on ties), a genuine ambiguous case resolves to whichever click was
  most recent, which won't always be the correct one. Not a regression
  from recency scoring — a pre-existing characteristic of coarse-grained
  probabilistic matching that recency doesn't fix and slightly increases
  the surface area for (see rejected proposal below).

---

## 1a. Dynamic per-request weight reallocation when IP is absent — Rejected

**Proposal considered.** When an incoming match request has no IP match,
reallocate `ip_match`'s points into `screen_dimensions` and `recency` for
that request only, instead of leaving them unused — the reasoning being
that it'd make a no-IP match easier to clear 70 in cases where recency has
already decayed significantly.

**Why it was rejected.**
1. **It doesn't solve a real gap.** A fresh install with no IP match
   already clears 70 today (75, per entry 1's math) — no reallocation
   needed for the common case. It would only change behavior for installs
   happening well after the click, which is a narrower case than it first
   appears given the real ~16 hour recency runway above.
2. **Where it would change something, it makes the known collision risk
   worse, not better.** Pumping more weight into screen dimensions and
   recency is pumping more weight into precisely the two signals already
   identified as too coarse to distinguish two different real users
   clicking around the same time (see entry 1's limitations). Solving the
   IP-absent case by leaning harder on the least-distinguishing signals
   trades one problem for a related one.
3. **It breaks the fixed-weight-per-signal mental model** the current test
   suite's exact-value assertions rely on, for a benefit that isn't
   clearly there. If IP-absent scenarios need different handling later,
   it's worth revisiting with a design that doesn't amplify the collision
   risk to get there.

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

**Worth being precise about: MMPs' custom/branded link domains don't
change this analysis.** Branch and similar MMPs let customers front their
tracking links with a custom domain (e.g. a client's own subdomain,
CNAME'd to Branch's infrastructure) — partly for branding, partly because
Universal Links' domain-verification mechanism often requires it. It's
tempting to read that as making the setup more first-party, but it
doesn't: the custom domain is a DNS-level/branding layer, not a change in
where the data actually goes. The click is still processed, matched, and
stored on the MMP's own servers, aggregated against their other clients'
data same as always — Apple's definition of tracking is about who
actually handles the data, not what the URL bar shows. A branded domain
makes third-party processing *look* first-party without making it so.

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

**`UIPasteControl` confirmed buildable in React Native**, spiked against
Apple's own docs rather than assumed — it's a plain `UIControl` subclass,
the exact category RN's native-component bridging is built for, and its
self-contained touch handling avoids the usual gesture-conflict pain of
wrapping an interactive native view. No existing npm package wraps it, so
it needs a small custom native module (~1–3 days). Committing to it over
the plain system-prompt fallback. Full reasoning in the iOS doc.

**Two additions from an external review of this plan, both folded into
the iOS doc:**
- **Clear the clipboard immediately after a successful read.** Prevents
  the referral token from lingering and getting pasted somewhere
  unrelated by accident later. Small addition, worth doing.
- **In-app browsers (WhatsApp, Instagram) commonly restrict or fully
  block clipboard write access** — and this project already special-cases
  those browsers elsewhere (`InAppBrowserNotice.tsx`), suggesting a real
  share of referral traffic arrives through them. If so, the clipboard
  tier may simply be unavailable for a meaningful chunk of real clicks —
  fingerprint matching stays load-bearing in practice, not a rare
  backstop. This wasn't flagged in the original design and is worth being
  explicit about rather than implying clipboard mostly replaces it.

---

## 7. Separate the SDK's production website from the example app — Dropped

**Problem.** `examples/web` is currently doing double duty: it's meant to
be a demo/reference implementation for engineers integrating the SDK, but
it's *also* the thing actually deployed and live-tested against
(`referral-web-demo.vercel.app`). That conflation is part of why bugs #3
and #4 above were as confusing as they were to track down — "the demo"
and "the real thing being tested" were the same deployment.

**Direction considered.** Split into two: `examples/web` stays a minimal
reference implementation, and a separate app becomes the SDK's actual
production website (the one hosted on Vercel for real).

**Decision: not doing this.** Revisited after the other three items in
this batch shipped (docs merge, storage scope, iOS clipboard tier) —
decided to leave `examples/web` doing double duty as-is rather than split
it. Not implemented; `examples/web` remains both the reference
implementation and the live deployment.

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

---

## 12. Privacy Manifest declaration for device model access — Rejected

**Claim reviewed.** An external review (an AI-assisted second opinion,
not a first-hand audit) of `packages/referral-mobile/src/fingerprint.ts`
asserted that `DeviceInfo.getModel()` accesses a Required Reason API on
iOS (via `sysctl`/`uname` for `hw.machine`) and needs a declared
`PrivacyInfo.xcprivacy` entry to avoid App Store rejection risk. It
proposed adding one.

**Checked against Apple's own documentation rather than accepted at face
value — the claim doesn't hold.** Apple's Required Reason API list is a
fixed, small set of five categories: `FileTimestamp`, `SystemBootTime`,
`DiskSpace`, `ActiveKeyboards`, `UserDefaults`. Device model access via
`sysctl`/`hw.machine` isn't one of them — there's no declared connection
between that API and any Required Reason category. The suggested fix
also contradicted itself on inspection: the example XML declared
`SystemBootTime`, not anything related to device model, while being
described as covering device-model usage — a mismatch that was the first
sign the underlying claim needed checking rather than trusting.
`DeviceInfo.getUniqueId()` (IDFV) correctly *not* requiring a declaration
was the one part of the same claim that did hold up.

**Decision: no manifest entry added.** `getModel()` was never a
restricted API to begin with — there's no real requirement to satisfy
here, and adding a mismatched declaration risks causing confusion in
review rather than preventing it.

---

## 13. `exports` map silently shadowed the `react-native` field — Done

**Problem, surfaced by the Sparkle-side integration needing a manual
patch.** `package.json` had both a top-level `"react-native": "./src/index.ts"`
field (the thing the README's "no build step required" claim depended
on) and an `"exports"` map. Per Metro's own package-exports support
(present since RN 0.72): **when `exports` exists, it takes precedence
over every top-level field, entirely** — Metro only matches conditions
that exist inside the `exports` object itself. This package's `exports`
map only had `types` / `import` / `require`, all pointing at `./dist/...`
— no `react-native` key at all. So the top-level field was never actually
consulted; Metro fell through to `require: "./dist/index.cjs"`, which
doesn't exist, since `dist/` is intentionally not built or committed for
this pre-npm-publish, ship-from-source distribution method. A second,
related failure rode along with it: `exports.types` pointed at the same
missing `./dist/index.d.ts`, so TypeScript lost all type information for
the package too — not just a bundling failure, a silent loss of types.

**Fix.** Added a `react-native` condition and pointed `types` at
`./src/index.ts` directly inside the `exports` map, matching what the
top-level fields were already trying to express. The top-level
`main`/`module`/`types` fields are left pointing at `dist/` as-is — they
describe the *eventual* real npm-published state correctly, and are
inert right now since `exports`, when present, is what every modern
resolver actually consults; nothing was resolving through them anyway.

**Follow-up needed at actual npm-publish time, not now:** once a real
`dist/` gets built and published, `exports.types` should point back to
`./dist/index.d.ts` and the `react-native` condition can point to
`./dist/index.js` (or be dropped, since a published package won't be
running from source) — this fix is specifically for the current
ship-from-source phase via the `mobile-release` branch and shouldn't be
carried forward unexamined once that changes.

---

## 14. Three bugs in the iOS clipboard tier, found only by actually running it — Done

**Problem.** The clipboard tier had been verified with `swiftc -typecheck`
against the real iOS 16 SDK and `tsc --noEmit`, but never an actual app
build — that gap was flagged explicitly at the time. Wiring
`ReferralPasteButton` into `examples/mobile` and running it on a real iOS
18.5 simulator surfaced three real bugs, none of which typechecking could
have caught:

1. **`react-native.config.js` still said `ios: null`.** Written when this
   package genuinely had no native code; never updated once the paste
   control's Swift/podspec landed. Autolinking silently skipped the
   package's iOS platform entirely — `ReferralMobilePasteControl.podspec`
   would never have reached any consuming app's `Podfile`, in any app,
   ever. Fixed by removing the `ios: null` override.

2. **Top-level `types` pointed at a stale `dist/index.d.ts`.** Classic
   TypeScript module resolution — which is Expo's own tsconfig default,
   not an edge case — ignores the `exports` map entirely and follows
   top-level `types`. A `dist/` from an old local build (Aug 13, before
   the storage-scope and clipboard-tier work) was sitting on disk,
   gitignored, silently swallowing every export added since —
   `ReferralPasteButton` included. `tsc` in the example app failed with
   "no exported member" while the package's own `tsc --noEmit` passed
   clean, because only the *consumer's* resolution mode hit the stale
   field. Fixed by pointing top-level `types` at `./src/index.ts` too
   (matching what `exports.types` already did per decision #13) and
   deleting the stale local `dist/`.

3. **`requireNativeComponent('ReferralPasteControlManager')` used the
   wrong name.** Confirmed against RN's own source
   (`RCTViewManagerModuleNameForClass` in `RCTComponentData.m`), not
   guessed: view manager registration strips a trailing `Manager` suffix
   from the Obj-C class name to get the name JS must use. The registered
   view is `ReferralPasteControl`; the manager class stays
   `ReferralPasteControlManager`. This would have thrown `"was not found
   in the UIManager"` in every consuming app, on the very first render.

**Verification, this time for real.** Built and ran `examples/mobile` on
an iOS 18.5 simulator with all three theming variants on screen; seeded
the simulator clipboard via `xcrun simctl pbcopy` with a valid
`sparkle_ref:v1:` payload; watched the control's enabled state react live
to that pasteboard change; tapped it and confirmed the full round trip
(`onPaste` → `parseClipboardReferralPayload` → `onCode` →
`onClipboardCode` → `useReferralCode()`) landed `code: PASTE-99, method:
clipboard` in the demo UI, and that the clipboard was cleared afterward.
No RN-native-module change should be called verified again until it's
been through this same real-build loop — typechecking alone missed all
three of these.

---

## 15. Real-device clipboard tier testing surfaced two more gaps — Done (diagnosis), fix pending

**Problem.** First real-device test (physical iPhone SE, real Safari →
real App Store redirect → real app install), as opposed to every prior
verification which was simulator-only. Two distinct symptoms, two
distinct causes — neither a regression in logic that worked before, both
things a simulator-only test structurally couldn't have caught.

**1. The paste button showed inactive on the real device.** Traced to
`CountdownRedirect`'s auto-redirect (`ReferralLanding.tsx`): it fires
`redirectToStore` — and therefore `writeClipboardReferral` — from a
`setTimeout` callback, with no user gesture behind it. Safari's
`navigator.clipboard.writeText()` requires a real, gesture-backed call
stack; without one it rejects. `writeClipboardReferral`'s
try/catch swallows that (deliberately — clipboard failures are meant to
fail soft, see its own doc comment), so nothing visibly breaks on the web
side and the App Store still opens on schedule, but nothing ever lands on
the clipboard. The button correctly showing inactive on the phone is the
control correctly reporting "there's genuinely nothing pasteable here" —
not a bug in the button. The bug is that the *only* path guaranteed to
reach the clipboard (a direct tap on the CTA button, preserving the
gesture) is optional — most real users just wait for the 3-second
countdown, which can never carry the payload on real Safari, no matter
what the code does. This is a hard OS restriction, not something
fixable in our code — a decision on how to handle it (skip the passive
countdown for iOS specifically? nudge users toward tapping?) is still
open.

**2. On the simulator, the button shows active but a tap pastes
nothing.** Separate cause, an API ceiling rather than a bug:
`UIPasteConfiguration(forAccepting: String.self)` enables the control for
*any* string on the pasteboard, not specifically a valid
`sparkle_ref:v1:` payload — Apple gives no way to gate paste-eligibility
on content, only on type. The simulator shares the Mac's general
pasteboard, so unrelated leftover text (including from prior
`simctl pbcopy` testing) makes the control look tappable. Tapping it
correctly finds no valid payload (`parseClipboardReferralPayload` returns
`null`) and `onCode` silently never fires — no error, nothing visible.
Not fixable at the OS-API level; worth considering surfacing an
"invalid paste" signal to the app instead of pure silence, as a UX
improvement.

**Investigating a third, related report ("fingerprint fallback didn't
happen") turned up a real observability gap, not a logic bug.** There is
no explicit "try clipboard, fall back to fingerprint on failure" trigger
in the code — the two are fully independent. `recover()` runs
fingerprint matching automatically and unconditionally on launch;
`applyClipboardCode()` only touches state when the clipboard tap actually
yields a valid payload (confirmed above it usually doesn't, on a real
device, unless the CTA was tapped directly). So a failed clipboard read
is a pure no-op — it can't overwrite or block a fingerprint result. That
means when nothing shows up, the automatic fingerprint match itself
returned no match — and every real click from this test session actually
confirms that independently: `referral_clicks.matched` was `false` for
every row, and `referral_conversions` was empty entirely, for a full day
of real-device testing.

*Why fingerprint matching itself failed is not something this
investigation could pin down.* Both backends swallow `/match` failures
into a plain `{ matched: false }` — a genuine scoring miss (IP changed
between click and install, say) is indistinguishable from a client-side
network/config error, and neither is logged anywhere server-side. Traced
the scoring algorithm itself (`fingerprintMatcher.ts`) end-to-end against
the actual stored click row for this test and found no bug in it — UA
parsing, device-model matching, and recency decay all check out correctly
against real values. The most likely explanation is an ordinary IP
mismatch (real-world network switch between browser click and app
install) compounding with something else, but this can't be confirmed
without either request logs or a reproduction with real visibility.
**Proposed follow-up, not yet built:** log match attempts (including
failed ones, with their computed score) server-side, since right now a
genuine integration bug and a genuine low-confidence miss are
indistinguishable from outside the request.

---

## 16. Default iOS store URL has no region code — likely cause of the "may not be available in your language" App Store prompt

**Problem.** `getStoreUrl()`'s default iOS fallback
(`packages/referral-web/src/utils/storeUrls.ts`) composes
`https://apps.apple.com/app/id${config.iosAppId}` — no country/region
segment. Apple's canonical App Store URL shape includes one
(`https://apps.apple.com/<country>/app/<slug>/id<id>`); a bare
`/app/id<id>` link relies on the App Store client to resolve the correct
regional storefront itself, and in practice this is the kind of link most
likely to trigger the "This app may not be available in your language"
interstitial the real-device test hit — reported right after tapping
through from our redirect to the App Store's own download button.

**Fix, not yet applied to Sparkle's own config.** `ReferralConfig`
already supports `iosStoreUrl` as a full override specifically for this
kind of case (`types.ts`) — set it to the real, regioned listing URL
(e.g. `https://apps.apple.com/ng/app/sparkle/id<APPID>`) instead of
relying on the bare `iosAppId`-only fallback. Not something the SDK's
default should hardcode a region for — a general-purpose default has no
correct single country to assume — so this is a per-project config fix,
not an SDK code fix.
