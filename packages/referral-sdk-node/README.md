# @blynk-deferlink/referral-sdk-node

A Node.js backend for the deferred deep linking referral system — a drop-in
alternative to [`blynk-deferlink/referral-sdk`](../referral-sdk) (PHP) for projects
that would rather not run PHP. Same API contract, same matching algorithm,
same DB schema shape, so `@blynk-deferlink/referral-web` and `@blynk-deferlink/referral-mobile`
work against either backend unmodified.

**New to this package?** [`docs/integration/referral-sdk-node.md`](../../docs/integration/referral-sdk-node.md)
is a step-by-step setup guide (local run + Vercel deploy); this README is
API/config reference.

```
POST /api/referral/click     — landing page reports a click + fingerprint
POST /api/referral/match     — mobile app recovers a code on first launch
POST /api/referral/claim     — mobile app claims the reward after signup (optional — see below)
GET|POST /api/referral/cleanup — housekeeping: delete expired unmatched clicks
GET  /api/referral/analytics — aggregate click/match counts (internal — see below)
GET  /api/health             — liveness check
```

**If your use case is deferred deep linking only** (recover the code on
first launch — no in-app rewards/conversion tracking), you can simply never
call `/claim`. It stays fully functional but unused; nothing else depends
on it.

**`/claim` requires proof, not just a claim.** It takes a `token` — a
short-lived, signed proof `/click` returns (and `/match` returns again on a
successful lock) — and verifies server-side that it's genuine, unexpired,
and (once redeemed) locked to this exact `device_id` before recording a
conversion or paying out a reward. It doesn't accept `referral_code` or
`click_id` at all; both are derived from the click row the verified token
references, never trusted from the request. A `/claim` call with an
invalid, forged, expired, or already-claimed-by-a-different-device token
gets rejected with `unverified_claim` — this replaced trusting whatever the
request body said happened (see
[docs/decisions.md #21/#22](../../docs/decisions.md)).
`@blynk-deferlink/referral-mobile` handles this automatically; if you're calling
this API directly, thread `/click`'s (or `/match`'s) `token` straight
through to `/claim` — read it locally off the Android referrer param / iOS
clipboard payload for the deterministic paths, no extra network call
needed until `/claim` itself.

**Requires `CLICK_TOKEN_SECRET`** (generate with `openssl rand -hex 32`) —
signs every token; `/click` and `/match` throw a clear error if it's unset
when they actually need it, rather than silently minting tokens no one can
ever verify.

## Why one codebase runs both long-running and serverless

[src/app.ts](src/app.ts) builds a single Express app (`createApp()`). Two
files just mount it:

- [src/server.ts](src/server.ts) — `app.listen(PORT)`. Use this for local
  dev, Render, Fly, or any bare Node host.
- [api/index.ts](api/index.ts) — `export default createApp(...)`. Vercel's
  Node runtime accepts an Express app directly (it's already a valid
  `(req, res)` handler), and [vercel.json](vercel.json) rewrites every
  request to this one function, so Express's own router still does the
  path dispatch. Nothing about the routes or business logic forks between
  the two deploy targets.

The two things that would normally need a serverless-specific rewrite are
handled so the same code works everywhere instead:

- **Database access** uses `@neondatabase/serverless`'s HTTP driver, not a
  TCP connection pool — every query is a `fetch()` call, so there's no
  pool-warmup/teardown problem on cold starts.
- **Rate limiting** is DB-backed (a fixed-window counter, one row per
  bucket per window, upserted atomically — see `referral_rate_limit_hits`
  in [src/db/schema.ts](src/db/schema.ts)), not an in-memory counter, since a
  stateless serverless invocation can't hold memory between requests anyway.
- **Expired-click cleanup** isn't a background cron thread (which can't
  survive between serverless invocations) — it's a plain route your
  scheduler calls. Matching already excludes expired clicks by query
  regardless of whether cleanup has run, so this is pure housekeeping, not
  a correctness requirement.

## Setup

### 1. Create a free Postgres database (Neon)

1. Sign up at [neon.tech](https://neon.tech) (no credit card required).
2. Create a project. Copy the connection string it gives you.
3. `cp .env.example .env` and paste it into `DATABASE_URL`.

### 2. Push the schema

```bash
npm install
npm run db:push
```

This uses `drizzle-kit push`, which syncs `src/db/schema.ts` straight to
the database — no migration files to manage for a project this size. If you
prefer versioned migrations, use `npm run db:generate` instead and commit the
generated SQL under `drizzle/`.

### 3. Run it locally

```bash
npm run dev
# → Referral backend (Node) on http://localhost:8787
```

Point `examples/web` and `examples/mobile`'s `apiEndpoint` /`API` config at
`http://localhost:8787/api` (same shape the mock backend already used) to
exercise the real backend end-to-end.

## Deploying to Vercel

```bash
npm install -g vercel     # if you don't have it
cd packages/referral-sdk-node
vercel link                # first time: creates/links a Vercel project
vercel env add DATABASE_URL production        # paste your Neon connection string
vercel env add CLICK_TOKEN_SECRET production  # `openssl rand -hex 32` — required, not optional
vercel env add TRUST_PROXY_HOPS production    # 1 — see the callout below, this one matters
vercel env add CRON_SECRET production         # any random string, for /cleanup
vercel env add ANALYTICS_SECRET production    # any random string, for /analytics
vercel deploy --prod
```

**`TRUST_PROXY_HOPS` defaults to `0` (trust nothing) — set it to `1` on
Vercel specifically**, or `clientIp()` falls back to Vercel's own edge IP
for every request instead of the real client's, silently degrading
IP-match scoring and per-IP rate limiting (not a security hole either way
— `0` is the safe default — just wrong for this specific deploy target
until set). This isn't a guess: it replaced a real bug
(`app.set('trust proxy', true)`, which trusted *every* hop including a
client's own spoofed `X-Forwarded-For`) — see
[docs/decisions.md #23](../../docs/decisions.md). Self-hosted (Render,
Fly, bare Node, local dev) needs whatever its actual proxy chain's hop
count is, or `0` behind no proxy at all.

Vercel auto-detects `api/index.ts` and deploys it as a Node serverless
function; `vercel.json`'s rewrite sends every request there. The daily
`crons` entry in `vercel.json` calls `/api/referral/cleanup` (Vercel Cron
is limited to once/day on the free Hobby plan — that's fine here, since
cleanup is just housekeeping, not correctness-critical).

Once deployed, your API base is `https://<project>.vercel.app/api` — set
that as `apiEndpoint` in the web/mobile SDK configs.

## Configuration

Defaults match `blynk-deferlink/referral-sdk` (PHP) — see
[src/config.ts](src/config.ts). The two shipped entrypoints
(`src/server.ts`, `api/index.ts`) read these from environment variables via
[src/configFromEnv.ts](src/configFromEnv.ts):

| Env var | Default | |
|---|---|---|
| `REFERRAL_MATCH_WINDOW_HOURS` | `48` | How long a click stays eligible for matching |
| `REFERRAL_MIN_CONFIDENCE` | `70` | Minimum fingerprint score (0–100) to accept a match |
| `REFERRAL_RATE_LIMIT_CLICKS_PER_HOUR` | `10` | Per-IP click throttle |
| `REFERRAL_RATE_LIMIT_MATCHES_PER_DAY` | `5` | Per-device match throttle |
| `REFERRAL_RATE_LIMIT_CLAIMS_PER_HOUR` | `10` | Per-device claim throttle |
| `REFERRAL_HASH_DEVICE_IDS` | `true` | SHA-256 device IDs before storing (one-way, dedup only) — also applied to `referral_match_attempts` logging now, which stored them raw before |
| `REFERRAL_REWARDS_ENABLED` | `true` | Whether `/claim` distributes a reward |
| `REFERRAL_REFERRER_REWARD` / `REFERRAL_REFEREE_REWARD` | `500` | Reward amounts |
| `REFERRAL_REWARD_TYPE` | `credit` | `credit` \| `points` \| `custom` |
| `REFERRAL_RETENTION_DAYS` | `30` | How long `/cleanup` keeps `referral_match_attempts`/`referral_rate_limit_hits` rows before purging — both grew unbounded forever before this |
| `TRUST_PROXY_HOPS` | `0` | Reverse-proxy hop count to trust for `clientIp()` — see the deploy section above, **not** part of `ReferralConfig` (operational/deploy-topology concern, like `CRON_SECRET`) |

**If `on_claim_callback` throws** (e.g. your own account-crediting call is
down), the claim itself still succeeds — the conversion row is real and
final regardless — but `referral_conversions.reward_status` gets set to
`'failed'` instead of the default `'granted'`, and the failure is logged.
Query for `reward_status = 'failed'` periodically if you want to catch and
manually reconcile these; there's no built-in retry. See
[docs/decisions.md #23](../../docs/decisions.md).

Two things **can't** come from env vars, because they're functions, not
values — if you need either, don't use the shipped entrypoints; call
`createApp()` yourself from your own `api/index.ts`/`server.ts`:

- **`code_validator`** — validates a referral code before a click/claim is
  stored. Unset accepts any non-empty code (fine for development; configure
  a real one, e.g. a lookup against your campaigns table, before production).
- **`rewards.on_claim_callback`** — actually credits accounts in your own
  system after a successful claim.

```ts
import { createApp } from '@blynk-deferlink/referral-sdk-node';

const app = createApp({
  code_validator: (code) => myCampaignsTable.has(code),
  rewards: {
    on_claim_callback: async (code, userId) => {
      await creditUserAccount(userId, 500);
    },
  },
});

app.listen(3000);
```

## Analytics

`GET /api/referral/analytics` returns aggregate counts only — never raw
per-click rows (no IPs, no device IDs, no user agents) — protected by a
shared secret, same pattern as `/cleanup`:

```bash
curl https://<project>.vercel.app/api/referral/analytics \
  -H "x-analytics-secret: $ANALYTICS_SECRET"

# optionally restrict to a window:
curl "https://<project>.vercel.app/api/referral/analytics?since=2026-08-01T00:00:00Z" \
  -H "x-analytics-secret: $ANALYTICS_SECRET"
```

```json
{
  "success": true,
  "since": null,
  "totals": { "clicks": 11, "matched": 6, "matchRate": 54.55 },
  "byPlatform": [{ "platform": "ios", "clicks": 9, "matched": 6 }],
  "byReferralCode": [{ "referralCode": "1234", "clicks": 3, "matched": 0 }]
}
```

There's deliberately no "by match method" breakdown. Android's Install
Referrer and iOS's clipboard tier both resolve entirely on-device (see
[packages/referral-mobile/src/platform/android.ts](../referral-mobile/src/platform/android.ts))
and never call this backend at recovery time at all — only `/claim`, once,
sees which method actually happened (`referral_clicks.match_method`, set
at lock time — either by `/match` for the fingerprint path, or by `/claim`
itself redeeming a deterministic token for the first time). A method
breakdown is buildable from that data, it's just not surfaced here yet —
ask if you want it added.

## Using it as a library instead of the standalone service

```bash
npm install @blynk-deferlink/referral-sdk-node
```

```ts
import express from 'express';
import { createApp } from '@blynk-deferlink/referral-sdk-node';

const referralApp = createApp({ min_confidence: 65 });

const app = express();
app.use('/referral-service', referralApp); // mount alongside your own routes
app.listen(3000);
```

Or use the individual services directly (`FingerprintMatcher`, `ClickStore`,
`ConversionTracker`, `RateLimiter`, all exported from the package root) if
you want to wire your own routes instead of the Express router.

## Parity with the PHP SDK

This package mirrors `packages/referral-sdk` field-for-field so a project
can switch between them without touching `@blynk-deferlink/referral-web` or
`@blynk-deferlink/referral-mobile`:

| | PHP (`blynk-deferlink/referral-sdk`) | Node (`@blynk-deferlink/referral-sdk-node`) |
|---|---|---|
| Scoring weights & threshold | `src/Support/ReferralConfig.php` | `src/config.ts` |
| Matching algorithm | `src/Services/FingerprintMatcher.php` | `src/services/fingerprintMatcher.ts` |
| UA/device-model parsing | `src/Support/UserAgentParser.php` | `src/support/userAgentParser.ts` |
| Click storage | `src/Services/ClickStore.php` | `src/services/clickStore.ts` |
| Claim + reward | `src/Services/ConversionTracker.php` | `src/services/conversionTracker.ts` |
| Rate limiting | Laravel `RateLimiter` (cache-backed) | `src/services/rateLimiter.ts` (DB-backed — see above) |
| DB schema | `database/schema.sql` (MySQL) | `src/db/schema.ts` (Postgres via Drizzle) |

## Testing

```bash
npm test
```

Unit tests target the pure parts (`FingerprintMatcher.score()`,
`UserAgentParser`) the same way `packages/referral-sdk/tests/FingerprintMatcherTest.php`
does on the PHP side — no DB needed for those.
