# Integration guides

Step-by-step setup for each SDK in this monorepo — zero to a verified,
working state for that piece alone. For API/config *reference* rather
than a walkthrough, see each package's own README instead; these guides
link out to the relevant section there when it's worth reading in full.

Pick one backend, then set up web and/or mobile against it, in this order:

1. **Backend** (pick one, not both):
   - [`referral-sdk.md`](referral-sdk.md) — PHP / Laravel or standalone.
   - [`referral-sdk-node.md`](referral-sdk-node.md) — Node/Express +
     Postgres, deployable to Vercel.

   Both expose the same API contract, so the web/mobile SDKs below don't
   care which one is behind `apiEndpoint`.

2. **Landing page** — [`referral-web.md`](referral-web.md). Needs a
   reachable backend from step 1 first.

3. **Mobile app** — [`referral-mobile.md`](referral-mobile.md). Needs a
   reachable backend from step 1; needed alongside step 2 only if you
   want the full share-link → install → recovery flow working
   end-to-end (a backend alone is enough to integration-test in
   isolation via `curl`, per its own guide's verification step).

## The flow these four pieces implement together

```
share link tapped → landing page stores a click, signs a token
   → app recovers the code + token: deterministically (Android: Install
     Referrer · iOS: clipboard, if tapped) or, as a fallback, by scored
     fingerprint match
   → code pre-fills signup → claim verifies the token, records the
     conversion + reward
```

For the full picture — both recovery paths, diagrammed, and exactly how
they converge on one backend and one claim — see
[the root README's "How it works"](../../README.md#how-it-works).

Each guide's own verification step confirms that piece works in
isolation (a real `curl` round trip for the backends, a real click/recover/
claim check for web/mobile) — you don't need all four wired together to
confirm any single one is correctly set up.

## Design background

These guides cover *how*; [`docs/decisions.md`](../decisions.md) covers
*why* — the engineering decisions behind the signed-token claim flow,
the matching algorithm's scoring weights, and other things referenced
inline (e.g. "see docs/decisions.md #21/#22") if you want the full
reasoning rather than just the resulting behavior.
