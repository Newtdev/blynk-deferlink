# Contributing

Thanks for considering a contribution. This is a small monorepo (two
backends, a web SDK, a mobile SDK, and runnable examples) with a fair
amount of non-obvious design behind it — reading a bit before diving in
will save you time.

## Read this first

[`docs/decisions.md`](docs/decisions.md) is the running log of *why* the
code works the way it does — not a changelog, the reasoning. Before
changing behavior in fingerprint matching, the claim flow, rate limiting,
or anything that looks like it could be simplified, check whether it's
already been tried and rejected there. Several things that look like bugs
on first read (a graduated recency score instead of a hard IP match, a
signed token instead of trusting the request body, no client-side
persistence in the mobile SDK) are deliberate, and the entry explaining
why is usually one `Ctrl+F` away.

If you're setting up a specific package for the first time rather than
browsing the whole repo, [`docs/integration/`](docs/integration/) has a
step-by-step guide per package with a verification step at the end.

## Setup

```bash
npm install                 # links packages/* workspaces, installs example deps
composer install --working-dir=packages/referral-sdk   # PHP backend only, if you're touching it
```

Two backends exist with the same API contract — you generally only need
one running to work on the web/mobile SDKs:

```bash
npm run backend              # zero-dependency mock backend, no DB needed
npm run backend:node-sdk     # the real Node backend (needs Postgres — see its integration guide)
```

## Tests

```bash
# Node backend
npm --workspace @blynk-deferlink/referral-sdk-node run test
npm --workspace @blynk-deferlink/referral-sdk-node run typecheck

# Mobile SDK
npm --workspace @blynk-deferlink/referral-mobile run test
npm --workspace @blynk-deferlink/referral-mobile run typecheck

# Web SDK
npm --workspace @blynk-deferlink/referral-web run test
npm --workspace @blynk-deferlink/referral-web run typecheck

# PHP backend — no PHPUnit runner assumed; both work
composer test --working-dir=packages/referral-sdk        # vendor/bin/phpunit, if installed
php packages/referral-sdk/tests/run.php                   # zero-dependency scoring check
```

If you touch `FingerprintMatcher`'s scoring in either backend, also run
the parity fixture (`docs/fixtures/fingerprint-match-cases.json`) against
*both* backends before opening a PR — it exists specifically because the
two implementations have drifted from each other before, silently, and
neither language's test suite alone caught it.

## Making a change

- Small, focused PRs over large ones — easier to review, easier to
  bisect later.
- If the change is behavioral (not just docs/tests), add a
  `docs/decisions.md` entry: the problem, the decision, and what was
  actually implemented. Future contributors (including future you)
  shouldn't have to reverse-engineer *why* from a diff.
- Match the existing comment density and voice — comments here tend to
  explain *why*, not restate *what* the code already says.
- For anything touching the claim flow, token signing, or device
  matching: this is the security-sensitive core of the project. Changes
  there should come with a clear threat-model explanation of what they
  fix or don't regress, and ideally a test that would have caught the
  issue before the fix.

## Verifying before you open a PR

- `typecheck` and the relevant test suite(s), at minimum.
- For anything database-adjacent in the Node backend, don't just trust a
  successful `db:push` — a schema change that looked deployed but hadn't
  actually reached the database has happened before in this project's
  history. Query it directly if you're touching schema.
- If you changed a README or one of the integration guides, click every
  link you added and confirm it resolves — broken relative links in docs
  are an easy, easy-to-miss mistake.

## Reporting a bug vs. asking a question

Open an issue for either — there's no separate discussion forum. For
anything that might be a security issue specifically (a way to forge a
claim, bypass rate limiting, or read another device's data), please don't
open a public issue; see `SECURITY.md` if one exists, or otherwise flag it
privately to a maintainer first.
