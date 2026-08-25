import {
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
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

// Same origin the web demo is deployed at — the generated link below is
// built against this, in the /referral/:code shape the README documents
// (see docs/decisions.md #3), just under /demo so it lands on the demo's
// own "app opened" fallback instead of a real store listing (none
// published yet — see examples/web/src/DemoPage.tsx's top-of-file comment).
// On a physical device, localhost won't reach your dev machine either —
// same caveat as API below — set this to your LAN IP:5173 there.
const WEB_ORIGIN = __DEV__ ? 'http://localhost:5173' : 'https://referral-web-demo.vercel.app';

const config: ReferralConfig = {
  apiEndpoint: API,
  appScheme: 'myapp',
  onCodeFound: (code, method) => console.log('onCodeFound', code, method),
  onNoCode: () => console.log('onNoCode'),
};

const CODE_PATTERN = /^[A-Za-z]+\d{4}$/;

function genCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let prefix = '';
  for (let i = 0; i < 3; i++) prefix += letters[Math.floor(Math.random() * letters.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}${digits}`;
}

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
  const [refCode, setRefCode] = useState(genCode);

  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev]);

  const codeValid = CODE_PATTERN.test(refCode);
  const link = `${WEB_ORIGIN}/demo/referral/${refCode}`;

  const openLink = async () => {
    try {
      await Linking.openURL(link);
      append(`opened ${link}`);
    } catch (e) {
      append(`couldn't open link: ${(e as Error).message}`);
    }
  };

  const shareLink = async () => {
    try {
      await Share.share({ message: link });
    } catch (e) {
      append(`share failed: ${(e as Error).message}`);
    }
  };

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
        <Text style={styles.label}>Generate a referral link</Text>
        <TextInput
          style={styles.input}
          value={refCode}
          onChangeText={(t) => setRefCode(t.toUpperCase())}
          placeholder="REF1234"
          placeholderTextColor="#55555f"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {!codeValid && (
          <Text style={styles.error}>Needs letters followed by exactly 4 digits — e.g. REF1234.</Text>
        )}
        {codeValid && (
          <>
            <Text style={styles.linkText}>{link}</Text>
            <View style={styles.row}>
              <Button label="Open link" onPress={openLink} />
              <Button label="Share" onPress={shareLink} variant="ghost" />
            </View>
            <Text style={styles.meta}>
              Opens the real landing page in your browser — real countdown, real click
              registration, real clipboard handoff. Come back here after: the card below already
              recovers automatically, same as a real launch.
            </Text>
          </>
        )}
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
  variant = 'solid',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'solid' | 'ghost';
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, variant === 'ghost' && styles.btnGhost, disabled && styles.btnDisabled]}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
    >
      <Text style={[styles.btnText, variant === 'ghost' && styles.btnTextGhost]}>{label}</Text>
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
  input: {
    marginTop: 6,
    backgroundColor: '#0b0b0f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3a3a45',
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: 16,
    padding: 10,
  },
  error: { color: '#ff8a8a', fontSize: 12, marginTop: 4 },
  linkText: {
    color: '#8ab4ff',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 8,
    backgroundColor: '#0b0b0f',
    borderRadius: 6,
    padding: 8,
  },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pasteBtn: { height: 48, marginTop: 4 },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4, flex: 1 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3a3a45' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btnTextGhost: { color: '#c9c9d1' },
  result: { color: '#7dffa0', fontSize: 15, fontWeight: '600', marginTop: 6 },
  logBox: { backgroundColor: '#101017', borderRadius: 12, padding: 12, minHeight: 90 },
  logEmpty: { color: '#55555f', fontStyle: 'italic' },
  logLine: { color: '#b7b7c2', fontSize: 12, fontFamily: 'monospace', marginBottom: 3 },
});
