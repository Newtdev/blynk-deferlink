/**
 * Privacy policy for the Blynk Recovery Demo app (Play Console requires a
 * URL for this — see docs/play-console-checklist.md). Plain-language,
 * specific to what this demo actually does — not a generic boilerplate
 * policy, since the whole point is that this project is small enough to
 * read honestly.
 */
export function PrivacyPage() {
  return (
    <div className="privacy-root">
      <style>{CSS}</style>
      <a className="privacy-back" href="/">
        ← back
      </a>
      <h1>Privacy policy — Blynk Recovery Demo</h1>
      <p className="privacy-updated">Last updated: August 2026.</p>

      <p>
        This page covers the <strong>Blynk Recovery Demo</strong> Android app and the{' '}
        <a href="/demo">/demo</a> web page — both exist to demonstrate{' '}
        <a href="https://github.com/Newtdev/blynk-deferlink">blynk-deferlink</a>, an open-source
        deferred deep linking / referral SDK. Neither is a consumer product; there's no account,
        no login, and nothing here is sold or shared with anyone.
      </p>

      <h2>What's collected</h2>
      <p>
        <strong>Android app:</strong> a device identifier from{' '}
        <code>react-native-device-info</code>'s <code>getUniqueId()</code> — on Android this is
        derived from <code>Settings.Secure.ANDROID_ID</code>, a semi-persistent identifier tied to
        this app plus your device (not your Google account, and not the Android Advertising ID).
        It resets if you uninstall and reinstall the app in most cases. Alongside it: device model,
        OS version, screen size, timezone, and language.
      </p>
      <p>
        <strong>Web demo (/demo):</strong> a random id generated fresh in your browser each time
        you use the page — never tied to your device across visits.
      </p>
      <p>
        Both also send your <strong>IP address</strong>, read server-side from the request, used
        only for matching.
      </p>
      <p>
        That's the same class of data any deferred-deep-linking SDK (Branch, AppsFlyer, etc.)
        collects to do this job — it's what makes the probabilistic recovery path work when the
        deterministic one (Android's Install Referrer) isn't available.
      </p>

      <h2>What's not collected</h2>
      <p>
        No names, emails, contacts, photos, location, or any other app on your device. No
        analytics SDKs, no ad tracking, no third-party sharing of any kind.
      </p>

      <h2>Retention</h2>
      <p>
        Click and match records age out automatically after a configured retention window (the
        same cleanup job the SDK ships for any real deployment — see{' '}
        <a href="https://github.com/Newtdev/blynk-deferlink/blob/main/docs/decisions.md">
          docs/decisions.md
        </a>{')'}
        . Nothing is kept indefinitely.
      </p>

      <h2>Source</h2>
      <p>
        This demo runs the actual open-source backend and SDKs, unmodified — you can read exactly
        what happens to a request before it's sent:{' '}
        <a href="https://github.com/Newtdev/blynk-deferlink">github.com/Newtdev/blynk-deferlink</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this demo or its data handling — open an issue on the{' '}
        <a href="https://github.com/Newtdev/blynk-deferlink/issues">GitHub repo</a>.
      </p>
    </div>
  );
}

const CSS = `
.privacy-root {
  max-width: 680px;
  margin: 0 auto;
  padding: 32px 20px 80px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #111827;
  line-height: 1.6;
}
.privacy-back { color: #4338ca; text-decoration: none; font-size: 0.9rem; }
.privacy-back:hover { text-decoration: underline; }
h1 { margin: 12px 0 4px; font-size: 1.5rem; }
.privacy-updated { color: #6b7280; font-size: 0.85rem; margin-bottom: 24px; }
h2 { font-size: 1.05rem; margin: 28px 0 8px; }
ul { padding-left: 20px; }
li { margin-bottom: 4px; }
a { color: #4338ca; }
`;
