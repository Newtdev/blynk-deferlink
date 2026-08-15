# iOS deterministic deferred deep linking (clipboard handoff)

Status: proposed, not yet built.
Touches: `packages/referral-web`, `packages/referral-mobile`, `packages/referral-sdk-node` / `packages/referral-sdk` (backend, minor).

## Why this doc exists

Android already has a deterministic recovery path (Google Play Install
Referrer — see [`packages/referral-mobile/src/platform/android.ts`](../packages/referral-mobile/src/platform/android.ts)).
iOS has no equivalent OS-level mechanism, so it falls back entirely to
probabilistic fingerprint matching (device model, screen, timezone,
language, IP, recency — see
[`fingerprintMatcher.ts`](../packages/referral-sdk-node/src/services/fingerprintMatcher.ts)).
Fingerprint matching works, but it's inherently probabilistic — an IP
change between the web click and the app open (network switch, carrier
NAT) can still lose the match even with recency scoring compensating for
some of it.

This doc maps out adding a **deterministic** iOS path — the clipboard
handoff technique Branch productized as "NativeLink" — as a new first
attempt, with the existing fingerprint matcher staying in place as the
fallback. Same shape as Android already has: deterministic path first,
probabilistic fallback second.

## How it works

The web click and the app's first launch happen on the *same physical
device*, moments apart. The iOS system clipboard is the one piece of
state that survives that whole journey (Safari → App Store → install →
first launch) without needing any network round-trip or device fingerprint
at all:

```
1. User taps "Download" on the referral landing page (web).
2. Before redirecting to the App Store, JS writes a small payload to the
   clipboard: the referral code + an issued timestamp.
3. User installs and opens the app for the first time.
4. The app reads the clipboard, validates the payload (see below), and
   recovers the code — no network call needed for the match itself.
5. If the payload is missing, unreadable, or stale, fall through to the
   existing fingerprint-match flow unchanged.
```

Because this never leaves the device, it isn't "tracking" under Apple's
own ATT definition (linking data with *another company's* apps/websites) —
it's on-device, first-party, momentary. It doesn't require the ATT prompt.

## Benefits

- **Deterministic, not probabilistic** — when the payload is present and
  readable, this is a precise match, not a scored guess. No IP-mismatch
  failure mode at all — the whole reason recency scoring exists on the
  fingerprint side doesn't apply here, because nothing about it depends on
  network conditions.
- **No ATT requirement.** On-device, first-party, one-time — doesn't meet
  Apple's own "linking with another company's data" definition of tracking.
- **No third-party vendor.** This is a buildable, documented pattern (not
  Branch-exclusive proprietary tech) — no MMP subscription, no new company
  in the data path. That matters beyond cost: bringing in an MMP (Branch,
  AppsFlyer) is *more* likely to trigger an ATT requirement than avoid one,
  since their fingerprinting accuracy depends on aggregating device data
  across every client app using their SDK — a form of third-party sharing
  our current first-party-only setup doesn't have. See the ATT discussion
  earlier in this project's history for the full reasoning.
- **Symmetric with Android.** Same two-tier shape: deterministic primary,
  fingerprint fallback. Easier to reason about and document as one
  consistent story across platforms.
- **Doesn't throw away existing work.** The fingerprint matcher and its
  recency scoring remain fully in use, as the fallback tier — not wasted,
  just demoted from "the only path" to "the safety net."

## Downsides / risks

- **Not silent on iOS 16+.** Reading the general pasteboard triggers a
  system prompt — *"[App] would like to paste from Safari"* — Allow /
  Don't Allow. Pre-iOS 16 this was just a passive banner; it's now an
  actual permission gate the user can decline. If declined, we lose the
  clipboard signal for that launch and fall through to fingerprint
  matching — acceptable degradation, but worth knowing it isn't invisible.
- **`UIPasteControl` avoids the prompt, but only with a visible tap.**
  Apple's sanctioned prompt-free path requires the user to tap an actual
  system-provided paste button — it can't be read automatically on launch
  without either that explicit tap or the system prompt. This is a real
  UX design decision, not just a technical detail (see "Open questions").
- **Clipboard can be overwritten.** If the user copies something else
  between tapping the link and opening the app (rare, but not impossible —
  e.g. they copy a password while poking around before opening the new
  app), the payload is gone. Falls through to fingerprint matching, same
  as a denied prompt.
- **New engineering surface on both ends.** Web needs a clipboard-write
  step wired into the download CTA; mobile needs a clipboard-read step,
  permission-prompt UX handling, and payload validation. Not a small
  change on either side.
- **`UIPasteControl` React Native support is unconfirmed.** It's a
  relatively new, low-level UIKit widget. Existing RN clipboard packages
  (e.g. `@react-native-clipboard/clipboard`) wrap the plain read API, not
  necessarily `UIPasteControl` — may need a small native module bridge if
  we want the prompt-free variant. Needs a spike before committing to that
  UX direction.
- **Still needs a staleness guard.** Without one, a referral code copied
  weeks ago for an unrelated reason could get matched to today's
  unrelated install. The payload needs an issued timestamp and a max-age
  check (proposed: same match window used by fingerprint matching, for
  one consistent "how long is a click valid" story).
- **Not literally 100%, despite "deterministic."** Deterministic describes
  the matching *logic* (exact payload match, no scoring) — it doesn't mean
  the signal is guaranteed to be present. Permission can be denied, the
  clipboard can be overwritten. This is an additive improvement to the
  recovery rate, not a replacement that removes the need for a fallback.

## Comparison

| | Current (fingerprint only) | Proposed (clipboard + fingerprint fallback) | MMP (Branch/AppsFlyer) |
|---|---|---|---|
| Determinism | Probabilistic | Deterministic (primary), probabilistic (fallback) | Probabilistic on iOS (their own docs) |
| Requires ATT prompt | No (first-party) | No (first-party, on-device) | Typically yes — their docs recommend/require it |
| Data leaves Sparkle's infra | No | No | Yes — aggregated across their client base |
| Vendor cost / lock-in | None | None | Subscription, vendor dependency |
| New user-facing UI | None | iOS 16+ paste prompt (or a tap-to-continue button) | Varies by vendor SDK |
| Matches Android's two-tier shape | N/A (Android already deterministic-first) | Yes | Yes, but via a third party |
| Engineering effort | Already built | Web + mobile changes, moderate | SDK integration, but their heuristics |

## Fallback chain (both platforms, after this change)

```
Android: Install Referrer (deterministic) → fingerprint match (fallback)
iOS:     Clipboard payload (deterministic) → fingerprint match (fallback)
Both:    → manual code entry (existing UI fallback, unchanged)
```

## Proposed payload format

A small, self-validating string rather than raw JSON, so a stray clipboard
value (a password, a copied link from somewhere unrelated) is trivially
rejected rather than misread as a match:

```
sparkle_ref:v1:<code>:<issued_unix_ts>
```

Mobile-side validation before trusting it:
1. Starts with `sparkle_ref:v1:` — otherwise it's not ours, ignore.
2. `issued_unix_ts` is within the configured match window (same window
   fingerprint matching already uses) — otherwise treat as stale, ignore.
3. `<code>` passes the existing `code_validator` (already configurable in
   both backends) if the app wants to confirm it server-side before
   trusting it fully.

## Implementation sketch

- **`packages/referral-web`**: on the download CTA's click handler,
  before navigating to the store, `navigator.clipboard.writeText(payload)`.
  Needs a secure context (already HTTPS) and a user gesture (the click
  itself satisfies this).
- **`packages/referral-mobile`**: a new `readClipboardReferral()`
  alongside `readInstallReferrer()` in `src/platform/`, wired into
  `recoverIos()` as the first attempt, falling through to the existing
  `matchViaFingerprint()` on any failure (missing, denied, malformed, or
  stale payload) — mirrors how `recoverAndroid()` already falls through
  from install referrer to fingerprint matching today.
- **Types**: extend `MatchMethod` (`'install_referrer' | 'fingerprint'`)
  with `'clipboard'` so `onCodeFound` / analytics can distinguish it.
- **Backend**: likely no schema changes required — claim/match already
  accept an arbitrary method string for logging purposes. Confirm during
  implementation.

## Open questions to resolve before building

1. **Prompt vs. `UIPasteControl`?** The plain read is simpler to build but
   shows the system "would like to paste" dialog on every fresh install.
   `UIPasteControl` avoids that but needs a visible button and a small
   native-module spike to confirm RN support. Worth a short spike before
   deciding.
2. **Max payload age** — reuse the existing match-window config, or a
   shorter, clipboard-specific window (the clipboard scenario is a much
   tighter, same-session timeframe than the 48h fingerprint window)?
3. Does a denied paste-prompt need its own analytics event, separate from
   "no code found," so it's distinguishable in metrics from a genuine miss?
