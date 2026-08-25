import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ReferralProvider,
  ReferralService,
  ReferralPasteButton,
  collectFingerprint,
  useReferralCode,
  type ReferralConfig,
} from '@blynk-deferlink/referral-mobile';

// Local dev talks to the mock backend (`npm run backend`, see the root
// README's "Quick start"); on a physical device `localhost` won't reach
// your machine, so use your computer's LAN IP there instead. A release
// build (`__DEV__` false — this is what ships to Play Console's Internal
// Testing track) points at the real deployed backend instead, so a
// tester installing this from the Play Store sees a genuine recovery,
// not a dead endpoint. See docs/integration/referral-sdk.md or
// referral-sdk-node.md for pointing this at your own backend instead.
const API = __DEV__ ? 'http://localhost:8787/api' : 'https://referral-sdk-node.vercel.app/api';

const config: ReferralConfig = {
  apiEndpoint: API,
  appScheme: 'myapp',
  onCodeFound: (code, method) => console.log('onCodeFound', code, method),
  onNoCode: () => console.log('onNoCode'),
};

const STAGES = [
  { key: 'link', label: 'Link' },
  { key: 'store', label: 'Store' },
  { key: 'opening', label: 'Opens' },
  { key: 'result', label: 'Recovered' },
] as const;
type Stage = (typeof STAGES)[number]['key'];

export default function App() {
  return (
    <ReferralProvider config={config}>
      <SafeAreaView style={styles.safe}>
        <Screen />
      </SafeAreaView>
    </ReferralProvider>
  );
}

interface DemoResult {
  code: string;
  method: string;
  confidence: number | null;
}

function Screen() {
  // The production entry point — a signup screen would use exactly this.
  // It recovers automatically on mount, same as a real app would at launch;
  // since no click exists yet the first time this screen mounts, it
  // correctly shows "none yet" until the wizard below registers one.
  const { code, method, confidence, loading, claim, onClipboardCode } = useReferralCode();

  const service = useMemo(() => new ReferralService(config), []);
  const [log, setLog] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>('link');
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [reward, setReward] = useState<string | null>(null);
  const openingStarted = useRef(false);

  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev]);

  // Step 1: pretend the user tapped the invite link in a browser. We store a
  // click carrying this device's own signature so the later match scores 100.
  const tapLink = async () => {
    const fp = await collectFingerprint();
    const ua =
      fp.platform === 'ios'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)'
        : 'Mozilla/5.0 (Linux; Android 14; Pixel 7)';
    try {
      const res = await fetch(`${API}/referral/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referral_code: 'DEMO-42',
          fingerprint: {
            user_agent: ua,
            screen_width: fp.screen_width,
            screen_height: fp.screen_height,
            timezone: fp.timezone,
            language: fp.language,
          },
        }),
      });
      const data = await res.json();
      append(`link tapped → click ${data.click_id?.slice(0, 8)} stored`);
      setStage('store');
    } catch (e) {
      append(`click failed: ${(e as Error).message} (is the backend running?)`);
    }
  };

  const installFromStore = () => {
    setInstalling(true);
    setTimeout(() => {
      setInstalling(false);
      setStage('opening');
    }, 900);
  };

  // Step 2: the moment the app "opens" — Android recovers itself via the
  // real Install Referrer/fingerprint path automatically, same as a real
  // first launch. Guarded against double-firing if this effect re-runs.
  useEffect(() => {
    if (stage !== 'opening' || Platform.OS !== 'android' || openingStarted.current) return;
    openingStarted.current = true;
    (async () => {
      const recovered = await service.recover();
      if (recovered.code) {
        setResult({ code: recovered.code, method: recovered.method ?? 'unknown', confidence: recovered.confidence ?? null });
        append(`recovered ${recovered.code} via ${recovered.method} (${recovered.confidence})`);
      } else {
        append('no code recovered');
      }
      setStage('result');
    })();
  }, [stage, service]);

  // Step 3: claim after "signup".
  const doClaim = async () => {
    const claimed = await claim('demo-user-1');
    if (claimed.success) {
      setReward(`${claimed.reward?.amount} ${claimed.reward?.type}`);
      append(`claimed → ${claimed.reward?.amount} ${claimed.reward?.type}`);
    } else {
      append(`claim failed: ${claimed.error}`);
    }
  };

  const restart = () => {
    service.reset();
    setResult(null);
    setReward(null);
    setInstalling(false);
    openingStarted.current = false;
    setStage('link');
    append('storage reset');
  };

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Blynk Recovery Demo</Text>
      <Text style={styles.intro}>
        A live demo of blynk-deferlink's deferred deep linking recovery — an
        open-source alternative to Branch/AppFlyer for referral and install
        attribution, against the real backend.
        github.com/Newtdev/blynk-deferlink
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>useReferralCode() — automatic check on launch</Text>
        <Text style={styles.value}>
          {loading ? 'recovering…' : code || '— (none yet)'}
        </Text>
        {method ? (
          <Text style={styles.meta}>
            method: {method}
            {confidence != null ? ` · confidence ${confidence}` : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.stepper}>
        {STAGES.map((s, i) => (
          <Text
            key={s.key}
            style={[
              styles.stepperItem,
              i === stageIndex && styles.stepperActive,
              i < stageIndex && styles.stepperDone,
            ]}
          >
            {s.label}
          </Text>
        ))}
      </View>

      {stage === 'link' && (
        <View style={styles.card}>
          <Text style={styles.linkFrom}>📲 A friend sent you an invite</Text>
          <Button label="Tap the invite link" onPress={tapLink} />
        </View>
      )}

      {stage === 'store' && (
        <View style={[styles.card, styles.storeRow]}>
          <View style={styles.storeIcon}>
            <Text style={styles.storeIconText}>BD</Text>
          </View>
          <View style={styles.storeMeta}>
            <Text style={styles.storeName}>Blynk Deferlink Demo</Text>
            <Text style={styles.storeSub}>
              {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} · ★★★★☆ · Free
            </Text>
          </View>
          <TouchableOpacity style={styles.btnSmall} onPress={installFromStore} disabled={installing}>
            <Text style={styles.btnText}>{installing ? 'Installing…' : 'Install'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {stage === 'opening' && (
        <View style={styles.card}>
          <Text style={styles.value}>Opening app…</Text>
          {Platform.OS === 'android' ? (
            <Text style={styles.meta}>Checking the Play Install Referrer — deterministic.</Text>
          ) : (
            <>
              <Text style={styles.meta}>
                Your app checks the clipboard on first launch. Apple requires the user to confirm
                this via the system paste control — tap it below, same as a real app.
              </Text>
              {/* Themed icon+label: the recommended pattern — keeps the system
                  "Paste" icon+text (Apple won't let that part go), themed to
                  the app's own brand color so it reads as part of the UI
                  instead of a bare system control. */}
              <ReferralPasteButton
                onCode={(c, token) => {
                  onClipboardCode(c, token);
                  append(`clipboard paste → ${c}${token ? '' : ' (no token — will fail to claim)'}`);
                  setResult({ code: c, method: 'clipboard', confidence: null });
                  setStage('result');
                }}
                style={styles.pasteBtn}
                pasteForegroundColor="#FFFFFF"
                pasteBackgroundColor="#6C63FF"
                cornerStyle="medium"
              />
            </>
          )}
        </View>
      )}

      {stage === 'result' && (
        <View style={styles.card}>
          {result ? (
            <>
              <Text style={styles.result}>Recovered: {result.code}</Text>
              <Text style={styles.meta}>
                method: {result.method}
                {result.confidence != null ? ` · confidence ${result.confidence}` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.meta}>No code recovered.</Text>
          )}
          {reward ? (
            <Text style={styles.result}>Claimed → {reward}</Text>
          ) : (
            <Button label="Continue as new user" onPress={doClaim} />
          )}
          <Button label="Restart demo" variant="ghost" onPress={restart} />
        </View>
      )}

      <Text style={styles.step}>Log</Text>
      <View style={styles.logBox}>
        {log.length === 0 ? (
          <Text style={styles.logEmpty}>Actions will appear here…</Text>
        ) : (
          log.map((l, i) => (
            <Text key={i} style={styles.logLine}>
              {l}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Button({
  label,
  onPress,
  variant = 'solid',
}: {
  label: string;
  onPress: () => void;
  variant?: 'solid' | 'ghost';
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, variant === 'ghost' && styles.btnGhost]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.btnText, variant === 'ghost' && styles.btnTextGhost]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, gap: 12 },
  h1: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  intro: { color: '#a5a5b0', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  card: { backgroundColor: '#17171f', borderRadius: 14, padding: 16, gap: 4 },
  label: { color: '#8b8b96', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  value: { color: '#fff', fontSize: 28, fontWeight: '700' },
  meta: { color: '#a5a5b0', fontSize: 13 },
  step: { color: '#c9c9d1', fontSize: 13, marginTop: 12, fontWeight: '600' },
  stepper: { flexDirection: 'row', gap: 6, marginTop: 4 },
  stepperItem: {
    flex: 1,
    textAlign: 'center',
    color: '#55555f',
    fontSize: 11,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: '#26262f',
  },
  stepperActive: { color: '#fff', fontWeight: '700', borderBottomColor: '#6C63FF' },
  stepperDone: { color: '#a5a5b0', borderBottomColor: '#55555f' },
  linkFrom: { color: '#fff', fontSize: 16, marginBottom: 10 },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  storeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeIconText: { color: '#fff', fontWeight: '700' },
  storeMeta: { flex: 1, gap: 2 },
  storeName: { color: '#fff', fontWeight: '600', fontSize: 14 },
  storeSub: { color: '#a5a5b0', fontSize: 12 },
  btnSmall: { backgroundColor: '#6C63FF', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  // Matches btn below as closely as UIPasteControl allows: same background/
  // text color and same rendered height (btn's height comes from its own
  // padding: 15 + ~18pt line height at fontSize 15, so 48 here reproduces
  // it since the native control has no padding of its own to compute
  // from). cornerStyle: 'medium' was picked by comparing rendered
  // screenshots against btn's borderRadius: 12 — UIPasteControl has no
  // arbitrary radius, only named styles, and 'fixed' (tried first, by
  // name alone) turned out visibly too subtle; 'medium' is the actual
  // match.
  pasteBtn: { height: 48, marginTop: 10 },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3a3a45' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btnTextGhost: { color: '#c9c9d1' },
  result: { color: '#7dffa0', fontSize: 15, fontWeight: '600', marginTop: 6 },
  logBox: { backgroundColor: '#101017', borderRadius: 12, padding: 12, minHeight: 90 },
  logEmpty: { color: '#55555f', fontStyle: 'italic' },
  logLine: { color: '#b7b7c2', fontSize: 12, fontFamily: 'monospace', marginBottom: 3 },
});
