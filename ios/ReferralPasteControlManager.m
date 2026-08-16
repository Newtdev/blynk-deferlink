// Swift classes aren't visible to RN's bridge registration macros directly
// — this file is the standard bridging shim that exposes
// ReferralPasteControlManager (and its onPaste prop) to the JS side via
// requireNativeComponent('ReferralPasteControlManager').
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(ReferralPasteControlManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(onPaste, RCTDirectEventBlock)

@end
