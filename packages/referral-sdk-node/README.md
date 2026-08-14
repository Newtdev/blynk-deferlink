# @sparkle/referral-sdk-node

A Node.js backend for the deferred deep linking referral system — a drop-in
alternative to [`sparkle/referral-sdk`](../referral-sdk) (PHP) for projects
that would rather not run PHP. Same API contract, same matching algorithm,
same DB schema shape, so `@sparkle/referral-web` and `@sparkle/referral-mobile`
work against either backend unmodified.

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
- **Rate limiting** is DB-backed (a row per hit, see `referral_rate_limit_hits`
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
vercel env add DATABASE_URL production      # paste your Neon connection string
vercel env add CRON_SECRET production       # any random string, for /cleanup
vercel env add ANALYTICS_SECRET production  # any random string, for /analytics
vercel deploy --prod
```

Vercel auto-detects `api/index.ts` and deploys it as a Node serverless
function; `vercel.json`'s rewrite sends every request there. The daily
`crons` entry in `vercel.json` calls `/api/referral/cleanup` (Vercel Cron
is limited to once/day on the free Hobby plan — that's fine here, since
cleanup is just housekeeping, not correctness-critical).

Once deployed, your API base is `https://<project>.vercel.app/api` — set
that as `apiEndpoint` in the web/mobile SDK configs.

## Configuration

Defaults match `sparkle/referral-sdk` (PHP) — see
[src/config.ts](src/config.ts). The two shipped entrypoints
(`src/server.ts`, `api/index.ts`) read these from environment variables via
[src/configFromEnv.ts](src/configFromEnv.ts):

| Env var | Default | |
|---|---|---|
| `REFERRAL_MATCH_WINDOW_HOURS` | `48` | How long a click stays eligible for matching |
| `REFERRAL_MIN_CONFIDENCE` | `70` | Minimum fingerprint score (0–100) to accept a match |
| `REFERRAL_RATE_LIMIT_CLICKS_PER_HOUR` | `10` | Per-IP click throttle |
| `REFERRAL_RATE_LIMIT_MATCHES_PER_DAY` | `5` | Per-device match throttle |
| `REFERRAL_HASH_DEVICE_IDS` | `true` | SHA-256 device IDs before storing (one-way, dedup only) |
| `REFERRAL_REWARDS_ENABLED` | `true` | Whether `/claim` distributes a reward |
| `REFERRAL_REFERRER_REWARD` / `REFERRAL_REFEREE_REWARD` | `500` | Reward amounts |
| `REFERRAL_REWARD_TYPE` | `credit` | `credit` \| `points` \| `custom` |

Two things **can't** come from env vars, because they're functions, not
values — if you need either, don't use the shipped entrypoints; call
`createApp()` yourself from your own `api/index.ts`/`server.ts`:

- **`code_validator`** — validates a referral code before a click/claim is
  stored. Unset accepts any non-empty code (fine for development; configure
  a real one, e.g. a lookup against your campaigns table, before production).
- **`rewards.on_claim_callback`** — actually credits accounts in your own
  system after a successful claim.

```ts
import { createApp } from '@sparkle/referral-sdk-node';

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
Referrer path resolves entirely on-device (see
[packages/referral-mobile/src/platform/android.ts](../referral-mobile/src/platform/android.ts))
and never calls this backend at all — only the fingerprint path shows up
here, so a method split would misrepresent the real mix rather than just
omit data. If you need real Android/iOS recovery-method analytics, that
requires the app to report successful `install_referrer` recoveries back to
the backend explicitly (not built — ask if you want it).

## Using it as a library instead of the standalone service

```bash
npm install @sparkle/referral-sdk-node
```

```ts
import express from 'express';
import { createApp } from '@sparkle/referral-sdk-node';

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
can switch between them without touching `@sparkle/referral-web` or
`@sparkle/referral-mobile`:

| | PHP (`sparkle/referral-sdk`) | Node (`@sparkle/referral-sdk-node`) |
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
