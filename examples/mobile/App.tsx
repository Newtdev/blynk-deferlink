import { useMemo, useState } from 'react';
import {
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
  collectFingerprint,
  useReferralCode,
  type ReferralConfig,
} from '@sparkle/referral-mobile';

// Pointed at the live deployed backend (packages/referral-sdk-node on
// Vercel) so the simulator exercises the real click → recover flow, not the
// local mock. Swap back to 'http://localhost:8787/api' for offline dev.
const API = 'https://referral-sdk-node.vercel.app/api';

const config: ReferralConfig = {
  apiEndpoint: API,
  appScheme: 'sparkleapp',
  onCodeFound: (code, method) => console.log('onCodeFound', code, method),
  onNoCode: () => console.log('onNoCode'),
};

export default function App() {
  return (
    <ReferralProvider config={config}>
      <SafeAreaView style={styles.safe}>
        <Screen />
      </SafeAreaView>
    </ReferralProvider>
  );
}

function Screen() {
  // The production entry point — a signup screen would use exactly this.
  const { code, method, confidence, loading, claim } = useReferralCode();

  const service = useMemo(() => new ReferralService(config), []);
  const [log, setLog] = useState<string[]>([]);
  const [demoCode, setDemoCode] = useState<string | null>(null);

  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev]);

  // Step 1: pretend the user tapped the invite link in a browser. We store a
  // click carrying this device's own signature so the later match scores 100.
  const simulateLinkTap = async () => {
    await service.reset();
    setDemoCode(null);
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
    } catch (e) {
      append(`click failed: ${(e as Error).message} (is the backend running?)`);
    }
  };

  // Step 2: run the same recovery the app does on first launch.
  const recover = async () => {
    const result = await service.recover();
    setDemoCode(result.code);
    append(
      result.code
        ? `recovered ${result.code} via ${result.method} (${result.confidence})`
        : 'no code recovered',
    );
  };

  // Step 3: claim after "signup".
  const doClaim = async () => {
    const result = await claim('demo-user-1');
    append(
      result.success
        ? `claimed → ${result.reward?.amount} ${result.reward?.type}`
        : `claim failed: ${result.error}`,
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Referral SDK demo</Text>

      <View style={styles.card}>
        <Text style={styles.label}>useReferralCode()</Text>
        <Text style={styles.value}>
          {loading ? 'recovering…' : code ? code : '— (none yet)'}
        </Text>
        {method ? (
          <Text style={styles.meta}>
            method: {method}
            {confidence != null ? ` · confidence ${confidence}` : ''}
          </Text>
        ) : null}
      </View>

      <Text style={styles.step}>Walk the flow:</Text>
      <Button label="1 · Simulate tapping the invite link" onPress={simulateLinkTap} />
      <Button label="2 · Recover code (first-launch flow)" onPress={recover} />
      <Button label="3 · Claim as new user" onPress={doClaim} />
      <Button label="Reset" variant="ghost" onPress={async () => {
        await service.reset();
        setDemoCode(null);
        append('storage reset');
      }} />

      {demoCode ? (
        <Text style={styles.result}>Last demo recovery: {demoCode}</Text>
      ) : null}

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
  card: { backgroundColor: '#17171f', borderRadius: 14, padding: 16, gap: 4 },
  label: { color: '#8b8b96', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  value: { color: '#fff', fontSize: 28, fontWeight: '700' },
  meta: { color: '#a5a5b0', fontSize: 13 },
  step: { color: '#c9c9d1', fontSize: 13, marginTop: 12, fontWeight: '600' },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 15, alignItems: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3a3a45' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btnTextGhost: { color: '#c9c9d1' },
  result: { color: '#7dffa0', fontSize: 15, fontWeight: '600', marginTop: 6 },
  logBox: { backgroundColor: '#101017', borderRadius: 12, padding: 12, minHeight: 90 },
  logEmpty: { color: '#55555f', fontStyle: 'italic' },
  logLine: { color: '#b7b7c2', fontSize: 12, fontFamily: 'monospace', marginBottom: 3 },
});
