import { Platform, requireNativeComponent } from 'react-native';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';
import { useReferralContext } from './ReferralProvider';
import { parseClipboardReferralPayload } from './platform/clipboardPayload';

/** Maps to `UIPasteControl.Configuration.cornerStyle` (`UIButton.Configuration.CornerStyle`). */
export type ReferralPasteButtonCornerStyle = 'dynamic' | 'fixed' | 'capsule' | 'large' | 'medium' | 'small';
/** Maps to `UIPasteControl.Configuration.displayMode`. */
export type ReferralPasteButtonDisplayMode = 'iconAndLabel' | 'iconOnly' | 'labelOnly';

interface NativePasteControlProps {
  style?: StyleProp<ViewStyle>;
  onPaste?: (event: { nativeEvent: { text: string } }) => void;
  pasteForegroundColor?: ColorValue;
  pasteBackgroundColor?: ColorValue;
  cornerStyle?: ReferralPasteButtonCornerStyle;
  displayMode?: ReferralPasteButtonDisplayMode;
}

// Only required on iOS, where it backs the deterministic recovery tier —
// requireNativeComponent would throw immediately on Android since nothing
// registers this native view there, so it's only even attempted on iOS.
//
// The name here is 'ReferralPasteControl', NOT the manager's Obj-C class
// name ('ReferralPasteControlManager') — confirmed against RN's own source
// (RCTViewManagerModuleNameForClass in RCTComponentData.m) by actually
// running this on a simulator, not assumed: RCTViewManager registration
// strips a trailing "Manager" suffix from the class name to get the JS
// view name, so requireNativeComponent must be called with the manager's
// class name minus "Manager", not the class name itself.
const NativeReferralPasteControl =
  Platform.OS === 'ios'
    ? requireNativeComponent<NativePasteControlProps>('ReferralPasteControl')
    : null;

const DEFAULT_MATCH_WINDOW_SECONDS = 172800; // 48h, matching the backend's default

export interface ReferralPasteButtonProps {
  readonly style?: StyleProp<ViewStyle>;
  /** Called once a valid, non-stale referral payload is read from the clipboard. */
  readonly onCode?: (code: string) => void;

  // Theming — all optional, all system default if omitted. `UIPasteControl`
  // is genuinely customizable (colors, corner shape, icon/label layout),
  // just not *arbitrarily* so: there's no custom icon, font, or label text.
  // That's deliberate on Apple's part, not a gap in this wrapper — the
  // button's icon+text is a fixed, system-owned promise, and that fixed
  // meaning is part of why it's allowed to skip the "would like to paste"
  // prompt at all. Colors accept anything RN's color parser does (`'#fff'`,
  // `'rgba(...)'`, a platform color, etc).
  readonly pasteForegroundColor?: ColorValue;
  readonly pasteBackgroundColor?: ColorValue;
  readonly cornerStyle?: ReferralPasteButtonCornerStyle;
  readonly displayMode?: ReferralPasteButtonDisplayMode;
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
export function ReferralPasteButton({
  style,
  onCode,
  pasteForegroundColor,
  pasteBackgroundColor,
  cornerStyle,
  displayMode,
}: ReferralPasteButtonProps) {
  const { config } = useReferralContext();

  if (Platform.OS !== 'ios' || !NativeReferralPasteControl) return null;

  // config.matchWindow is documented in milliseconds; this function works
  // in seconds (matching the backend's own match_window_hours unit).
  const maxAgeSeconds = config.matchWindow ? config.matchWindow / 1000 : DEFAULT_MATCH_WINDOW_SECONDS;

  return (
    <NativeReferralPasteControl
      style={style}
      pasteForegroundColor={pasteForegroundColor}
      pasteBackgroundColor={pasteBackgroundColor}
      cornerStyle={cornerStyle}
      displayMode={displayMode}
      onPaste={(event) => {
        const parsed = parseClipboardReferralPayload(event.nativeEvent.text, maxAgeSeconds);
        if (parsed) onCode?.(parsed.code);
      }}
    />
  );
}
