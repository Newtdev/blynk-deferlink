# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Use GitHub's private reporting instead — [**Report a
vulnerability**](https://github.com/Newtdev/blynk-deferlink/security/advisories/new)
— which opens a private advisory visible only to the maintainers. If that
isn't available to you, email **ejembithomas61@gmail.com** with
`blynk-deferlink security` in the subject.

What helps: the affected package, what an attacker gains, and the smallest
reproduction you can manage. A curl command against a local backend is
ideal; a description of the flaw is fine if you'd rather not build one.

You'll get an acknowledgement within 3 working days. This is a small
project maintained alongside other work, so please assume good faith on
timelines rather than a guarantee — I'll tell you what I actually know
about a fix date rather than quote a policy number. Credit in the advisory
and release notes unless you'd prefer otherwise.

## Which versions get fixes

`main` is the supported version. There are no release branches and the
packages aren't published to a registry — this is forked and self-hosted
(see the README), so a fix means a commit to `main` that you pull into
your fork. Security fixes will be called out in the commit subject and, for
anything exploitable, a published advisory.

**If you run a fork, you are your own security maintainer.** Watch releases
and advisories on this repo, because nothing will reach you automatically.

## What this project handles

Worth stating plainly, because it sets the severity bar:

- **Attribution data** — clicks, conversions, and the referral codes tying
  them together. The direct target of fraud: getting paid for installs you
  didn't drive.
- **Device fingerprints** — user agent, screen geometry, timezone, language,
  device model, and IP. Collected to match an install back to a click.
- **HMAC-signed click tokens** — the sole proof at `/claim`, minted at
  `/click` and verified server-side (see `docs/decisions.md` #21/#22).

Because it self-hosts, **the data stays in your database** and this project
never receives any of it. That also means an incident in your deployment is
yours to handle — there's no central service to revoke anything.

## Known limits, by design

These are documented trade-offs, not vulnerabilities. Reporting them is
welcome if you think the reasoning is wrong — but please argue the
reasoning rather than filing the behaviour as a bug.

- **Fingerprint matching is probabilistic.** It scores a device against
  recent clicks with a confidence threshold. It can mismatch, and a
  determined attacker who replicates a victim's fingerprint and IP can be
  attributed their click. It's the fallback tier; the deterministic tiers
  (Play Install Referrer, iOS clipboard handoff) are not guessable and are
  preferred whenever available. See `docs/decisions.md` #1, #1a.
- **Client IP is only as trustworthy as your proxy configuration.** IP is a
  scoring signal, so a spoofable `X-Forwarded-For` degrades match quality.
  Configure trusted proxies for your deployment — see `docs/decisions.md`
  #23.
- **Rate limits are defaults, not a fraud system.** Ten clicks/hour, five
  matches/day, ten claims/hour out of the box, all configurable. They blunt
  casual abuse. They are not an anti-fraud engine, and a referral programme
  paying real money needs its own controls in `on_claim_callback`.
- **One app per deployment.** Nothing in the schema records which app a
  click belongs to, and `/match` scores every recent click regardless of
  origin. Two apps sharing one backend can therefore cross-attribute — and
  because the five non-recency signals sum to 85 against a threshold of 70,
  two apps serving the same user base will do so routinely rather than
  rarely. This is a correctness limit, not just a privacy one: the wrong
  referrer gets paid. Run one deployment and database per app. Tracked in
  `docs/decisions.md` #32.
- **No Universal Links / App Links.** Deferred linking only; the README
  covers this gap against Branch and AppsFlyer.

## If you deploy this

Three things that actually cause incidents:

1. **Set `CLICK_TOKEN_SECRET` to a real random value** — `openssl rand -hex
   32`. The backend refuses to start without it, on purpose. Every `/claim`
   verification depends on it, so treat it as you would a signing key:
   never commit it, rotate it if exposed. Rotating invalidates outstanding
   tokens, so unclaimed clicks are lost — acceptable in an incident.
2. **Serve everything over HTTPS.** Click tokens travel to the client and
   back.
3. **Keep retention short.** Defaults to 30 days, and the retention job has
   to actually be scheduled — an unpruned click table is a growing pile of
   device fingerprints and the worst thing to lose in a breach. Check
   whether your jurisdiction's privacy law treats fingerprints and IPs as
   personal data; in most it does.

## Scope

**In scope:** anything in `packages/` — token forgery or replay, attribution
theft, injection, authentication and authorisation flaws, secret leakage.

**Out of scope:** the `examples/` apps and the hosted demo (deliberately
insecure conveniences — the mock backend holds state in memory and is
documented as not for production); vulnerabilities in your own fork or
deployment; and reports consisting only of automated scanner output with no
demonstrated impact.
