import { useCallback, useEffect, useRef, useState } from 'react';
import { useFingerprint, writeClipboardReferral } from '@blynk-deferlink/referral-web';

/**
 * A live walkthrough of the recovery mechanism for engineers evaluating the
 * SDK — not a mock. Every request below hits the real deployed backend (same
 * one the actual landing page at "/" uses). There's no real app to install
 * here, so this page stages the parts a real flow would have — the referral
 * link, the store listing, the app opening for the first time — as a wizard,
 * while the actual click/match/claim calls underneath are the genuine thing.
 * Only the "store" screen and the install delay are pure UI theater; nothing
 * in the recovery itself is faked.
 *
 * A click can only ever be claimed by one device (that's a real product
 * guarantee, not a demo limitation), so each run of the wizard starts a new
 * click.
 */

const API_BASE = import.meta.env.VITE_API_ENDPOINT ?? 'http://localhost:8787/api';
const CLIPBOARD_PREFIX = 'deferlink_ref:v1:';

type Platform = 'android' | 'ios';
type Stage = 'landing' | 'store' | 'opening' | 'result';

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
  id: number;
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

const STAGES: { key: Stage; label: string }[] = [
  { key: 'landing', label: 'Referral link' },
  { key: 'store', label: 'App store' },
  { key: 'opening', label: 'App opens' },
  { key: 'result', label: 'Recovered' },
];

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
  const [platform, setPlatform] = useState<Platform>('android');
  const [stage, setStage] = useState<Stage>('landing');
  const [code] = useState(genCode);
  const [clickToken, setClickToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<{ busy: boolean; outcome: Outcome | null }>({
    busy: false,
    outcome: null,
  });
  const openingStarted = useRef(false);

  const nextLogId = useRef(0);
  const pushLog = useCallback(
    (entry: Omit<LogEntry, 'id'>) => setLog((l) => [...l, { ...entry, id: nextLogId.current++ }]),
    [],
  );

  const tapLink = useCallback(async () => {
    setBusy('click');
    const body = { referral_code: code, fingerprint: collect() };
    try {
      const { status, data } = await post<ClickApiResponse>('/referral/click', body);
      pushLog({ label: 'POST /referral/click', status, request: body, response: data });
      if (data.success && data.token) {
        setClickToken(data.token);
        setStage('store');
      }
    } catch (err) {
      pushLog({ label: 'POST /referral/click', status: 0, request: body, response: { error: String(err) } });
    } finally {
      setBusy(null);
    }
  }, [code, collect, pushLog]);

  const installFromStore = useCallback(() => {
    setInstalling(true);
    setTimeout(() => {
      setInstalling(false);
      setStage('opening');
    }, 900);
  }, []);

  const finish = useCallback((method: string, confidence: number | null, data: ClaimApiResponse) => {
    setOutcome({ method, confidence, success: data.success, reward: data.reward, error: data.error });
    setStage('result');
  }, []);

  const recoverAndroid = useCallback(async () => {
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

  const writeIosClipboard = useCallback(async () => {
    if (!clickToken) return;
    await writeClipboardReferral(code, clickToken);
    pushLog({
      label: 'writeClipboardReferral()',
      status: 0,
      request: { code, token: clickToken },
      response: { note: 'written to your system clipboard — best-effort, no return value' },
    });
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

  // Kick off the platform-appropriate recovery the moment the "app opens" —
  // guarded against React 18's double-invoke in dev, since this makes a real
  // network call (Android) or writes the real clipboard (iOS).
  useEffect(() => {
    if (stage !== 'opening' || openingStarted.current) return;
    openingStarted.current = true;
    if (platform === 'android') recoverAndroid();
    else writeIosClipboard();
  }, [stage, platform, recoverAndroid, writeIosClipboard]);

  const tryFallback = useCallback(async () => {
    setFallback({ busy: true, outcome: null });
    const deviceId = crypto.randomUUID();
    const fp = collect();
    const matchBody = {
      device_id: deviceId,
      platform,
      fingerprint: {
        user_agent: fp.user_agent,
        screen_width: fp.screen_width,
        screen_height: fp.screen_height,
        timezone: fp.timezone,
        language: fp.language,
      },
    };
    const { status, data } = await post<MatchApiResponse>('/referral/match', matchBody);
    pushLog({ label: 'POST /referral/match — fallback scenario, no token', status, request: matchBody, response: data });
    if (!data.matched || !data.token) {
      setFallback({ busy: false, outcome: { method: 'fingerprint', confidence: data.confidence ?? null, success: false, error: 'no_match' } });
      return;
    }
    const claimBody = { device_id: deviceId, platform, token: data.token, method: 'fingerprint' as const };
    const { status: claimStatus, data: claimData } = await post<ClaimApiResponse>('/referral/claim', claimBody);
    pushLog({ label: 'POST /referral/claim — fallback fingerprint match', status: claimStatus, request: claimBody, response: claimData });
    setFallback({
      busy: false,
      outcome: { method: 'fingerprint', confidence: data.confidence ?? null, success: claimData.success, reward: claimData.reward, error: claimData.error },
    });
  }, [collect, pushLog, platform]);

  const restart = () => window.location.reload();

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="demo-root">
      <style>{CSS}</style>
      <a className="demo-back" href="/">
        ← back to the landing page
      </a>
      <h1>Live recovery demo</h1>
      <p className="demo-intro">
        This walks the real flow a referred user goes through: tap a link, land on the store,
        install, open the app, get matched back to the referrer. The link/store/install screens
        below are staged for this demo (there's no real app to install here) — but every
        click/match/claim call underneath hits the real deployed backend, unmocked.
      </p>

      <ol className="demo-steps">
        {STAGES.map((s, i) => {
          let status = '';
          if (i === stageIndex) status = 'active';
          else if (i < stageIndex) status = 'done';
          return (
            <li key={s.key} className={status}>
              {s.label}
            </li>
          );
        })}
      </ol>

      {stage === 'landing' && (
        <section className="demo-stage demo-landing">
          <div className="demo-platform-toggle">
            <button className={platform === 'android' ? 'toggle-on' : ''} onClick={() => setPlatform('android')}>
              Android
            </button>
            <button className={platform === 'ios' ? 'toggle-on' : ''} onClick={() => setPlatform('ios')}>
              iOS
            </button>
          </div>
          <div className="link-card">
            <p className="link-from">📲 A friend sent you an invite</p>
            <p className="link-code">
              Referral code: <code>{code}</code>
            </p>
            <button disabled={busy === 'click'} onClick={tapLink}>
              {busy === 'click' ? 'Opening link…' : 'Tap the invite link'}
            </button>
          </div>
        </section>
      )}

      {stage === 'store' && (
        <section className="demo-stage demo-store">
          <div className="store-card">
            <div className="store-icon">BD</div>
            <div className="store-meta">
              <p className="store-name">Blynk Deferlink Demo</p>
              <p className="store-sub">
                {platform === 'android' ? 'Google Play' : 'App Store'} · ★★★★☆ · Free
              </p>
            </div>
            <button disabled={installing} onClick={installFromStore}>
              {installing ? 'Installing…' : 'Install'}
            </button>
          </div>
          <p className="demo-method-note">
            The link carried your referral through to here — real deferred deep linking has to
            survive exactly this hop, since the store app has no idea a referral code exists.
          </p>
        </section>
      )}

      {stage === 'opening' && (
        <section className="demo-stage demo-opening">
          <p className="opening-splash">Opening app…</p>
          {platform === 'android' && <p className="demo-method-note">Checking the Play Install Referrer — deterministic, no round trip needed to find it.</p>}
          {platform === 'ios' && (
            <div className="demo-paste">
              <p className="demo-method-note">
                The token was just written to your real clipboard via the same production function
                the SDK uses. Your app would read this automatically on a real device; browsers
                require an explicit paste, so do that here to see the exact wire payload.
              </p>
              <label htmlFor="paste-input">Paste (⌘V / Ctrl+V):</label>
              <input
                id="paste-input"
                type="text"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="deferlink_ref:v1:…"
              />
              <button disabled={busy === 'ios' || !pasted} onClick={submitPaste}>
                Submit paste
              </button>
              {pasteError && <p className="demo-error">{pasteError}</p>}
            </div>
          )}
        </section>
      )}

      {stage === 'result' && outcome && (
        <section className="demo-stage demo-result">
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
              ✓ matched back to the referrer — reward: <code>{JSON.stringify(outcome.reward)}</code>
            </p>
          ) : (
            <p>✗ not matched — {outcome.error}</p>
          )}

          <div className="demo-fallback">
            {fallback.outcome ? (
              <p className="demo-method-note">
                Without a token: {fallback.outcome.success ? '✓ still matched' : '✗ not matched'} via{' '}
                <code>fingerprint</code>
                {fallback.outcome.confidence !== null && <> (confidence {fallback.outcome.confidence})</>} — this
                simulates click and app-open from the same browser, so the score may look more
                confident than a real cross-app match would.
              </p>
            ) : (
              <button className="demo-secondary" disabled={fallback.busy} onClick={tryFallback}>
                {fallback.busy ? 'Trying…' : 'What if the token never arrived? Try the fallback →'}
              </button>
            )}
          </div>

          <button onClick={restart}>Start over</button>
        </section>
      )}

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
.demo-back { color: #4338ca; text-decoration: none; font-size: 0.9rem; }
.demo-back:hover { text-decoration: underline; }
h1 { margin: 12px 0 4px; }
.demo-intro { color: #4b5563; margin-bottom: 20px; }
.demo-steps {
  display: flex;
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
  gap: 4px;
  font-size: 0.8rem;
  color: #9ca3af;
}
.demo-steps li {
  flex: 1;
  text-align: center;
  padding-bottom: 8px;
  border-bottom: 3px solid #e5e7eb;
}
.demo-steps li.active { color: #111827; font-weight: 600; border-color: #111827; }
.demo-steps li.done { color: #4b5563; border-color: #9ca3af; }
.demo-stage {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}
.demo-platform-toggle { display: flex; gap: 8px; margin-bottom: 16px; }
.demo-platform-toggle button {
  background: #fff;
  color: #111827;
  border: 1px solid #d1d5db;
  font-weight: 500;
}
.demo-platform-toggle button.toggle-on { background: #111827; color: #fff; border-color: #111827; }
.link-card { text-align: center; }
.link-from { font-size: 1.05rem; margin-bottom: 4px; }
.link-code { color: #4b5563; margin-bottom: 16px; }
.store-card { display: flex; align-items: center; gap: 14px; }
.store-icon {
  width: 56px; height: 56px; border-radius: 12px; flex-shrink: 0;
  background: linear-gradient(135deg, #6366f1, #4338ca);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 1.1rem;
}
.store-meta { flex: 1; }
.store-name { font-weight: 600; margin: 0; }
.store-sub { color: #6b7280; font-size: 0.85rem; margin: 2px 0 0; }
.demo-opening { text-align: center; }
.opening-splash { font-size: 1.1rem; font-weight: 600; margin-bottom: 8px; }
.demo-method-note { color: #6b7280; font-size: 0.85rem; margin: 6px 0 0; }
.demo-paste { display: flex; flex-direction: column; gap: 6px; align-items: center; margin-top: 12px; }
.demo-paste input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-family: monospace; }
.demo-error { color: #b91c1c; font-size: 0.85rem; margin: 4px 0 0; }
.demo-result p { margin: 6px 0; }
.demo-fallback { margin: 14px 0; }
.demo-secondary {
  background: #fff; color: #4338ca; border: 1px solid #c7d2fe; font-weight: 500;
}
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
