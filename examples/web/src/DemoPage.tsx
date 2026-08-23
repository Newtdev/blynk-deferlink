import { useCallback, useState } from 'react';
import { useFingerprint, writeClipboardReferral } from '@blynk-deferlink/referral-web';

/**
 * A live walkthrough of the recovery mechanism for engineers evaluating the
 * SDK — not a mock. Every request on this page hits the real deployed
 * backend (same one the actual landing page at "/" uses). There's no real
 * app to install here, so this page plays the "app opening on a phone"
 * part itself: it registers a real click, then lets you pick one of the
 * three real recovery methods and watch the actual request/response.
 *
 * A click can only ever be claimed by one device (that's a real product
 * guarantee, not a demo limitation) — so picking one recovery path locks
 * the click; register a new one to try another.
 */

const API_BASE = import.meta.env.VITE_API_ENDPOINT ?? 'http://localhost:8787/api';
const CLIPBOARD_PREFIX = 'deferlink_ref:v1:';

interface ClickApiResponse {
  success: boolean;
  click_id?: string;
  token?: string;
  error?: string;
}
interface MatchApiResponse {
  matched: boolean;
  referral_code: string | null;
  click_id?: string;
  token?: string;
  confidence?: number;
  match_method?: string;
  error?: string;
}
interface ClaimApiResponse {
  success: boolean;
  reward?: { type: string; amount: number };
  error?: string;
}

interface LogEntry {
  label: string;
  status: number;
  request: unknown;
  response: unknown;
}

interface Outcome {
  method: string;
  confidence: number | null;
  success: boolean;
  reward?: { type: string; amount: number };
  error?: string;
}

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `DEMO-${s}`;
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
  const { collect } = useFingerprint();
  const [code] = useState(genCode);
  const [clickToken, setClickToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [awaitingPaste, setAwaitingPaste] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const pushLog = useCallback((entry: LogEntry) => setLog((l) => [...l, entry]), []);

  const registerClick = useCallback(async () => {
    setBusy('click');
    const body = { referral_code: code, fingerprint: collect() };
    try {
      const { status, data } = await post<ClickApiResponse>('/referral/click', body);
      pushLog({ label: 'POST /referral/click', status, request: body, response: data });
      if (data.success && data.token) setClickToken(data.token);
    } catch (err) {
      pushLog({ label: 'POST /referral/click', status: 0, request: body, response: { error: String(err) } });
    } finally {
      setBusy(null);
    }
  }, [code, collect, pushLog]);

  const finish = useCallback(
    (method: string, confidence: number | null, data: ClaimApiResponse) => {
      setOutcome({ method, confidence, success: data.success, reward: data.reward, error: data.error });
      setLocked(true);
    },
    [],
  );

  const simulateAndroid = useCallback(async () => {
    if (!clickToken) return;
    setBusy('android');
    const body = {
      device_id: crypto.randomUUID(),
      platform: 'android' as const,
      token: clickToken,
      method: 'install_referrer' as const,
    };
    try {
      const { status, data } = await post<ClaimApiResponse>('/referral/claim', body);
      pushLog({ label: 'POST /referral/claim — Android, deterministic', status, request: body, response: data });
      finish('install_referrer', data.success ? 100 : null, data);
    } finally {
      setBusy(null);
    }
  }, [clickToken, pushLog, finish]);

  const startIos = useCallback(async () => {
    if (!clickToken) return;
    setBusy('ios');
    await writeClipboardReferral(code, clickToken);
    pushLog({
      label: 'writeClipboardReferral()',
      status: 0,
      request: { code, token: clickToken },
      response: { note: 'written to your system clipboard — best-effort, no return value' },
    });
    setAwaitingPaste(true);
    setBusy(null);
  }, [code, clickToken, pushLog]);

  const submitPaste = useCallback(async () => {
    if (!pasted.startsWith(CLIPBOARD_PREFIX)) {
      setPasteError(`Doesn't look like a referral payload — expected it to start with "${CLIPBOARD_PREFIX}".`);
      return;
    }
    const [, , token] = pasted.slice(CLIPBOARD_PREFIX.length).split(':');
    if (!token) {
      setPasteError('No token in the pasted payload — clipboard write may have raced the click registration.');
      return;
    }
    setPasteError(null);
    setBusy('ios');
    const body = { device_id: crypto.randomUUID(), platform: 'ios' as const, token, method: 'clipboard' as const };
    try {
      const { status, data } = await post<ClaimApiResponse>('/referral/claim', body);
      pushLog({ label: 'POST /referral/claim — iOS, deterministic via clipboard', status, request: body, response: data });
      finish('clipboard', data.success ? 100 : null, data);
    } finally {
      setBusy(null);
    }
  }, [pasted, pushLog, finish]);

  const simulateFingerprint = useCallback(async () => {
    setBusy('fingerprint');
    const deviceId = crypto.randomUUID();
    const fp = collect();
    const matchBody = {
      device_id: deviceId,
      platform: 'android' as const,
      fingerprint: {
        user_agent: fp.user_agent,
        screen_width: fp.screen_width,
        screen_height: fp.screen_height,
        timezone: fp.timezone,
        language: fp.language,
      },
    };
    try {
      const { status, data } = await post<MatchApiResponse>('/referral/match', matchBody);
      pushLog({ label: 'POST /referral/match — no token, fingerprint only', status, request: matchBody, response: data });
      if (!data.matched || !data.token) {
        setOutcome({ method: 'fingerprint', confidence: data.confidence ?? null, success: false, error: 'no_match' });
        setLocked(true);
        return;
      }
      const claimBody = { device_id: deviceId, platform: 'android' as const, token: data.token, method: 'fingerprint' as const };
      const { status: claimStatus, data: claimData } = await post<ClaimApiResponse>('/referral/claim', claimBody);
      pushLog({ label: 'POST /referral/claim — fingerprint match', status: claimStatus, request: claimBody, response: claimData });
      finish('fingerprint', data.confidence ?? null, claimData);
    } finally {
      setBusy(null);
    }
  }, [collect, pushLog, finish]);

  return (
    <div className="demo-root">
      <style>{CSS}</style>
      <a className="demo-back" href="/">
        ← back to the landing page
      </a>
      <h1>Live recovery demo</h1>
      <p className="demo-intro">
        Every request below hits the real deployed backend — nothing here is mocked. There's no
        real app to install for this demo, so this page plays the "app opening on a phone" part
        itself. Pick one recovery method after registering a click; a click can only ever be
        claimed by one device, so the other two buttons lock once you've picked one — that's a
        real guarantee, not a demo restriction.
      </p>

      <section className="demo-step">
        <h2>1. Register a click</h2>
        <p>
          Referral code: <code>{code}</code>
        </p>
        <button disabled={busy === 'click' || !!clickToken} onClick={registerClick}>
          {clickToken ? 'Click registered' : busy === 'click' ? 'Registering…' : 'Click my referral link'}
        </button>
      </section>

      {clickToken && (
        <section className="demo-step">
          <h2>2. Simulate the app opening</h2>
          <div className="demo-buttons">
            <div className="demo-method">
              <button disabled={locked || busy === 'android'} onClick={simulateAndroid}>
                {busy === 'android' ? 'Opening…' : 'Simulate Android open'}
              </button>
              <p className="demo-method-note">
                Deterministic — the Play Install Referrer hands the app this token automatically,
                no network round trip needed to find it.
              </p>
            </div>

            <div className="demo-method">
              {!awaitingPaste ? (
                <button disabled={locked || busy === 'ios'} onClick={startIos}>
                  {busy === 'ios' ? 'Opening…' : 'Simulate iOS open'}
                </button>
              ) : (
                <div className="demo-paste">
                  <label htmlFor="paste-input">Paste (⌘V / Ctrl+V) to see what your app would read:</label>
                  <input
                    id="paste-input"
                    type="text"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="deferlink_ref:v1:…"
                  />
                  <button disabled={locked || busy === 'ios' || !pasted} onClick={submitPaste}>
                    Submit paste
                  </button>
                  {pasteError && <p className="demo-error">{pasteError}</p>}
                </div>
              )}
              <p className="demo-method-note">
                Deterministic — the token was just written to your real clipboard via the same
                production function the SDK uses. Paste to read back the exact wire payload.
              </p>
            </div>

            <div className="demo-method">
              <button disabled={locked || busy === 'fingerprint'} onClick={simulateFingerprint}>
                {busy === 'fingerprint' ? 'Opening…' : 'Simulate fresh install, no token'}
              </button>
              <p className="demo-method-note">
                Probabilistic — deliberately withholds the token and asks the backend to score a
                match by fingerprint alone. Since this simulates click and app-open from the same
                browser, the score may look more confident than a real cross-app match would.
              </p>
            </div>
          </div>
        </section>
      )}

      {outcome && (
        <section className="demo-step demo-result">
          <h2>3. Result</h2>
          <p>
            method: <code>{outcome.method}</code>
            {outcome.confidence !== null && (
              <>
                {' · '}confidence: <code>{outcome.confidence}</code>
              </>
            )}
          </p>
          {outcome.success ? (
            <p>
              ✓ claimed — reward: <code>{JSON.stringify(outcome.reward)}</code>
            </p>
          ) : (
            <p>✗ not claimed — {outcome.error}</p>
          )}
          <button onClick={() => window.location.reload()}>Register a new click, try another path</button>
        </section>
      )}

      {log.length > 0 && (
        <section className="demo-step">
          <h2>Raw requests</h2>
          {log.map((entry, i) => (
            <pre key={i} className="demo-log">
              {entry.label} → {entry.status || 'n/a'}
              {'\n'}request: {JSON.stringify(entry.request, null, 2)}
              {'\n'}response: {JSON.stringify(entry.response, null, 2)}
            </pre>
          ))}
        </section>
      )}
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
.demo-back { color: #4338ca; text-decoration: none; font-size: 0.9rem; }
.demo-back:hover { text-decoration: underline; }
h1 { margin: 12px 0 4px; }
.demo-intro { color: #4b5563; margin-bottom: 28px; }
.demo-step {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.demo-step h2 { margin: 0 0 10px; font-size: 1rem; }
.demo-buttons { display: flex; flex-direction: column; gap: 16px; }
.demo-method { border-top: 1px solid #e5e7eb; padding-top: 14px; }
.demo-method:first-child { border-top: none; padding-top: 0; }
.demo-method-note { color: #6b7280; font-size: 0.85rem; margin: 6px 0 0; }
.demo-paste { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.demo-paste input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-family: monospace; }
.demo-error { color: #b91c1c; font-size: 0.85rem; margin: 4px 0 0; }
.demo-result p { margin: 6px 0; }
button {
  padding: 8px 14px;
  border: 1px solid #111827;
  border-radius: 6px;
  background: #111827;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
button:disabled { opacity: 0.4; cursor: default; }
code { font-family: monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
.demo-log {
  background: #0b1021;
  color: #d1d5db;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
}
`;
