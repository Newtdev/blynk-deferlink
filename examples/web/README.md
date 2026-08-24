# examples/web

A minimal Vite + React app using `@blynk-deferlink/referral-web`. Two pages:

- **`/`** (`src/App.tsx`) — the real `ReferralLanding` component, wired up
  like a production landing page would be.
- **`/demo`** (`src/DemoPage.tsx`) — a live, interactive walkthrough of the
  recovery mechanism for people evaluating the SDK. Every request on this
  page hits the real backend at `VITE_API_ENDPOINT` — nothing is mocked.
  There's no real app to install for the demo, so this page plays the "app
  opening on a phone" part itself and lets you pick one of the three
  recovery methods, showing the actual request/response for each.

Local dev defaults to the mock backend (`http://localhost:8787/api`, see
`../mock-backend`); see `.env.production` for how the deployed build points
at the real backend instead.
