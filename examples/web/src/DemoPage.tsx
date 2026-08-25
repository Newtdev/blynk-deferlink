import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReferralProvider, ReferralLanding, useFingerprint } from '@blynk-deferlink/referral-web';

/**
 * A live walkthrough of the recovery mechanism for engineers evaluating the
 * SDK — not a mock. This isn't a custom-built simulation of the real flow;
 * it's three real pages backed by the actual production pieces:
 *
 *   /demo             — pick a referral code, get a real link
 *   /demo/referral/:code — the actual <ReferralLanding> component: real
 *                          countdown, real click registration, real
 *                          clipboard handoff timing — the same component
 *                          examples/web's own "/" route uses for real
 *                          visitors, just pointed at this demo's own
 *                          "app opened" screen instead of a real store
 *                          listing (blynk-deferlink hasn't published one
 *                          yet — swap androidStoreUrl/iosStoreUrl below for
 *                          the real ones once it has; nothing else here
 *                          needs to change).
 *   /demo/app          — recovers the code exactly how a real installed
 *                          app would: reads it off the Play referrer param
 *                          if present (Android, automatic), otherwise
 *                          checks the real clipboard (iOS, requires the tap
 *                          below — same gesture requirement a real
 *                          UIPasteControl has), falling back to a real
 *                          fingerprint match if nothing valid is there.
 *
 * No router dependency, matching the rest of this example app — see
 * main.tsx.
 */

const API_BASE = import.meta.env.VITE_API_ENDPOINT ?? 'http://localhost:8787/api';
const CLIPBOARD_PREFIX = 'deferlink_ref:v1:';
const CODE_PATTERN = /^[A-Za-z]+\d{4}$/;

interface ClaimApiResponse {
  success: boolean;
  reward?: { type: string; amount: number };
  error?: string;
}
interface MatchApiResponse {
  matched: boolean;
  referral_code: string | null;
  confidence?: number;
  token?: string;
  error?: string;
}

interface LogEntry {
  id: number;
  label: string;
  status: number;
  request: unknown;
  response: unknown;
}

interface Recovered {
  code: string;
  method: string;
  confidence: number | null;
  token: string | null;
}

function genCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let prefix = '';
  for (let i = 0; i < 3; i++) prefix += letters[Math.floor(Math.random() * letters.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}${digits}`;
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

export function DemoPage() {
  const path = window.location.pathname;
  const referralMatch = /^\/demo\/referral\/([^/]+)$/.exec(path);
  if (referralMatch) return <DemoLanding code={decodeURIComponent(referralMatch[1])} />;
  if (path === '/demo/app') return <DemoApp />;
  return <DemoSetup />;
}

function DemoSetup() {
  const [code, setCode] = useState(genCode);
  const valid = CODE_PATTERN.test(code);
  const link = `${window.location.origin}/demo/referral/${code}`;

  return (
    <div className="demo-root">
      <style>{CSS}</style>
      <a className="demo-back" href="/">
        ← back to the landing page
      </a>
      <h1>Try the real recovery flow</h1>
      <p className="demo-intro">
        This isn't a simulation of the real flow — it <em>is</em> the real flow.
        <code>/demo/referral/&lt;code&gt;</code> renders the actual production{' '}
        <code>&lt;ReferralLanding&gt;</code> component: real countdown, real click
        registration, real clipboard handoff. The only thing pointed somewhere
        different is the store redirect — blynk-deferlink hasn't published a real
        Play Store/App Store listing yet, so it lands you on this demo's own "app
        opened" screen instead, which recovers the code exactly how a real installed
        app would.
      </p>
      <p className="demo-note">
        To see the iOS-specific clipboard path, switch your browser to mobile device
        emulation (Chrome DevTools' device toolbar, for instance) or open the link on
        a real phone — platform is detected from the browser's real user agent, the
        same as it would be for any real visitor. There's no toggle here on purpose.
      </p>

      <section className="demo-stage">
        <label htmlFor="code-input">Referral code (letters, then exactly 4 digits)</label>
        <input
          id="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="REF1234"
        />
        {!valid && (
          <p className="demo-error">
            Needs at least one letter followed by exactly 4 digits — e.g. <code>REF1234</code>.
          </p>
        )}

        {valid && (
          <>
            <p className="demo-method-note">Your referral link — click it like a recipient would:</p>
            <a className="demo-link" href={link}>
              {link}
            </a>
          </>
        )}
      </section>
    </div>
  );
}

function DemoLanding({ code }: { code: string }) {
  const origin = window.location.origin;
  const config = useMemo(
    () => ({
      apiEndpoint: API_BASE,
      appScheme: 'myapp',
      // Required by ReferralConfig but ignored whenever *StoreUrl is set
      // (which it always is here) — never actually consulted.
      androidPackage: 'unused',
      iosAppId: 'unused',
      // No real store listing yet — see the top-of-file comment. Swap these
      // for the real URLs once one exists; ReferralLanding itself doesn't
      // change at all.
      androidStoreUrl: `${origin}/demo/app`,
      iosStoreUrl: `${origin}/demo/app`,
    }),
    [origin],
  );

  return (
    <ReferralProvider config={config}>
      <ReferralLanding
        referralCode={code}
        referrerName="Ada"
        title="You've been invited"
        subtitle="Sign up and get ₦500 bonus"
        ctaText="Download the app"
        onRedirect={(p) => console.log('demo redirect →', p)}
      />
    </ReferralProvider>
  );
}

function DemoApp() {
  const { collect } = useFingerprint();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [recovered, setRecovered] = useState<Recovered | null>(null);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reward, setReward] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const nextLogId = useRef(0);
  const androidChecked = useRef(false);
  // One stable device_id for this whole "app session" — the fingerprint
  // path's /match locks the click to whatever device_id that call used, and
  // /claim verifies the *same* device_id against that lock (see
  // docs/decisions.md #21/#22). A fresh crypto.randomUUID() per call here
  // would mismatch its own earlier match and always fail claim with
  // unverified_claim — found by actually running the fingerprint path
  // end-to-end, not by inspection.
  const [deviceId] = useState(() => crypto.randomUUID());

  const pushLog = useCallback(
    (entry: Omit<LogEntry, 'id'>) => setLog((l) => [...l, { ...entry, id: nextLogId.current++ }]),
    [],
  );

  // Android: the referrer param is already sitting in the URL the moment
  // this page loads — no gesture, no clipboard, fully automatic, exactly
  // like the real Play Install Referrer.
  useEffect(() => {
    if (androidChecked.current) return;
    androidChecked.current = true;
    const referrer = new URLSearchParams(window.location.search).get('referrer');
    if (!referrer) return;
    const parsed = new URLSearchParams(referrer);
    const code = parsed.get('code');
    const token = parsed.get('token');
    if (!code) return;
    setRecovered({ code, method: 'install_referrer', confidence: 100, token });
    pushLog({
      label: 'Play Install Referrer',
      status: 0,
      request: { referrer },
      response: { code, token: token ? '(present)' : null },
    });
    setChecked(true);
  }, [pushLog]);

  // iOS (and anyone else who lands here with no referrer param): checking
  // the clipboard needs a real tap, same as UIPasteControl needing a real
  // tap on a real device — a background check can't do this.
  const openApp = useCallback(async () => {
    setChecking(true);
    let clipboardText: string | null = null;
    try {
      clipboardText = (await navigator.clipboard?.readText?.()) ?? null;
    } catch (err) {
      pushLog({
        label: 'navigator.clipboard.readText()',
        status: 0,
        request: {},
        response: { error: String(err), note: 'denied, unsupported, or nothing to read' },
      });
    }

    if (clipboardText?.startsWith(CLIPBOARD_PREFIX)) {
      const [, , token] = clipboardText.slice(CLIPBOARD_PREFIX.length).split(':');
      pushLog({
        label: 'Clipboard read',
        status: 0,
        request: {},
        response: { payload: clipboardText, token: token ? '(present)' : null },
      });
      if (token) {
        // Mirrors ReferralService.applyClipboardCode(): a payload with no
        // token is treated as no code at all, since it could never clear
        // /claim anyway — straight to fingerprint matching instead.
        setRecovered({ code: clipboardText.split(':')[2], method: 'clipboard', confidence: null, token });
        setChecking(false);
        setChecked(true);
        return;
      }
    } else if (clipboardText) {
      pushLog({
        label: 'Clipboard read',
        status: 0,
        request: {},
        response: { payload: clipboardText, note: 'not a deferlink_ref:v1: payload — ignored' },
      });
    }

    // Nothing usable on the clipboard — fall back to a real fingerprint
    // match, same as a real app would. Same deviceId the whole component
    // uses, since /claim below must match whatever /match locked the click
    // to.
    const fp = collect();
    const matchBody = {
      device_id: deviceId,
      platform: 'ios' as const,
      fingerprint: {
        user_agent: fp.user_agent,
        screen_width: fp.screen_width,
        screen_height: fp.screen_height,
        timezone: fp.timezone,
        language: fp.language,
      },
    };
    const { status, data } = await post<MatchApiResponse>('/referral/match', matchBody);
    pushLog({ label: 'POST /referral/match — fingerprint fallback', status, request: matchBody, response: data });
    if (data.matched && data.referral_code && data.token) {
      setRecovered({ code: data.referral_code, method: 'fingerprint', confidence: data.confidence ?? null, token: data.token });
    } else {
      setRecovered(null);
    }
    setChecking(false);
    setChecked(true);
  }, [collect, pushLog, deviceId]);

  const doClaim = useCallback(async () => {
    if (!recovered?.token) {
      setClaimError('no_token — a code recovered without a valid token can never clear /claim.');
      return;
    }
    const body = {
      device_id: deviceId,
      platform: recovered.method === 'install_referrer' ? ('android' as const) : ('ios' as const),
      token: recovered.token,
      method: recovered.method,
    };
    const { status, data } = await post<ClaimApiResponse>('/referral/claim', body);
    pushLog({ label: 'POST /referral/claim', status, request: body, response: data });
    if (data.success) setReward(JSON.stringify(data.reward));
    else setClaimError(data.error ?? 'unknown error');
  }, [recovered, pushLog, deviceId]);

  const isAndroidFlow = new URLSearchParams(window.location.search).has('referrer');

  return (
    <div className="demo-root">
      <style>{CSS}</style>
      <h1>App opened</h1>
      <p className="demo-intro">This screen stands in for a real installed app's first launch.</p>

      <section className="demo-stage">
        {isAndroidFlow || checked ? (
          recovered ? (
            <>
              <p className="demo-method-note">
                Recovered <code>{recovered.code}</code> via <code>{recovered.method}</code>
                {recovered.confidence != null && <> (confidence {recovered.confidence})</>}
                {!recovered.token && ' — no token, so this can never clear /claim (matches production).'}
              </p>
              {reward ? (
                <p className="demo-method-note">✓ Claimed — reward: {reward}</p>
              ) : (
                <button onClick={doClaim} disabled={!recovered.token}>
                  Continue as new user
                </button>
              )}
              {claimError && <p className="demo-error">{claimError}</p>}
            </>
          ) : (
            <p className="demo-method-note">No code recovered — fingerprint match found nothing.</p>
          )
        ) : (
          <>
            <p className="demo-method-note">
              Tap below the same way you'd open a freshly installed app — this checks the real
              clipboard first (requires the tap, same as a real paste control), falling back to a
              real fingerprint match if nothing valid is there.
            </p>
            <button onClick={openApp} disabled={checking}>
              {checking ? 'Opening…' : 'Open app'}
            </button>
          </>
        )}
      </section>

      <a className="demo-back" href="/demo">
        ← restart with a new code
      </a>

      <details className="demo-log-details" open={logOpen} onToggle={(e) => setLogOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Under the hood — raw requests ({log.length})</summary>
        {log.map((entry) => (
          <pre key={entry.id} className="demo-log">
            {entry.label} → {entry.status || 'n/a'}
            {'\n'}request: {JSON.stringify(entry.request, null, 2)}
            {'\n'}response: {JSON.stringify(entry.response, null, 2)}
          </pre>
        ))}
      </details>
    </div>
  );
}

const CSS = `
.demo-root {
  max-width: 680px;
  margin: 0 auto;
  padding: 32px 20px 80px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #111827;
  line-height: 1.5;
}
.demo-back { color: #4338ca; text-decoration: none; font-size: 0.9rem; display: inline-block; margin-top: 12px; }
.demo-back:hover { text-decoration: underline; }
h1 { margin: 12px 0 4px; }
.demo-intro { color: #4b5563; margin-bottom: 12px; }
.demo-note { color: #6b7280; font-size: 0.85rem; margin-bottom: 20px; }
.demo-stage {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}
.demo-stage label { display: block; font-size: 0.85rem; color: #4b5563; margin-bottom: 6px; }
.demo-stage input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-family: monospace;
  font-size: 1rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}
.demo-method-note { color: #6b7280; font-size: 0.85rem; margin: 6px 0 0; }
.demo-error { color: #b91c1c; font-size: 0.85rem; margin: 4px 0 0; }
.demo-link {
  display: block;
  margin-top: 8px;
  padding: 10px 12px;
  background: #f3f4f6;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.85rem;
  color: #4338ca;
  word-break: break-all;
  text-decoration: none;
}
.demo-link:hover { text-decoration: underline; }
button {
  padding: 8px 14px;
  border: 1px solid #111827;
  border-radius: 6px;
  background: #111827;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}
button:disabled { opacity: 0.4; cursor: default; }
code { font-family: monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
.demo-log-details { margin-top: 8px; }
.demo-log-details summary { cursor: pointer; color: #4b5563; font-size: 0.85rem; }
.demo-log {
  background: #0b1021;
  color: #d1d5db;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 10px;
}
`;
