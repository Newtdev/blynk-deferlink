# Integrating `@blynk-deferlink/referral-sdk-node` (Node backend)

Step-by-step setup for the Node/Express backend — one of two interchangeable
backends (see [`referral-sdk.md`](referral-sdk.md) for the PHP alternative;
pick one, not both). Same API contract, same matching algorithm as the PHP
SDK. This guide gets you from nothing to a verified `/click` → `/claim`
round trip, running locally and deployed to Vercel. For full config/API
reference, see
[`packages/referral-sdk-node/README.md`](../../packages/referral-sdk-node/README.md).

## Prerequisites

- Node ≥ 18.14.
- A free [Neon](https://neon.tech) Postgres project (no credit card
  required) — or any Postgres if you swap the driver; the shipped code
  uses `@neondatabase/serverless`'s HTTP driver specifically so it works
  identically on a long-running server and on Vercel's serverless runtime.

## 1. Create the database

1. Sign up at [neon.tech](https://neon.tech), create a project.
2. Copy the connection string it gives you.

## 2. Install and configure

```bash
cd packages/referral-sdk-node
npm install
cp .env.example .env
```

Edit `.env`:

| Var | Required | |
|---|---|---|
| `DATABASE_URL` | yes | The Neon connection string from step 1. |
| `CLICK_TOKEN_SECRET` | **yes** | `openssl rand -hex 32` — signs every click token. `/click` and `/match` throw a clear error at request time if this is unset. |
| `CRON_SECRET` | for `/cleanup` | Any random string. Leave unset to disable the endpoint entirely. |
| `ANALYTICS_SECRET` | for `/analytics` | Same idea. |
| `TRUST_PROXY_HOPS` | recommended | `0` locally (default, correct). **Must be `1` on Vercel** — see step 5. |

## 3. Push the schema

```bash
npm run db:push
```

Syncs `src/db/schema.ts` straight to the database via `drizzle-kit push` —
no migration files to manage for a project this size. (Prefer versioned
migrations? Use `npm run db:generate` instead and commit the generated SQL
under `drizzle/`.)

## 4. Run it locally

```bash
npm run dev
# → Referral backend (Node) on http://localhost:8787
```

## 5. Verify: a real click → claim round trip

```bash
# 1) Register a click.
curl -s -X POST http://localhost:8787/api/referral/click \
  -H "Content-Type: application/json" \
  -d '{"referral_code":"TESTCODE","fingerprint":{"user_agent":"test","screen_width":390,"screen_height":844,"pixel_ratio":3,"timezone":"Africa/Lagos","language":"en-NG","platform":"iPhone"}}'
# → {"success":true,"click_id":"...","token":"<click_id>.<exp>.<hmac>"}
```

```bash
# 2) Claim it, using the token from step 1.
curl -s -X POST http://localhost:8787/api/referral/claim \
  -H "Content-Type: application/json" \
  -d '{"device_id":"smoke-test-device","platform":"ios","token":"<paste the token here>","method":"install_referrer"}'
# → {"success":true,"reward":{"type":"credit","amount":500}}
```

If that comes back with a reward, the backend is wired correctly. Query
your Neon DB directly and delete the test rows from `referral_clicks`/
`referral_conversions` afterward so they don't pollute real analytics.

## 6. Wire a real code validator and reward callback (before production)

Both are functions, so they can't come from env vars — call `createApp()`
yourself instead of using the shipped `src/server.ts`/`api/index.ts`
entrypoints directly:

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

Unset, `code_validator` accepts any non-empty code (fine for development,
wrong for production).

## 7. Deploy to Vercel

```bash
npm install -g vercel     # if you don't have it
cd packages/referral-sdk-node
vercel link                # first time: creates/links a Vercel project
vercel env add DATABASE_URL production
vercel env add CLICK_TOKEN_SECRET production
vercel env add TRUST_PROXY_HOPS production    # 1 — see below, this one matters
vercel env add CRON_SECRET production
vercel env add ANALYTICS_SECRET production
vercel deploy --prod
```

**Set `TRUST_PROXY_HOPS=1` specifically on Vercel.** It defaults to `0`
(trust nothing — the safe default everywhere else), but Vercel's edge adds
exactly one real hop; left at `0` there, `clientIp()` falls back to
Vercel's own edge IP for every request instead of the real client's,
silently degrading IP-match scoring and per-IP rate limiting (not a
security hole either way, just wrong for this specific target). Self-hosted
deploys (Render, Fly, bare Node) need whatever their actual proxy chain's
hop count is instead.

Vercel auto-detects `api/index.ts` and deploys it as a serverless
function; the daily cron in `vercel.json` already calls `/api/referral/cleanup`
for you — no extra scheduler setup needed on this path (unlike the PHP
SDK's standalone mode, which has none built in).

## 8. Re-verify against the live deployment

Repeat step 5's curl commands against `https://<project>.vercel.app/api`
instead of `localhost:8787` — confirm the click/claim round trip still
works, and that the click's recorded `ip_address` (query it directly in
Neon) is your real IP, not Vercel's edge IP, confirming `TRUST_PROXY_HOPS`
took effect.

## 9. Point the web/mobile SDKs here

Set `apiEndpoint` in `@blynk-deferlink/referral-web`'s and `@blynk-deferlink/referral-mobile`'s
config to `https://<project>.vercel.app/api` — see
[`referral-web.md`](referral-web.md) and
[`referral-mobile.md`](referral-mobile.md).
