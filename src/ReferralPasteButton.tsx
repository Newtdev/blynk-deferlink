import { Platform, requireNativeComponent } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useReferralContext } from './ReferralProvider';
import { parseClipboardReferralPayload } from './platform/clipboardPayload';

interface NativePasteControlProps {
  style?: StyleProp<ViewStyle>;
  onPaste?: (event: { nativeEvent: { text: string } }) => void;
}

// Only required on iOS, where it backs the deterministic recovery tier —
// requireNativeComponent would throw immediately on Android since nothing
// registers this native view there, so it's only even attempted on iOS.
const NativeReferralPasteControl =
  Platform.OS === 'ios'
    ? requireNativeComponent<NativePasteControlProps>('ReferralPasteControlManager')
    : null;

const DEFAULT_MATCH_WINDOW_SECONDS = 172800; // 48h, matching the backend's default

export interface ReferralPasteButtonProps {
  readonly style?: StyleProp<ViewStyle>;
  /** Called once a valid, non-stale referral payload is read from the clipboard. */
  readonly onCode?: (code: string) => void;
}

/**
 * Renders a native paste button (`UIPasteControl` under the hood) that
 * recovers a referral code from the clipboard without the iOS 16+ system
 * "would like to paste" prompt — the tap on this control *is* the user's
 * explicit consent, so there's nothing to ask permission for separately.
 *
 * This is the deterministic iOS recovery tier, and it's genuinely
 * required, not decorative: unlike fingerprint matching, it can't run
 * automatically on launch — Apple's paste APIs only grant access from an
 * explicit user gesture, so there's no way around rendering *something*
 * tappable. Where you place it is entirely up to you (inline on a signup
 * screen, a dedicated first-launch moment, wherever fits) — but if this
 * component is never rendered, or the user never taps it, iOS silently
 * never gets the deterministic path at all and always falls through to
 * fingerprint matching. No error, no signal — just quietly weaker
 * matching for every install. See the package README before deciding to
 * skip it.
 *
 * Renders nothing on Android and on iOS below 16 (`UIPasteControl` isn't
 * available there) — safe to render unconditionally.
 */
export function ReferralPasteButton({ style, onCode }: ReferralPasteButtonProps) {
  const { config } = useReferralContext();

  if (Platform.OS !== 'ios' || !NativeReferralPasteControl) return null;

  // config.matchWindow is documented in milliseconds; this function works
  // in seconds (matching the backend's own match_window_hours unit).
  const maxAgeSeconds = config.matchWindow ? config.matchWindow / 1000 : DEFAULT_MATCH_WINDOW_SECONDS;

  return (
    <NativeReferralPasteControl
      style={style}
      onPaste={(event) => {
        const parsed = parseClipboardReferralPayload(event.nativeEvent.text, maxAgeSeconds);
        if (parsed) onCode?.(parsed.code);
      }}
    />
  );
}
