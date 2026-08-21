# Recovery paths

How a referral code survives the gap between a tapped link and a first
app launch. Deterministic and probabilistic recovery are two separate
mechanisms, not two branches of one path — shown here as two diagrams,
both starting at the same click and ending at the same claim. This is
the detailed version of the flow summarized in
[`README.md`](README.md#the-flow-these-four-pieces-implement-together).

## Deterministic recovery

Android's default path, and iOS's opt-in path — both read a code and
proof entirely on-device, no network call. Neither touches fingerprint
matching at all.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TD
    A["Share link tapped"] --> B["Landing page (referral-web)<br/>POST /click"]
    B --> C["Backend stores click, signs token<br/>click_id.expiry.hmac"]
    C --> D1[Android]
    C --> D2[iOS]

    subgraph android [ANDROID]
        D1 --> E1["Token embedded in Play Store referrer param"]
        E1 --> F1["App installed"]
        F1 --> G1{"Install Referrer has<br/>code + token?"}
        G1 -->|yes| H1["<b>method: install_referrer</b><br/>read fully locally, no network call"]
        G1 -.->|"no"| X1["see Probabilistic diagram"]
    end

    subgraph ios [iOS]
        D2 --> E2["Token + code written to clipboard,<br/>right before store redirect"]
        E2 --> F2["App installed"]
        F2 --> G2{"User taps<br/>&lt;ReferralPasteButton&gt;?"}
        G2 -->|yes| H2["<b>method: clipboard</b><br/>read fully locally, no network call<br/>overrides an automatic match, if tapped"]
        G2 -.->|"not tapped (default)"| X2["see Probabilistic diagram"]
    end

    H1 --> P["code + token ready"]
    H2 --> P
    P --> Q["Pre-fills signup<br/>POST /claim {device_id, token, method}"]
    Q --> R["Verified → conversion recorded<br/>reward distributed"]

    classDef ghost fill:transparent,stroke-dasharray: 2 3,color:#888
    class X1,X2 ghost
```

## Probabilistic recovery

Reached only when the deterministic path above didn't run or didn't have
anything to read — a scored guess, backed by the same signed token once
it succeeds. Both platforms feed the same scoring engine; this is the one
piece of matching logic that isn't platform-specific at all.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TD
    A["Share link tapped"] --> B["Landing page (referral-web)<br/>POST /click"]
    B --> C["Backend stores click, signs token<br/>click_id.expiry.hmac"]
    C --> D1[Android]
    C --> D2[iOS]

    subgraph android [ANDROID]
        D1 --> E1["Install Referrer empty or sideload<br/><i>fallback only — see Deterministic</i>"]
    end

    subgraph ios [iOS]
        D2 --> E2["Automatic, every launch, no gesture required<br/><i>iOS's default recovery attempt</i>"]
    end

    E1 --> M["<b>Match Engine</b><br/>scores fingerprint vs. recent unmatched clicks<br/>IP · device · screen · timezone · language · recency"]
    E2 --> M
    M --> N{"score ≥ min_confidence<br/>(default 70)?"}
    N -->|yes| O1["<b>method: fingerprint</b><br/>click locked to device, atomically"]
    N -.->|no| O2["No match<br/>code: null — manual entry fallback"]

    O1 --> P["code + token ready<br/>(or a manual code, no token, on no match)"]
    O2 -.-> P
    P --> Q["Pre-fills signup<br/>POST /claim {device_id, token, method}"]
    Q --> R["Verified → conversion recorded<br/>reward distributed"]

    classDef nomatch stroke-dasharray: 2 3
    class O2 nomatch
```

## Reliability

- **Deterministic** — Android: ~100% of real installs. iOS: requires an
  explicit tap, so coverage depends entirely on whether
  `<ReferralPasteButton>` is rendered and tapped.
- **Probabilistic** — an observed ~85–90% match rate on iOS, where it's
  the default; lower priority on Android, where it's a fallback of last
  resort.

## The proof that makes both deterministic paths possible

Every recovered code carries a signed proof (`click_id.expiry.hmac`),
minted once at `/click` — this is what lets both deterministic paths
stay genuinely network-free at recovery time, and what `/claim` verifies
before any reward is paid out. A code with no valid token behind it
(including one a user typed in by hand) can reach signup, but can never
clear `/claim` — see [`docs/decisions.md`](../decisions.md) #21/#22 for
the full reasoning behind why this replaced an earlier redeem-round-trip
design.
