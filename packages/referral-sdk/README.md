# sparkle/referral-sdk

Backend for a **deferred deep linking** referral system. It stores landing-page
clicks, recovers the referral code after install (Android Install Referrer or
iOS fingerprint matching), records conversions, and distributes rewards.

- **Framework-agnostic core** — the services need only a `PDO` handle.
- **First-class Laravel integration** — auto-discovered provider, publishable
  config + migrations, routes, throttling middleware, and a cleanup command.

This is package 1 of 3. It pairs with `@sparkle/referral-web` (landing page)
and `@sparkle/referral-mobile` (React Native recovery).

---

## Install

```bash
composer require sparkle/referral-sdk
```

### Laravel

```bash
php artisan vendor:publish --tag=referral-config
php artisan vendor:publish --tag=referral-migrations   # optional; migrations also auto-load
php artisan migrate
```

Routes register automatically under `api/referral` (configurable). Schedule the
cleanup command in `app/Console/Kernel.php`:

```php
$schedule->command('referral:cleanup-expired')->hourly();
```

### Standalone PHP

Run `database/schema.sql` against your database, then wire the services to a
`PDO` handle — see [`examples/standalone.php`](examples/standalone.php).

---

## API

All endpoints accept and return JSON. Prefix defaults to `/api/referral`.

### `POST /click`
Called by the landing page when a user arrives.

```jsonc
// request
{ "referral_code": "1234", "fingerprint": { "user_agent": "...", "screen_width": 390,
  "screen_height": 844, "pixel_ratio": 3, "timezone": "Africa/Lagos",
  "language": "en-NG", "platform": "iPhone", "referrer": "https://wa.me/..." } }
// response
{ "success": true, "click_id": "uuid-v4" }
```

The server records the IP from the request; clients never send it.

### `POST /match`
Called by the mobile app on first launch (iOS, or Android when the Install
Referrer is empty). A successful match is **locked to the device** and cannot be
returned again.

```jsonc
// request
{ "device_id": "…", "platform": "ios", "method": "fingerprint",
  "fingerprint": { "device_model": "iPhone14,5", "screen_width": 390,
    "screen_height": 844, "timezone": "Africa/Lagos", "language": "en-NG" } }
// response (match)
{ "matched": true, "referral_code": "1234", "confidence": 92.5, "match_method": "fingerprint" }
// response (no match)
{ "matched": false, "referral_code": null }
```

### `POST /claim`
Called after a successful match + signup. One conversion per device, ever.

```jsonc
// request
{ "referral_code": "1234", "device_id": "…", "platform": "android",
  "method": "install_referrer", "user_id": "new-user-id" }
// response
{ "success": true, "reward": { "type": "credit", "amount": 500 } }
```

---

## Matching

Incoming fingerprints are scored against unmatched clicks inside the match
window. Default weights (configurable):

| Signal            | Points |
|-------------------|-------:|
| IP address        | 40 |
| Device / OS family| 25 |
| Screen dimensions | 15 |
| Timezone          | 10 |
| Language          | 10 |

A match requires **≥ 70**, so IP alone (40) never matches. Screen comparison is
orientation-insensitive; language compares the primary subtag (`en-NG` ≈ `en`).

**iOS limitation:** a Safari User-Agent never exposes the device model, so on
iOS the "device" signal collapses to OS-family + major-version agreement. This
is the accepted trade-off behind the ~85-90% iOS match rate. If a user changes
network between click and install, the IP signal is lost and the remaining
signals total 60 — below threshold — so provide a manual code entry field on
signup as a fallback.

---

## Configuration

Everything is set in `config/referral.php`. Key hooks:

- **`code_validator`** — a callable `fn(string $code): bool` or a class with
  `validate(string $code): bool`. Referral codes live in *your* app, so wire
  this up in production; unset, any non-empty code is accepted.
- **`rewards.on_claim_callback`** — a callable `fn(string $code, ?string $userId,
  array $config)` or a class with `handle(...)`, invoked to actually credit
  accounts on a successful claim.
- **`scoring`** — per-signal weights. **`min_confidence`** — match threshold.
- **`hash_device_ids`** — SHA-256 device IDs before storage (dedup only).

---

## Privacy & anti-fraud

- Expired unmatched clicks (and their IP/fingerprint data) are deleted by
  `referral:cleanup-expired`.
- Device IDs are hashed one-way before storage when `hash_device_ids` is on.
- `POST /click` is throttled per IP/hour; `POST /match` per device/day.
- Each click locks to one device on match; each device converts once.

---

## Tests

```bash
composer install && vendor/bin/phpunit   # full suite
php tests/run.php                         # zero-dependency scoring check
```
