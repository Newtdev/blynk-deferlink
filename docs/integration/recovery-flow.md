# Recovery paths

How a referral code survives the gap between a tapped link and a first
app launch — four recovery paths across two platforms, converging on one
backend and one claim. This is the detailed version of the flow summarized
in [`README.md`](README.md#the-flow-these-four-pieces-implement-together).

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TD
    A["① Share link tapped"] --> B["② Landing page (referral-web)<br/>POST /click {referral_code, fingerprint}"]
    B --> C["③ Backend stores click<br/>signs token: click_id.expiry.hmac"]
    C --> D1[Android]
    C --> D2[iOS]

    subgraph android [ANDROID]
        D1 --> E1["Token embedded in Play Store referrer param"]
        E1 --> F1["App installed"]
        F1 --> G1{"Install Referrer<br/>returns code + token?"}
        G1 -->|"yes · ~100% of real installs"| H1["<b>DETERMINISTIC</b><br/>method: install_referrer<br/>fully local · no network call"]
        G1 -->|"no · empty / sideload"| M
    end

    subgraph ios [iOS]
        D2 --> E2["Token + code written to clipboard,<br/>right before store redirect"]
        E2 --> F2["App installed"]
        F2 -->|"automatic, every launch"| G2["Fingerprint collected,<br/>sent to Match Engine"]
        G2 --> M
        F2 -.->|"optional · explicit tap"| G3{"User taps<br/>&lt;ReferralPasteButton&gt;?"}
        G3 -->|yes| H2["<b>DETERMINISTIC</b><br/>method: clipboard<br/>fully local · overrides match result"]
        G3 -.->|"not tapped"| G2
    end

    M["Backend Match Engine<br/>scores fingerprint vs. recent unmatched clicks<br/>(IP · device · screen · timezone · language · recency)"] --> N{"score ≥ min_confidence<br/>(default 70)?"}
    N -->|yes| O1["<b>PROBABILISTIC</b><br/>method: fingerprint<br/>click locked to device, atomically"]
    N -->|no| O2["No match<br/>code: null"]

    H1 --> P["④ code + token ready<br/>(or a manual code, no token, if unmatched)"]
    H2 --> P
    O1 --> P
    O2 -.->|"manual code entry fallback"| P

    P --> Q["⑤ Code pre-fills signup"]
    Q --> R["⑥ POST /claim {device_id, token, method}"]
    R --> S["Backend verifies signature, expiry, device lock"]
    S --> T["⑦ Conversion recorded, reward distributed"]

    classDef det stroke-width:3px
    classDef prob stroke-dasharray: 6 3
    classDef nomatch stroke-dasharray: 1 3
    class H1,H2 det
    class O1 prob
    class O2 nomatch
```

A share link is registered as a click and signed once, for free. Android
and iOS then recover it through different means — the same
deterministic/probabilistic split repeats on both, but which one is the
*default* differs: Android's deterministic path runs automatically, iOS's
needs an explicit tap. Every path — however the code was recovered —
converges on the same claim step before a reward is ever paid out.

## The four paths

### Android · deterministic · `install_referrer`

The default, automatic path — no user action needed beyond installing the
app.

- Code + signed token ride in the Play Install Referrer string, set at
  store-redirect time.
- Read once on first launch, entirely on-device — no network call to
  recover it.
- Reliable near-100% of real installs; only empty on a sideload or a
  referrer Play strips.

### Android · probabilistic · `fingerprint` (fallback)

Only reached if the Install Referrer comes back empty.

- Same scoring engine as iOS's automatic path — one backend, shared code.
- Scores IP, device/OS, screen, timezone, language, and click recency
  against unmatched clicks.
- Needs ≥ 70/100 to count as a match; the winning click locks to the
  device atomically.

### iOS · deterministic · `clipboard`

The stronger path, but not automatic — Apple's paste APIs require an
explicit tap.

- Code + token written to the system clipboard right before the App
  Store redirect.
- Only readable from a real user gesture on `<ReferralPasteButton>` — no
  auto-run.
- Overrides whatever the automatic fingerprint match already found, if
  it's tapped.

### iOS · probabilistic · `fingerprint` (default)

iOS's only fully automatic path — Apple exposes nothing
install-referrer-equivalent.

- Fires on every first launch, no user action required.
- Safari's UA never exposes device model, so the "device" signal
  collapses to OS family + version.
- Accepted trade-off behind an observed ~85–90% iOS match rate.

## The proof that makes both local-only paths possible

Every recovered code carries a signed proof (`click_id.expiry.hmac`),
minted once at `/click` — this is what lets the two deterministic paths
stay genuinely network-free at recovery time, and what `/claim` verifies
before any reward is paid out. A code with no valid token behind it
(including one a user typed in by hand) can reach signup, but can never
clear `/claim` — see [`docs/decisions.md`](../decisions.md) #21/#22 for
the full reasoning behind why this replaced an earlier redeem-round-trip
design.
