# App scoping (multi-app deployments)

Status: proposed, not yet built.
Touches: `packages/referral-sdk-node` / `packages/referral-sdk` (backend,
major — schema, matching, token), `packages/referral-web` (landing page
config resolution), `packages/referral-mobile` (one config field).

## Why this doc exists

A deployment currently has no notion of *which app* a click belongs to.
There is no `app_id`, `tenant_id`, `bundle_id` or `client_id` column in
either backend's schema, and `/match`'s candidate query filters on exactly
two predicates — the match window and expiry:

```ts
// packages/referral-sdk-node/src/services/fingerprintMatcher.ts
gte(referralClicks.createdAt, windowStart)
gt(referralClicks.expiresAt, new Date())
```

Every recent click is therefore a candidate for every matching device, and
the winner is decided purely on fingerprint score. Two apps sharing one
deployment cross-attribute: the second app's user is handed the first
app's referral code, and the conversion — and the reward — is recorded
against it.

[`decisions.md`](decisions.md) #32 has the full analysis and the numbers.
The short version is that the five non-recency signals sum to **85 against
a default `min_confidence` of 70**, so two apps serving the same user base
cross-match on ordinary overlap rather than by coincidence. This is a
correctness defect, not a privacy nicety: the wrong referrer gets paid.

This doc maps out the fix. It is written before any code, deliberately —
the risky part is the migration, not the query change, and that is worth
settling on paper first.

## The constraint that shapes everything else

**A single-app self-hoster must not have to register anything.**

The model this project recommends (#31) is one person forking it and
running it for one app. If app scoping makes that path harder — a registry
to populate, an id to generate, a config field to set before anything
works — the fix costs more than the defect for the majority of users.

So `app_id` is **optional everywhere**. A deployment with no registered
apps behaves exactly as it does today: one implicit default app,
everything scoped to it, no configuration. Scoping only becomes visible
the moment a second app is registered.

This constraint also hands us the migration for free — every pre-existing
row belongs to the default app.

## How it works

One new fact travels through the system. Everything else is plumbing to
get it to the one place it is enforced.

```
link  ──carries app──►  /click  ──stores──►  referral_clicks.app_id
                                                    │
mobile SDK ──sends app──►  /match  ──filters on ────┘
                                                    │
                      /claim  ──verifies via token──┘
```

The actual correctness fix is a single added predicate in the candidate
query. The rest of this document exists because getting `app_id` to that
predicate without breaking a live deployment is the hard part.

## Data model

### `referral_clicks.app_id`

Nullable `varchar`, indexed alongside the existing lookup paths. Nullable
rather than `NOT NULL DEFAULT 'default'` so the migration is a pure add —
no table rewrite on a large production table, and no pretence that old
rows carried an app identity they never had.

The index matters: `/match` currently scans on `(created_at, expires_at)`
and will gain `app_id` as the most selective predicate, so it should lead
the composite.

### `apps` registry

| column | purpose |
| --- | --- |
| `app_id` | primary key, the value carried through the system |
| `name` | human label, for operators only |
| `scheme` | deep link scheme, e.g. `sparkleu18` |
| `ios_store_url` | per-app App Store fallback |
| `android_store_url` | per-app Play fallback |
| `og_title` / `og_description` / `og_image` | per-app link previews |
| `active` | soft disable without deleting attribution history |

This table is what makes the landing page generic. Today `appScheme` and
the store URLs are deployment configuration
(`packages/referral-web/src/types.ts`), which is precisely why one
deployment can only ever route to one app.

## Where `app_id` enters the link

This is the one genuinely open decision, because it is the only part
users see.

| Option | Shape | Trade-off |
| --- | --- | --- |
| Path segment | `host/a/sparkle-u18/referral/L82WDL` | explicit, no DNS work, uglier link |
| Subdomain | `u18.sparkle.ng/referral/L82WDL` | cleanest, needs DNS and a cert per app |
| Query param | `host/referral/L82WDL?app=sparkle-u18` | trivial, but strippable and ugly when shared |
| Per-deployment | unchanged | today's behaviour; does not solve the problem |

**Recommendation:** support subdomain *and* path segment, resolving to the
same registry lookup. Subdomain for anyone with DNS control, because a
referral link is a marketing asset and `u18.sparkle.ng` reads like a real
product. Path segment as the portable default, because it needs nothing
beyond the deployment that already exists.

Query param is rejected: referral links get copied, pasted and truncated
by messaging apps, and a scoping parameter that can silently fall off is a
scoping parameter that will.

## The claim token, without a format change

Binding the app into the token appears to force a fourth segment —
`click_id.app_id.exp.hmac` — which would break every token currently in
flight, including ones already sitting on a user's clipboard or in a Play
referrer.

It does not have to. Keep the three-part format and fold `app_id` into the
**signed input** rather than the payload:

```
token = click_id . exp . HMAC(secret, "click_id.exp.app_id")
```

`/claim` already receives `app_id` from SDK config, so it can recompute the
expected signature. A token minted for U18 and replayed against the main
app simply fails verification — the same guarantee a fourth segment would
give, with no format change and no in-flight breakage.

**Transition.** Tokens signed before the migration have no `app_id` in
their HMAC input. Verification therefore tries with `app_id` first, then
falls back to without, for one full expiry window (48h by default). After
that window every outstanding token is expired anyway and the fallback is
deleted. The fallback must be time-boxed in code, not left as a permanent
accommodation — a verifier that indefinitely accepts unscoped tokens is
the defect wearing a hat.

## The match change

```ts
and(
  eq(referralClicks.appId, appId),        // new
  gte(referralClicks.createdAt, windowStart),
  gt(referralClicks.expiresAt, new Date()),
)
```

Note what this is *not*: it is not a scoring weight, and it must never
become one. A cross-app click should be **invisible**, not merely
unlikely. Scoring is probabilistic by design and will occasionally be
wrong; app identity is a fact the system knows, and facts belong in the
`WHERE` clause.

## Migration, in the order it must happen

| # | Step | Behaviour change | Risk |
| --- | --- | --- | --- |
| 1 | Add `app_id` column (nullable) + index, both schemas | none | none — nothing reads it |
| 2 | Add `apps` registry table | none | none |
| 3 | `/click` records `app_id` when supplied | new rows carry it | none |
| 4 | Backfill existing rows to the default app | none | low — safe, nothing filters yet |
| 5 | `/match` filters on `app_id`, behind `enforce_app_scoping` | **attribution** | **high** |
| 6 | Landing page resolves per-app config from the registry | routing | medium |
| 7 | `app_id` folded into the signed token input | claim verification | low, with the fallback window |
| 8 | Mobile SDK gains `appId` config | consumers | low — changes last |

**Step 5 is the one that can break a live system.** Enable filtering
before the backfill completes and every pre-existing click has a null
`app_id`, matches nothing, and silently drops users who are mid-funnel —
they installed, they are owed a referrer, and they get none. The failure
is invisible from the outside: no error, no exception, just attribution
quietly going to zero.

Hence the config flag. A deployment runs with `enforce_app_scoping` off
until its backfill is verified, then flips it. The flag is a migration
tool and should be removed once deployments have moved, not kept as a
permanent option — an off switch for a correctness fix is a defect that
survives by being configurable.

## Use cases

These are written to test the design, not to illustrate it. Each one
should be checked against any change to the plan above.

### 1. Solo developer, one app

Registers nothing. Sets no `appId`. Links keep their current shape.
Everything behaves exactly as today, because the implicit default app
scopes all clicks identically.

*This case must stay boring.* If it acquires a setup step, the design is
wrong.

### 2. Sparkle and Sparkle U18 — the real one

Two apps, one deployment, one database. A parent taps a Sparkle referral
link on the home WiFi; their child installs the under-18 companion app on
the same network, plausibly on a similar handset.

Today: IP 25 + device model 25 + screen 15 + timezone 10 + language 10 =
85, clearing the 70 threshold before recency is even considered. The
child's install is attributed to the parent's Sparkle referrer, and a
reward is paid against a signup that did not come from that referral.

After: U18's `/match` never sees the Sparkle click. Not "scores it lower"
— never considers it. Each app additionally resolves its own scheme and
store URLs, so the landing page stops sending U18 users into the Sparkle
app.

This pair is close to the worst case the scoring engine can produce: every
non-recency signal aligns through the ordinary structure of the product
rather than by chance.

### 3. Agency running five client apps

One deployment, five registered apps, five sets of store URLs and link
previews served from the same landing page. Attribution never crosses
between clients, which is a contractual requirement and not merely a
technical preference.

This case needs step 6 as much as step 5 — scoping the matcher without a
generic landing page leaves every client's links opening the first
client's app.

### 4. Hosted sandbox

The same mechanism, plus key issuance and per-app rate limits. This is the
case that makes app scoping a **prerequisite** for the npm story rather
than a parallel track: "install the SDK and it works against a backend you
did not deploy" is the hosted path, and publishing before scoping exists
would ship an install whose happy path is the defect.

See #32 for why the remaining hosted work (key issuance, signed webhook or
verify endpoint for reward distribution, a registration surface) is
deliberately *not* in scope here.

## Open questions

1. **Link shape** — subdomain, path segment, or both. Affects step 6 and
   nothing else structurally.
2. **`app_id` format** — opaque (`app_01H…`) or human slug
   (`sparkle-u18`). Slugs are far nicer in a link and easier to debug;
   they also leak product names before launch and cannot be rotated if
   one needs to disappear. Opaque ids are safer and worse to work with.
3. **Default app naming** — whether the implicit single-app default is a
   reserved id (`default`) or a null that the query treats as its own
   bucket. The reserved id is simpler to reason about; null avoids a
   magic string appearing in real rows.

## Verification

Step 5 needs the counter-check discipline #29 and #30 used: revert only
the fix and confirm the new tests fail. A test that passes against
unfiltered code proves nothing, and cross-app tests are especially prone
to this — a test with only one app in the database passes no matter what
the query filters on.

The minimum cross-app suite:

- two apps, identical fingerprints, recent clicks in both: each device
  matches its own app's click and never the other's
- a device with no click in its own app does **not** match a
  high-scoring click belonging to another app
- backfilled null-`app_id` rows still match while the flag is off, and
  stop matching for a *different* app once it is on
- a token minted under one app fails verification under another
- a pre-migration token still verifies during the fallback window

Both backends, as always — PHP and Node, or #23's parity guarantee breaks.

## Out of scope

Key issuance, signed webhooks, a verify endpoint, and any registration
dashboard. Those belong to the hosted-service question, which #32 leaves
deliberately open. This document covers only the correctness work, which
is worth doing whether or not hosting ever happens — Sparkle needs it for
U18 regardless.
