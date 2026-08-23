# Integrating `blynk-deferlink/referral-sdk` (PHP backend)

Step-by-step setup for the PHP backend — one of two interchangeable
backends (see [`referral-sdk-node.md`](referral-sdk-node.md) for the
Node/Express alternative; pick one, not both). This guide gets you from
nothing to a verified, working `/click` → `/match` → `/claim` round trip.
For API/config reference beyond what's covered here, see
[`packages/referral-sdk/README.md`](../../packages/referral-sdk/README.md).

## Prerequisites

- PHP ≥ 8.1 with `ext-pdo` and `ext-json`.
- A database — MySQL or Postgres both work (`database/schema.sql` targets
  MySQL syntax; adapt types for Postgres if that's your target).
- Laravel 10 or 11, **or** nothing at all — the core services only need a
  `PDO` handle. This guide covers both paths; skip to whichever applies.

## 1. Install

```bash
composer require blynk-deferlink/referral-sdk
```

## 2a. Laravel setup

```bash
php artisan vendor:publish --tag=referral-config
php artisan vendor:publish --tag=referral-migrations   # optional; migrations also auto-load without this
php artisan migrate
```

This publishes `config/referral.php` and registers routes automatically
under `api/referral` (prefix/middleware configurable in that file).

Skip to **step 3**.

## 2b. Standalone PHP setup (no Laravel)

```bash
mysql -u youruser -p yourdb < packages/referral-sdk/database/schema.sql
```

Wire the core services to a `PDO` handle yourself — see
[`examples/standalone.php`](../../packages/referral-sdk/examples/standalone.php)
for a complete, working `/click` + `/match` + `/claim` router built exactly
this way (same signed-token flow as the Laravel controllers, same method
signatures — copy it as your starting point rather than reinventing the
wiring).

## 3. Generate and set the click token secret

**Required, not optional** — `/click` and `/match` both throw a clear error
at request time if this is unset. Every click's proof of authenticity is
signed with it.

```bash
openssl rand -hex 32
```

- **Laravel:** set `REFERRAL_CLICK_TOKEN_SECRET` in `.env`.
- **Standalone:** pass it as `click_token_secret` in the `ReferralConfig`
  array you construct (see `examples/standalone.php`), sourced from
  whatever env/secrets mechanism your app already uses.

## 4. Wire a real referral-code validator (before production)

Unset, **any non-empty code is accepted** — fine for local testing, wrong
for production. Point `code_validator` (Laravel: `config/referral.php`;
standalone: the `ReferralConfig` array) at a real lookup:

```php
// config/referral.php
'code_validator' => \App\Referral\CodeValidator::class, // needs a public validate(string $code): bool
// or inline:
'code_validator' => fn (string $code) => MyCampaignsTable::has($code),
```

## 5. Wire reward distribution (if you use `/claim`)

If your use case is deferred deep linking only (recover the code on first
launch, no in-app rewards), skip this — never calling `/claim` is fine, it
just stays unused.

Otherwise, set `rewards.on_claim_callback` to whatever actually credits an
account in your system:

```php
// config/referral.php
'rewards' => [
    'on_claim_callback' => function (string $code, ?string $userId, array $config) {
        app(CreditService::class)->grant($userId, $config['referee_reward']);
    },
],
```

If this throws, the claim still succeeds (the conversion itself is real
and final either way) but `referral_conversions.reward_status` gets set to
`'failed'` for later reconciliation — see the README's Configuration
section for the full explanation.

## 6. Schedule cleanup (Laravel only)

Deletes expired, unmatched clicks (and their IP/fingerprint data) —
housekeeping, not correctness-critical, since matching already excludes
expired clicks by query regardless.

```php
// app/Console/Kernel.php
$schedule->command('referral:cleanup-expired')->hourly();
```

Standalone PHP has no scheduler — call `ClickStore::deleteExpired()` from
whatever cron mechanism your deployment already has, on any cadence.

## 7. Verify: a real click → match → claim round trip

Point these at your actual app URL (`http://localhost:8000/api/referral/...`
for Laravel's dev server, or wherever your standalone router is mounted).

```bash
# 1) Register a click.
curl -s -X POST http://localhost:8000/api/referral/click \
  -H "Content-Type: application/json" \
  -d '{"referral_code":"TESTCODE","fingerprint":{"user_agent":"test","screen_width":390,"screen_height":844,"pixel_ratio":3,"timezone":"Africa/Lagos","language":"en-NG","platform":"iPhone"}}'
# → {"success":true,"click_id":"...","token":"<click_id>.<exp>.<hmac>"}
```

Take the `token` from that response and use it directly — this is exactly
what the deterministic recovery paths (Android referrer, iOS clipboard)
read locally and what `/claim` verifies; there's no separate `/match` step
needed for this smoke test since you already have a valid token:

```bash
# 2) Claim it.
curl -s -X POST http://localhost:8000/api/referral/claim \
  -H "Content-Type: application/json" \
  -d '{"device_id":"smoke-test-device","platform":"ios","token":"<paste the token here>","method":"install_referrer"}'
# → {"success":true,"reward":{"type":"credit","amount":500}}
```

If you got a reward response back, the backend is wired correctly.
`{"success":false,"error":"unverified_claim"}` means the token was
malformed, expired, or already claimed by a different device — re-run
step 1 for a fresh one. Delete the test row afterward (`referral_clicks`/
`referral_conversions` where `referral_code = 'TESTCODE'`) so it doesn't
pollute real analytics.

## 8. Point the web/mobile SDKs here

Set `apiEndpoint` in `@blynk-deferlink/referral-web`'s and `@blynk-deferlink/referral-mobile`'s
config to this backend's base URL (e.g. `https://your-app.test/api`) — see
[`referral-web.md`](referral-web.md) and
[`referral-mobile.md`](referral-mobile.md).
