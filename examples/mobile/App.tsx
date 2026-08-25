import {
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useState } from 'react';
import {
  ReferralProvider,
  ReferralPasteButton,
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

// The actual web demo — same backend, real click registration, real
// countdown/redirect, real clipboard write. Generating a code and opening
// the link there, on this same device/simulator, is what produces the real
// click this screen's own automatic recovery below finds — see the
// walkthrough in the card below. Not a link this app opens itself: the
// whole point is registering the click from an actual mobile browser,
// exactly like a real referred user would.
const WEB_DEMO = __DEV__ ? 'http://localhost:5173/demo' : 'https://referral-web-demo.vercel.app/demo';

const config: ReferralConfig = {
  apiEndpoint: API,
  appScheme: 'myapp',
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
  // It recovers automatically on mount, same as a real app would at
  // launch: Android reads the Play Install Referrer, iOS runs an automatic
  // fingerprint match, no gesture required either way (see the README's
  // own flow diagram). Nothing in this screen simulates that — it's the
  // real call, and it either finds a real click or it doesn't.
  const { code, method, confidence, loading, claim, onClipboardCode } = useReferralCode();
  const [log, setLog] = useState<string[]>([]);
  const [reward, setReward] = useState<string | null>(null);

  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev]);

  const doClaim = async () => {
    const result = await claim('demo-user-1');
    if (result.success) {
      setReward(`${result.reward?.amount} ${result.reward?.type}`);
      append(`claimed → ${result.reward?.amount} ${result.reward?.type}`);
    } else {
      append(`claim failed: ${result.error}`);
    }
  };

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
        <Text style={styles.label}>To see a real recovery</Text>
        <Text style={styles.step2}>
          1. On this same device/simulator, open {WEB_DEMO} in the browser.
        </Text>
        <Text style={styles.step2}>
          2. Create a code, open the generated link, and let it redirect (or
          tap through) — that registers a real click from this device.
        </Text>
        <Text style={styles.step2}>
          3. Come back here — the card below already ran automatically the
          moment this app opened, same as a real launch.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>useReferralCode() — automatic check on launch</Text>
        <Text style={styles.value}>{loading ? 'recovering…' : code || '— (none yet)'}</Text>
        {method ? (
          <Text style={styles.meta}>
            method: {method}
            {confidence != null ? ` · confidence ${confidence}` : ''}
          </Text>
        ) : null}
      </View>

      {Platform.OS === 'ios' && (
        <>
          <Text style={styles.step}>
            Or tap to check the clipboard directly — overrides the automatic result above if a
            valid payload is found, same as a real app:
          </Text>
          {/* Themed icon+label: the recommended pattern — keeps the system
              "Paste" icon+text (Apple won't let that part go), themed to the
              app's own brand color so it reads as part of the UI instead of
              a bare system control. */}
          <ReferralPasteButton
            onCode={(c, token) => {
              onClipboardCode(c, token);
              append(`clipboard paste → ${c}${token ? '' : ' (no token — will fail to claim)'}`);
            }}
            style={styles.pasteBtn}
            pasteForegroundColor="#FFFFFF"
            pasteBackgroundColor="#6C63FF"
            cornerStyle="medium"
          />
        </>
      )}

      {reward ? (
        <Text style={styles.result}>Claimed → {reward}</Text>
      ) : (
        <Button label="Continue as new user" onPress={doClaim} disabled={!code} />
      )}
      <Text style={styles.meta}>
        No reset button — a fresh app launch (reload the app) always recovers from scratch, same
        as it would for a real user; the SDK persists nothing to disk.
      </Text>

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
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
    >
      <Text style={styles.btnText}>{label}</Text>
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
  step2: { color: '#c9c9d1', fontSize: 13, marginTop: 4 },
  pasteBtn: { height: 48, marginTop: 4 },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  result: { color: '#7dffa0', fontSize: 15, fontWeight: '600', marginTop: 6 },
  logBox: { backgroundColor: '#101017', borderRadius: 12, padding: 12, minHeight: 90 },
  logEmpty: { color: '#55555f', fontStyle: 'italic' },
  logLine: { color: '#b7b7c2', fontSize: 12, fontFamily: 'monospace', marginBottom: 3 },
});
