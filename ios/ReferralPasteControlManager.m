// Swift classes aren't visible to RN's bridge registration macros directly
// — this file is the standard bridging shim that exposes
// ReferralPasteControlManager (and its onPaste prop) to the JS side via
// requireNativeComponent('ReferralPasteControlManager').
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(ReferralPasteControlManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(onPaste, RCTDirectEventBlock)

// Theming — all optional, all pass straight through to
// UIPasteControl.Configuration. See ReferralPasteControlView.swift for
// what each one actually maps to and why the names avoid colliding with
// UIView's own tintColor/backgroundColor.
RCT_EXPORT_VIEW_PROPERTY(pasteForegroundColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(pasteBackgroundColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(cornerStyle, NSString)
RCT_EXPORT_VIEW_PROPERTY(displayMode, NSString)

@end
