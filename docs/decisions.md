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

## 8. Client-side storage scope — Superseded by #19

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

**Decision (original).** Split what "storage" was doing into two separate
concerns that don't need to travel together:
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

**Superseded, see #19.** The idempotency guard this entry kept was later
removed too — not because the rate-limit risk it protected against was
wrong, but because the actual integration pattern (recovery scoped to a
one-time signup screen, not an always-on root component) makes it
unnecessary in practice, and the SDK shouldn't force a dependency on
every adopter to guard against a risk that only applies to a different
mounting choice.

---

## 9. Play Store / App Store links via environment variables — Done

**Problem.** `androidPackage`/`iosAppId` (or their `*StoreUrl` overrides)
were hardcoded inline in the demo app's config object. Once the SDK
website is a real, separately-deployed production site (#7), that's
fragile — redeploying with the correct real links shouldn't require a
code change.

**Decision.** Source them from environment variables on the deployed SDK
website, the same pattern `apiEndpoint` already uses via
`VITE_API_ENDPOINT`. Keeps the real store links out of source, and
redeployable without touching code.

**Implemented later than intended, and it mattered.** #7 (the website
split this was originally justified by) was later decided against — but
the underlying problem turned out to be real regardless: `iosAppId` sat
as a literal placeholder (`'123456789'`) in `examples/web/src/App.tsx`
long enough that every App Store redirect from the live
`referral-web-demo` deployment was pointing at a nonexistent listing —
confirmed via a direct request, a plain 404, not even an Apple-rendered
error page. See the correction on #16: the "may not be available in your
language" prompt reported from real-device testing predates this fix and
can't be safely attributed to the region-code theory anymore, since the
link it came from wasn't reliably pointing at the real app at all.

**Implementation.** `VITE_IOS_STORE_URL`/`VITE_ANDROID_STORE_URL` in
`examples/web/.env.production`, wired to `ReferralConfig.iosStoreUrl`/
`androidStoreUrl` (both already existed as SDK-level overrides — this was
purely about actually using them instead of the hardcoded fallback
fields). Left as empty pending the real URLs; `androidPackage`/`iosAppId`
remain as a fallback in source but should not be trusted as real values
until someone updates them too.

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

## 15. Real-device clipboard tier testing surfaced two more gaps — superseded, see #17

**Correction, added after #17 was found.** The actual root cause of every
symptom below turned out to be much simpler than either diagnosis here:
`referral-web-demo` (the site these tests ran against) hadn't
successfully deployed since **Aug 14** — two days *before* the clipboard
tier was even merged to `main` (Aug 16). Every test in this entry, and
the follow-up "90B1LD" / "active but pastes nothing" reports after it,
were run against a build with no clipboard-write code in it at all. Once
#17's deploy fix shipped the real code for the first time, the clipboard
tier worked correctly on the first two real attempts. The findings below
are still real, correct readings of the code as it existed at the time —
kept for the record, not deleted — but they were not what was actually
happening on the device. Don't treat this entry as a live diagnosis.

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

## 16. Default iOS store URL has no region code — unconfirmed as the actual cause, see #9

**Correction, added once #9 landed.** `iosAppId` was sitting as a literal
placeholder (`'123456789'`) at the time this report came in — confirmed
to 404, not even a real (if wrongly-localized) listing. The region-code
theory below is still a real, worth-fixing gap in the default URL shape,
but it can no longer be credited as *the* explanation for the original
report — that redirect wasn't reliably reaching the real app at all. Left
in place as a genuine finding, not a confirmed root cause.

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

---

## 17. `referral-web-demo`'s Vercel deploys were silently broken — Done

**Problem, found trying to ship debug logging.** `examples/web/vite.config.ts`
resolves `@sparkle/referral-web` via an alias straight to
`packages/referral-web/src/index.ts` (deliberate — ships from source, no
build step, same pattern as the mobile package). The Vercel project's
Root Directory had never been explicitly set, which meant every CLI
deploy run from inside `examples/web` — the only way it had ever been
deployed — uploaded *only* that subdirectory. The alias's relative
`../../packages/referral-web/src/index.ts` resolved outside the uploaded
tree entirely, so the build failed on literally every deploy attempt.
Nothing in the repo caught this because nothing had force-rebuilt and
redeployed `examples/web` since the source-alias approach was introduced
— the last successful production build predates it.

**Fix.** `vercel project update referral-web-demo --root-directory
examples/web`, then deploy from the **monorepo root** (not from inside
`examples/web`) so the whole tree — siblings included — actually gets
uploaded. The file count crosses Vercel's default upload limit for a
full monorepo, so root deploys need `--archive=tgz`:
```
cd <repo root>
vercel --prod --yes --archive=tgz
```
Deploying from inside `examples/web` will silently go back to the old,
broken, subtree-only behavior — the root directory setting only helps
once the *whole* tree is actually uploaded for Vercel to find it in.

---

## 18. Countdown vs. tap for the iOS clipboard tier — Decided

**Problem, left open in #15.** `writeClipboardReferral` can only succeed
from a real user gesture (Safari rejects a gesture-less
`navigator.clipboard.writeText()`). `CountdownRedirect`'s passive
auto-redirect has no gesture behind it, so it can never carry the
clipboard payload — only a direct tap on the CTA button can. Two ways to
resolve the tension: drop the passive auto-redirect for iOS entirely (force
the tap), or keep both and bias toward the tap.

**Decision: keep both, bias toward the tap.** A user who lets the
countdown auto-redirect them isn't stuck — fingerprint matching already
runs unconditionally on the app side regardless of how the redirect
happened, so they still get recovery, just the probabilistic tier instead
of the deterministic one. Forcing every iOS user to tap something to
proceed at all was judged worse than occasionally landing someone on
weaker matching.

**Implementation.** `ReferralLanding`'s `countdownSeconds` default raised
from 3 to 8. Not a logic change — the auto-redirect still fires the exact
same `redirectToStore` (and therefore still tries and fails the clipboard
write, same as before) — purely a UX nudge: a short countdown reads as
"this is about to happen automatically, no need to touch anything," a
longer one gives the CTA button time to actually be noticed and tapped
before the passive path takes over. Consuming apps can still override
`countdownSeconds` explicitly if 8s doesn't fit their landing page.

**Follow-up bug, same day.** The demo page never actually showed the new
default — `examples/web/src/App.tsx` had `countdownSeconds={3}` hardcoded
explicitly on `<ReferralLanding>`, silently overriding the SDK default
regardless of what it was changed to. Caught because the live site still
showed a 3s countdown after deploying the 8s default. Removed the
override rather than bumping it to `{8}`, so the demo stays in sync with
the SDK default automatically if it changes again.

---

## 19. Mobile SDK drops persistent storage entirely — Done

**Problem, revisited from #8.** #8 kept a minimal client-side
"already attempted recovery" flag, persisted via AsyncStorage by
default, specifically to avoid burning through `/match`'s per-device
rate limit (5/day) if `recover()` ran on every app launch.

**Pushback, and it holds up.** That risk is real only if `recover()` is
actually called on every launch — which depends entirely on *where* a
consuming app mounts `useReferralCode()`. Sparkle's (and this SDK's
intended) integration pattern mounts it on a one-time signup screen, not
an always-on root component — a given install visits that screen once
(maybe a handful of times if signup is abandoned and retried), nowhere
near 5 times in a routine day of normal app use unrelated to signup. On
top of that, the flag was never providing duplicate-*signup* protection
in the first place — that's `referral_conversions`' unique `device_id`
index, entirely server-side, unaffected by anything on the client.

**Decision.** Remove client-side persistence entirely — no AsyncStorage
dependency (required, optional, or otherwise), no `storageAdapter`
config, no idempotency flag. `recover()`'s result now lives in memory
only (`ReferralService.lastRecovery`), for the current session; a fresh
app launch always re-runs recovery. The rate-limit risk #8 was guarding
against doesn't disappear — it's now squarely the consuming app's
responsibility if their mount point can't naturally guarantee "once per
install," same as it always should have been for an app that mounts this
somewhere other than a one-time flow. Documented loudly in the README's
"Storage" section rather than silently dropped, since this SDK is meant
to be adopted beyond Sparkle, where that assumption won't always hold.

**Implementation.** `storage.ts` deleted outright.
`ReferralStorageAdapter`/`ReferralStorage`/`storageAdapter` removed from
`types.ts` and the package's exports. `ReferralService.reset()` is
synchronous now (no `await`, was clearing a persisted flag before,
now just the in-memory cache — existing `await service.reset()` call
sites still work, `await` on a non-Promise is a no-op).
`@react-native-async-storage/async-storage` removed from
`peerDependencies`/`peerDependenciesMeta` entirely, and from
`examples/mobile/package.json`. All 9 existing tests and both packages'
typechecks pass unchanged — nothing tested the removed persistence layer
directly.

---

## 20. Countdown default made platform-aware — Done

**Problem, found reviewing #18 for Android.** #18 raised
`ReferralLanding`'s countdown default from 3s to 8s, reasoning
specifically about iOS: only a direct tap on the CTA preserves the user
gesture `writeClipboardReferral` needs, so a longer countdown biases
users toward tapping instead of passively waiting. But `CountdownRedirect`
renders unconditionally for any mobile platform
(`isMobile = platform !== 'desktop'`), so Android inherited the same 8s
wait — for no reason. Android's entire deterministic mechanism is the
Play Store `referrer` param `getStoreUrl()` embeds; `writeClipboardReferral`
is explicitly gated `if (platform === 'ios')` and never runs for Android
at all. A tap and the passive auto-redirect produce an identical,
fully-deterministic outcome there — the countdown length is pure UX
friction with zero recovery-quality tradeoff either way.

**Fix.** `countdownSeconds`' default is now computed per-platform inside
`ReferralLanding` instead of a single flat default:
`countdownSeconds ?? (platform === 'ios' ? 8 : 3)`. iOS keeps the 8s
bias-toward-tap reasoning from #18 unchanged; Android reverts to the
original fast 3s, since nothing about its determinism depends on how the
user reached the store link. The prop is still a single
`countdownSeconds?: number` — an explicit value overrides both platforms
uniformly, same escape hatch as before, just not the implicit default
anymore.

---

## 21. `/claim` required no proof — full trust-boundary redesign — Done

**Problem, found by three independent adversarial reviews of the whole
repo (mine, plus two outside passes, all cross-verified line-by-line
against the actual source before acting on anything).** `POST /claim` —
the endpoint that actually distributes reward money — never verified that
the claiming device went through a real `/click` + `/match`. It trusted
`referral_code`, `device_id`, `method`, and `confidence` straight from the
request body; the only gates were `code_validator` (a no-op by default —
any non-empty code is accepted) and a check that the device hadn't
converted before (a client-chosen string, trivially rotated). `/claim` had
no rate limit at all, in either backend. The reviews' shared failure
scenario: `POST /claim {"referral_code":"<any known code>",
"device_id":"<freshly generated>", "platform":"ios",
"method":"clipboard"}`, repeated with a new `device_id` each call, minted
an unlimited number of rewards with no real click, match, or install ever
involved. `matched_device_id`/`matched_at` — written by `lockToDevice` on
every real match — were never read anywhere else; that was the actual
smoking gun; the atomic lock `/match` already performs was simply never
consulted by the endpoint that pays out.

Separately: the Node rate limiter's `SELECT count`-then-`INSERT` (not a
transaction) let concurrent requests all observe a stale under-the-limit
count and all pass — a real bug, but secondary to the endpoint with no
limit at all.

**Decision — reuse the existing atomic lock as proof, not a new signed
token.** `ClickStore.lockToDevice()` (both backends) is already a correct
atomic compare-and-swap. Rather than inventing an HMAC/signed-token scheme
(a new secret to manage, rotate, and keep in sync across two backends),
`/claim` now requires a `click_id` and verifies the referenced row is
`matched = true`, `matched_device_id` equals the submitted (hashed, per
`hash_device_ids`) `device_id`, and `referral_code` matches. A `click_id`
is a random UUIDv4 the server hands out and never leaks to anyone but the
device that owns the click — that unguessability, plus the single-use
atomic lock, *is* the proof.

This meant every recovery path needed to end in a locked click before
reaching `/claim`, including the two that never called `/match` at all:
Android's Install Referrer and iOS's clipboard tier. `/match` gained an
optional deterministic fast-path — when the request carries a `click_id`
(now embedded alongside the code in both the Play referrer param and the
clipboard payload), it skips fingerprint scoring entirely and goes
straight to a lookup + lock, inheriting the same per-device throttle the
probabilistic path already had. This also makes the previously
accepted-but-ignored `method` field on `/match`'s schema meaningful for
the first time, and finally makes decisions.md #11's stated invariant
("a `referral_conversions` row with a given `click_id` means that click
was successfully claimed") actually true — `click_id` stops being
decorative on `/claim` too.

**Implementation.**
- `referral_clicks` gained `match_method`/`match_confidence` columns,
  written by `lockToDevice` at lock time — `/claim` reads `method`/
  `confidence` from this row now, not from the claim request, closing the
  data-integrity gap alongside the trust-boundary one.
- Node's `referral_rate_limit_hits` moved from one-row-per-hit to a
  fixed-window, one-row-per-bucket-per-window counter, upserted atomically
  (`INSERT ... ON CONFLICT ... DO UPDATE SET count = count + 1 RETURNING
  count`) — fixes the check-then-act race and incidentally bounds that
  table's growth. PHP's rate limiter was already atomic (Laravel's
  cache-backed `RateLimiter::hit`), so this half was Node-only.
- A `claim` rate-limit bucket now exists in both backends (default
  10/hour/device) — previously absent entirely.
- The PHP scoring config (`Config/referral.php`) was separately found to
  have drifted: it still shipped `ip_match => 40` with no `recency` key at
  all, silently falling back to `ReferralConfig.php`'s own `recency ?? 15`
  default and pushing the real ceiling to 115 instead of 100 — a Laravel
  install running the published config scored differently than Node's
  already-rebalanced defaults. Fixed to match Node exactly
  (`ip_match: 25`, `recency: 15`, sums to 100).
- `referral-sdk-node`'s pinned `drizzle-orm` (`^0.36.0`) had a patched
  SQL-injection CVE (GHSA-gpj5-g38j-94v9) — not reachable in this codebase
  (nothing interpolates identifiers), but bumped to `^0.45.2` while it was
  cheap to do. `drizzle-kit` bumped to `^0.31.10` too; its own moderate
  advisory has no stable fixed version yet (dev/build-time only, never
  shipped).
- `examples/mock-backend/server.js` updated to mirror the new contract —
  verified end-to-end manually: a real click → deterministic match → claim
  sequence succeeds, a claim with a fully fabricated `click_id` is
  rejected `unverified_claim`, and a claim referencing a real but
  never-matched click is rejected the same way.

**Rollout.** Hard cutover, not a transition window — backend + client SDK
changes ship together; old mobile builds that predate this change (no
`click_id` sent to `/claim`) fail to claim from the moment this backend
deploys. Reasonable here since Sparkle is still in closed testing, not
live with real users; coordinated with the mobile SDK bump immediately
after merge.

**Explicitly deferred to the next increment**, not fixed here: client IP
trust (`clientIp()`'s leftmost-`X-Forwarded-For` bug, Node-only; PHP's
`$request->ip()` is safer but conditional on the host's own `TrustProxies`
config, which this SDK doesn't document as a requirement anywhere), the
remaining unbounded growth of `referral_match_attempts`, reward
distribution not being atomic with the claim insert, the web click
registration racing the app-scheme navigation beyond the minimal slice
needed here (awaiting the click before computing deterministic channels),
raw device IDs in `referral_match_attempts`' logging, and the PHP/Node
language-column-width and `languageMatches`-split divergence.

---

## 22. #21's redeem round-trip replaced with a click-time-signed token — Done

**Problem, caught in review before the client half of #21 shipped.** #21's
`/claim` fix required a `click_id` the server had actually locked — correct
for the fingerprint path, which already hits the network. But for the two
*deterministic* recovery paths (Android Install Referrer, iOS clipboard),
the implementation added a "redeem" round-trip to `/match` just to turn a
locally-readable `click_id` into a locked one *before the app could even
display a code*. That defeats the entire reason those two tiers exist:
they're deterministic and network-free specifically so recovery works
instantly, offline, without depending on the web landing page being on a
matching SDK version. Making recovery itself depend on a server round-trip
was solving #21's problem (proving `/claim` requests are legitimate) at
the wrong point in the flow — and for an integration that never even calls
`claim()` (deferred-deep-linking-only, which the READMEs explicitly
support), it was pure cost with zero benefit.

**Decision.** `/click` already runs once per landing-page visit and
already returns `click_id` for free — have it *also* return a short-lived,
HMAC-signed token (`sign(click_id, expires_at)`, one server-side secret;
`/match` mints one too, on a successful lock, for the fingerprint path).
That token rides through the Android referrer param / iOS clipboard
payload exactly like `click_id` already did — read purely locally on the
device, zero network, exactly as fast as before #21 touched anything. The
token is only ever sent over the network once, at `claim()` time, which is
when server verification should happen anyway. Verification is a cheap
HMAC compare (no DB hit for a forged/expired token) and, on success, reuses
the same atomic `lockToDevice` compare-and-swap #21 already built — either
confirming a lock `/match` made earlier (fingerprint path), or making that
lock for the first time right there (deterministic path's first real use).

This also simplified #21's implementation: the deterministic
`click_id`+`method` fast-path added to `/match` is gone — that
verification moved entirely into `/claim`, so there's one unified
claim-time check instead of two different mechanisms. `/claim`'s request
no longer includes `referral_code` at all (derived from the verified
token's click row) or `click_id` (superseded by `token`).

**Token design.** `<click_id>.<exp_unix_seconds>.<hmac_sha256_hex>` — plain
delimited text, not JWT (a UUID click_id and digits-only exp never contain
`.`, so no encoding step is needed, matching this codebase's existing
hand-rolled formats). Signed with a new required secret
(`CLICK_TOKEN_SECRET` / `click_token_secret`) — required, not optional like
`CRON_SECRET`/`ANALYTICS_SECRET`, since every `/click` needs it; an
unconfigured deploy fails loudly at first use (same pattern as
`DATABASE_URL`), not silently. `exp` is always the click's own
`expires_at` — single source of truth, no separate token-lifetime policy.
Verification uses constant-time comparison
(`crypto.timingSafeEqual`/`hash_equals`). `click_id` alone is no longer
sensitive — without the token it's useless — so it's still returned in
responses for observability.

**A real bug caught by manually smoke-testing this** (no PHPUnit runner
available in this environment, so PHP was verified by hand same as #21):
`ConversionTracker::claim()` didn't accept an injectable "now" for token
verification, defaulting to real wall-clock time. Tests that signed a
token against a fixed test date and expected it to *pass* verification
silently started failing for the wrong reason (expiry, not the thing
actually being tested) once real time moved past that fixed date — and
nothing caught it, because a verification failure and every other rejection
reason return the identical `unverified` shape. Fixed by adding an
optional `now` parameter to `claim()` in both backends (mirroring the
pattern `FingerprintMatcher.score()` and `ClickToken` itself already use),
and adding explicit "verification actually passes" tests in both
languages — not just rejection tests — that assert the happy path reaches
past the unverified-claim check (proven by an unguarded `db: null` — the
same nullable-for-testability pattern `FingerprintMatcher` already used —
throwing once claim() reaches the DB-touching part of success, rather than
returning `unverified`).

**Verified end-to-end via the mock backend**, not just unit tests: a
deterministic click → claim flow that never calls `/match` at all, a
probabilistic click → match → claim flow, and three fraud rejections
(fully fabricated token, tampered token, and a second device attempting to
claim a token whose click was already locked to the first).

**Client-side implementation (web + mobile SDKs).** This amends the
client-side work from #21 — that PR's redeem-round-trip client code never
merged, so there's no history to unwind, just the corrected version:

- `@sparkle/referral-web`'s `getStoreUrl()` embeds `token` (not `click_id`)
  in the Android referrer param once click registration resolves;
  `writeClipboardReferral()` embeds it in the clipboard payload the same
  way. `useReferralClick()`'s `waitForClick()` now resolves the token.
  `ReferralLanding`'s await-before-redirect logic and `StoreButton`'s
  `e.preventDefault()` fix (needed so an async `onClick` handler actually
  gets to finish before the anchor's own `href` navigates — see #21's
  original writeup) are unaffected by this pivot and carry over unchanged.
- `@sparkle/referral-mobile`'s `platform/android.ts`: `recoverAndroid()`
  now returns immediately once the Install Referrer yields a code + token
  — no network call, no callback, full stop. Only falls through to
  fingerprint matching when the referrer is empty or has no token (older
  web SDK version, sideload). This is the concrete fix for the problem
  this decision exists to correct: Android recovery is exactly as fast and
  offline-capable as it always was.
- The clipboard payload format's optional trailing field is now the
  token (still `.`-delimited internally, confirmed not to collide with the
  clipboard payload's own `:` delimiter — see
  `clipboardPayload.test.ts`'s combined test case). `ReferralPasteButton`'s
  `onCode` and `useReferralCode()`'s `onClipboardCode` both carry `token`
  through instead of `click_id`.
- `ReferralService.applyClipboardCode()` is synchronous again — no network
  call, just applies the parsed code + token directly, restoring the
  exact behavior it had before #21 ever touched it. `recover()`'s
  Android/iOS branches no longer need a `redeemDeterministic` callback at
  all, since nothing is redeemed at recovery time anymore.
- `claim()`'s `code?: string` override parameter is still gone (per #21 —
  that reasoning didn't change): there's no legitimate way to claim a code
  recovered in an *earlier* session, since doing so would need a token
  this session has no way to supply. The "a manually-typed code can't go
  through this SDK's `claim()`" consequence from #21 also still holds, for
  the same reason.

Verified the same way as the backend half: a wire-format check (the
built `getStoreUrl()`'s referrer param, round-tripped through
`URLSearchParams` the way `android.ts` parses it, including the token's
internal dots surviving intact) and a full mock-backend E2E using the
actual request shapes `api.ts` sends — a deterministic click → claim flow
that never calls `/match`, a probabilistic click → match → claim flow, and
the fraud-rejection cases from the backend PR.
